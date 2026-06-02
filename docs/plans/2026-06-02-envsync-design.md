# envsync 设计文档

> 2026-06-02 · 已与用户确认

## 目标

npm 包 `envsync`：把 git 仓库中的环境变量文件（`.env*`、`.dev.vars*`）同步到 Bitwarden。
项目 owner 扫描生成映射文件 `.envsync`（提交到 git，不含任何值），其他人 clone 后执行
`envsync pull` 即可从 Bitwarden 拉取生成本地环境变量文件。

## Bitwarden 存储结构

- 专用文件夹 `envsync`
- **一个项目 = 一个 Secure Note item**（item 名 = 项目名，默认取 git 仓库目录名）
- 每个环境变量 = item 的一个 hidden custom field
- field 名 = `<处理后文件名>-<KEY>`，文件名处理规则：去掉开头的 `.`
  - `.env` 的 `DATABASE_URL` → `env-DATABASE_URL`
  - `.env.production` 的 `API_KEY` → `env.production-API_KEY`
  - `apps/web/.env` 的 `VITE_API_URL` → `apps/web/env-VITE_API_URL`

```
📁 envsync (文件夹)
 └─ 📄 myapp (Secure Note)
     ├─ env-DATABASE_URL          = postgres://...
     ├─ env-API_KEY               = sk-xxx
     ├─ env.production-API_KEY    = sk-prod-xxx
     └─ apps/web/env-VITE_API_URL = https://...
```

## .envsync 文件格式

```json
{
  "$schema": "https://unpkg.com/envsync/schema.json",
  "version": 1,
  "project": "myapp",
  "files": {
    ".env": {
      "example": ".env.example",
      "keys": {
        "DATABASE_URL": true,
        "API_KEY": true,
        "STRIPE_PUBLISHABLE_KEY": {
          "folder": "stripe",
          "item": "stripe-dev",
          "field": "publishable_key"
        }
      }
    },
    "apps/web/.env": {
      "example": "apps/web/.env.example",
      "keys": { "VITE_API_URL": true }
    }
  }
}
```

- `true` = 默认行为：存到本项目 item
- 对象 = **外部引用**：从其他文件夹下的 item 读取（跨项目共享 secret，如 stripe key）。
  push 时跳过，仅 pull 时读取
- `.envsync` 永不包含值，可安全提交

## 扫描规则

- 递归扫描仓库（支持 monorepo），目标：`.env`、`.env.*`、`.dev.vars`、`.dev.vars.*`
  及对应 `.example` 文件
- 排除依赖/构建目录：`node_modules`、`.venv`、`venv`、`__pycache__`、`vendor`、
  `dist`、`build`、`target`、`.git` 等

## example / 实际文件配对逻辑

1. 有 `.env.xxx.example`：
   - 无 `.env.xxx` → 只从 example 收集 key，不填值
   - 有 `.env.xxx` → 从 example 收集 key，从 `.env.xxx` 取值
2. 只有 `.env.xxx` 没有 example → **自动生成** `.env.xxx.example`（只含 key），回到情况 1

## 命令

### envsync init
1. 校验 git 仓库，定位仓库根
2. 递归扫描，按配对逻辑处理，自动补 example 文件
3. 生成/合并 `.envsync`（不覆盖用户手写的外部引用）
4. 检查 `.gitignore` 覆盖实际值文件，缺失则提示
5. 提示下一步 `envsync push`

### envsync push
1. 读 `.envsync` + 本地实际值文件
2. 校验 bw 已解锁 → 找/建 `envsync` 文件夹 → 找/建项目 item
3. 本地值写入对应 field（外部引用跳过；本地缺值跳过并警告，不写空值）
4. 输出统计：新增/更新/跳过

### envsync pull
1. 读 `.envsync`，从 Bitwarden 读项目 item + 外部引用 item
2. 按文件生成 `.env.xxx`；已存在文件默认只补缺失 key，`--force` 整体覆盖
3. Bitwarden 也没有的 key → 留空并警告
4. 生成文件权限 600

### envsync status
本地 vs Bitwarden 对比：✓ 同步 / ✗ 仅本地 / ✗ 仅远端 / ≠ 值不同（不显示值）

## Bitwarden 交互

通过 `bw` CLI 子进程调用：
- 未安装 → 报错并给安装命令
- 未登录 → 提示 `bw login`
- 锁定 → 提示 `export BW_SESSION=$(bw unlock --raw)`
- 写操作后 `bw sync`

## 错误处理

| 场景 | 行为 |
|---|---|
| 不在 git 仓库 | 报错退出 |
| 无 .envsync 跑 push/pull | 提示先 init |
| pull 时找不到项目 item | 报错：owner 还没 push |
| 外部引用不存在 | 警告该 key，其他正常 |
| push 本地缺值 | 跳过警告，不覆盖远端 |
| bw 超时/网络错误 | 显示原始错误，非零退出 |

## 安全原则

- 所有输出不打印 secret 值，最多掩码 `sk-x****`
- `.envsync` 不含值
- pull 生成文件权限 600

## 技术栈

- TypeScript + Node ≥ 18，ESM
- commander（CLI）、@clack/prompts（交互）
- tsup（打包）、vitest（测试）
- dotenv 解析自实现（保留注释与顺序）

## 项目结构

```
src/
├── cli.ts              # commander 入口
├── commands/           # init / push / pull / status
├── core/               # scanner / dotenv / config / fieldname
├── bitwarden/bw.ts     # bw CLI 封装
└── utils/
schema.json             # .envsync JSON Schema
tests/
```

## 发布

- 包名 `envsync`（已确认 npm 可用）
- `npm publish --access public`，prepublishOnly 跑 build + test
