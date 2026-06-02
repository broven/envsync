# envsync

> 把 `.env` 同步到 Bitwarden —— 提交映射文件，而不是秘密本身。

[English](./README.md) | 简体中文

[![npm](https://img.shields.io/npm/v/@metajs/envsync)](https://www.npmjs.com/package/@metajs/envsync)
[![CI](https://github.com/broven/envsync/actions/workflows/ci.yml/badge.svg)](https://github.com/broven/envsync/actions/workflows/ci.yml)

`envsync` 扫描 git 仓库中的环境变量文件（`.env`、`.env.*`、Cloudflare 的 `.dev.vars` 等），
把值存进你的 Bitwarden 密码库，并生成一个**不含任何值**的 `.envsync` 映射文件（可以放心提交）。
其他人 clone 仓库后只需运行 `envsync pull`，所有 env 文件就会带着真实的值自动生成 ——
再也不用在微信/Slack 里互传 `.env` 了。

```
┌─────────────┐   envsync push    ┌──────────────┐   envsync pull    ┌─────────────┐
│  你的仓库    │ ───────────────►  │   Bitwarden  │ ───────────────►  │  同事的     │
│  .env 文件  │                    │  envsync/    │                   │  clone      │
└─────────────┘                   └──────────────┘                   └─────────────┘
        │                                                                   ▲
        │                .envsync（无秘密，提交到 git）                       │
        └───────────────────────────  git  ────────────────────────────────┘
```

## 前置要求

- Node.js ≥ 18
- [Bitwarden CLI](https://bitwarden.com/help/cli/)（`bw`）并已登录：

```bash
npm install -g @bitwarden/cli   # 或: brew install bitwarden-cli
bw login
```

支持 bitwarden.com 官方账号和自托管服务器（包括 Vaultwarden）。

## 使用方式

### npx 直接运行（无需安装）

```bash
npx @metajs/envsync init
npx @metajs/envsync push
npx @metajs/envsync pull
```

### 或全局安装

```bash
npm install -g @metajs/envsync

envsync init
```

两种方式命令都是 `envsync`。

## 快速开始

### 项目 owner —— 首次设置

```bash
cd your-project
export BW_SESSION=$(bw unlock --raw)    # 解锁密码库

npx @metajs/envsync init    # 扫描 → 生成 .envsync（+ 补全缺失的 .example）
npx @metajs/envsync push    # 上传值到 Bitwarden

git add .envsync *.example
git commit -m "chore: add envsync"
```

### 团队成员 —— clone 之后

```bash
git clone <your-project> && cd <your-project>
export BW_SESSION=$(bw unlock --raw)

npx @metajs/envsync pull    # 所有 .env 文件带着真实值自动生成
```

就这两条命令，项目直接能跑。

## 命令

| 命令 | 说明 |
|---|---|
| `envsync init` | 扫描仓库生成 `.envsync` 映射。自动补全缺失的 `.example` 文件、更新 `.gitignore`。`--yes` 跳过交互提示。 |
| `envsync push` | 把本地 env 值上传到 Bitwarden。本地缺值的 key 会跳过——绝不会用空值覆盖远端。`--dry-run` 预览。 |
| `envsync pull` | 从 Bitwarden 生成本地 env 文件。已存在的文件只补缺失的 key；`--force` 完全覆盖。文件权限 `600`。 |
| `envsync status` | 对比本地与 Bitwarden：✓ 已同步 / ↑ 仅本地 / ↓ 仅远端 / ≠ 不一致。永不显示秘密值。 |

## 扫描范围

- `.env`、`.env.local`、`.env.production` 等及对应的 `.example` 文件
- `.dev.vars`、`.dev.vars.*`（Cloudflare Workers / Wrangler）
- 递归扫描，支持 monorepo 子目录
- 自动跳过依赖/构建目录：`node_modules`、`.venv`、`venv`、`__pycache__`、`vendor`、`dist`、`build`、`target` 等

**example 文件配对规则：**

1. 只有 `.env.xxx.example` → 从 example 收集 key，无值
2. 两者都有 → key 来自 example，值来自实际文件
3. 只有 `.env.xxx` → 自动生成 `.env.xxx.example`（仅 key），然后回到规则 2

## 在 Bitwarden 中的存储结构

每个项目一条 **Secure Note**，统一放在 `envsync` 文件夹下。
每个环境变量是一个 hidden custom field，命名格式 `<文件>-<KEY>`：

```
📁 envsync
 └─ 📄 myapp
     ├─ env-DATABASE_URL              = postgres://…
     ├─ env-API_KEY                   = sk-…
     ├─ env.production-STRIPE_SECRET  = sk_live_…
     ├─ apps/web/env-VITE_API_URL     = https://…
     └─ workers/cron/dev.vars-CF_API_TOKEN = …
```

## `.envsync` 文件

提交到 git，只含映射——**永远不含值**：

```jsonc
{
  "$schema": "https://unpkg.com/@metajs/envsync/schema.json",
  "version": 1,
  "project": "myapp",                    // Bitwarden item 名称
  "files": {
    ".env": {
      "example": ".env.example",
      "keys": {
        "DATABASE_URL": true,            // true = 存在本项目自己的 item 里
        "API_KEY": true,
        "STRIPE_PUBLISHABLE_KEY": {      // 外部引用：
          "folder": "stripe",            //   从其他 Bitwarden 文件夹/item 读取
          "item": "stripe-dev",          //   （跨项目共享）
          "field": "publishable_key"     //   本项目 push 时不会写它
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

### 跨项目共享 secret

把任意 key 的 `true` 换成 `{ "folder": "...", "item": "...", "field": "..." }`，
就能从其他 Bitwarden 文件夹读取。`pull` 时会去那里读，`push` 永远不会写入它。
适合公司级共享 key（Stripe、Sentry 等）——改一处，所有项目 pull 即生效。

## 安全性

- `.envsync` 只含 key 名和 Bitwarden item 名——没有任何秘密值
- envsync 的所有输出（日志、status、报错）都不会打印秘密值
- pull 生成的文件权限为 `600`（仅所有者可读写）
- 所有值以 **hidden** custom field 存储在 Bitwarden
- 认证完全交给官方 `bw` CLI —— envsync 接触不到你的主密码
- 通过 [npm provenance](https://docs.npmjs.com/generating-provenance-statements) 发布——构建过程可验证

## 常见问题

| 报错 | 解决 |
|---|---|
| `Bitwarden CLI (bw) is not installed` | `npm install -g @bitwarden/cli` |
| `You are not logged in to Bitwarden` | `bw login` |
| `Your Bitwarden vault is locked` | `export BW_SESSION=$(bw unlock --raw)` |
| `No item "xxx" found in the Bitwarden "envsync" folder` | 项目 owner 还没运行过 `envsync push`，或你的账号看不到该 item |

## License

MIT
