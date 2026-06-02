# envsync

> Sync `.env` files to Bitwarden — commit the mapping, not the secrets.

English | [简体中文](./README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/@metajs/envsync)](https://www.npmjs.com/package/@metajs/envsync)
[![CI](https://github.com/broven/envsync/actions/workflows/ci.yml/badge.svg)](https://github.com/broven/envsync/actions/workflows/ci.yml)

`envsync` scans your git repository for env files (`.env`, `.env.*`, Cloudflare's `.dev.vars`, …),
stores their values in your Bitwarden vault, and generates a **value-free** `.envsync` mapping file
that is safe to commit. Anyone who clones the repo just runs `envsync pull` to materialize every env
file with real values — no more "can you send me the .env?" in Slack.

```
┌─────────────┐   envsync push    ┌──────────────┐   envsync pull    ┌─────────────┐
│  your repo  │ ───────────────►  │   Bitwarden  │ ───────────────►  │ teammate's  │
│  .env files │                   │  envsync/    │                   │    clone    │
└─────────────┘                   └──────────────┘                   └─────────────┘
        │                                                                   ▲
        │                 .envsync (no secrets, committed)                  │
        └───────────────────────────  git  ────────────────────────────────┘
```

## Requirements

- Node.js ≥ 18
- [Bitwarden CLI](https://bitwarden.com/help/cli/) (`bw`), logged in:

```bash
npm install -g @bitwarden/cli   # or: brew install bitwarden-cli
bw login
```

Works with both bitwarden.com accounts and self-hosted servers (Vaultwarden included).

## Usage

### Run directly with npx (no install)

```bash
npx @metajs/envsync init
npx @metajs/envsync push
npx @metajs/envsync pull
```

### Or install globally

```bash
npm install -g @metajs/envsync

envsync init
```

The command is `envsync` either way.

## Quick start

### Project owner — first time setup

```bash
cd your-project
export BW_SESSION=$(bw unlock --raw)    # unlock your vault

npx @metajs/envsync init    # scan env files → .envsync (+ missing .example files)
npx @metajs/envsync push    # upload values to Bitwarden

git add .envsync *.example
git commit -m "chore: add envsync"
```

### Teammates — after cloning

```bash
git clone <your-project> && cd <your-project>
export BW_SESSION=$(bw unlock --raw)

npx @metajs/envsync pull    # every .env file appears, filled with real values
```

That's it. Two commands and they're running the project.

## Commands

| Command | Description |
|---|---|
| `envsync init` | Scan the repo for env files and generate the `.envsync` mapping. Auto-creates missing `.example` files and updates `.gitignore`. `--yes` skips prompts. |
| `envsync push` | Upload local env values to Bitwarden. Keys without local values are skipped — never overwrites remote values with blanks. `--dry-run` to preview. |
| `envsync pull` | Generate local env files from Bitwarden. Existing files only get missing keys filled; `--force` overwrites completely. Files are written with `600` permissions. |
| `envsync status` | Compare local values with Bitwarden: ✓ synced / ↑ local only / ↓ remote only / ≠ different. Never prints secret values. |

## What gets scanned

- `.env`, `.env.local`, `.env.production`, … and their `.example` counterparts
- `.dev.vars`, `.dev.vars.*` (Cloudflare Workers / Wrangler)
- Recursively, including monorepo sub-packages
- Dependency/build directories are skipped: `node_modules`, `.venv`, `venv`, `__pycache__`, `vendor`, `dist`, `build`, `target`, …

**Example file pairing:**

1. `.env.xxx.example` exists, `.env.xxx` doesn't → keys are collected from the example, no values
2. Both exist → keys from the example, values from the actual file
3. Only `.env.xxx` exists → a `.env.xxx.example` is generated for you (keys only), then rule 2 applies

## How it's stored in Bitwarden

One **Secure Note** per project, inside a dedicated `envsync` folder.
Each environment variable is one hidden custom field named `<file>-<KEY>`:

```
📁 envsync
 └─ 📄 myapp
     ├─ env-DATABASE_URL              = postgres://…
     ├─ env-API_KEY                   = sk-…
     ├─ env.production-STRIPE_SECRET  = sk_live_…
     ├─ apps/web/env-VITE_API_URL     = https://…
     └─ workers/cron/dev.vars-CF_API_TOKEN = …
```

## The `.envsync` file

Committed to git. Contains the mapping only — **never any values**:

```jsonc
{
  "$schema": "https://unpkg.com/@metajs/envsync/schema.json",
  "version": 1,
  "project": "myapp",                    // Bitwarden item name
  "files": {
    ".env": {
      "example": ".env.example",
      "keys": {
        "DATABASE_URL": true,            // true = stored in this project's item
        "API_KEY": true,
        "STRIPE_PUBLISHABLE_KEY": {      // external reference:
          "folder": "stripe",            //   read from another Bitwarden folder/item
          "item": "stripe-dev",          //   (shared across projects)
          "field": "publishable_key"     //   never pushed by this project
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

### Shared secrets across projects

Point any key at an existing item in another Bitwarden folder by replacing `true` with
`{ "folder": "...", "item": "...", "field": "..." }`. `envsync pull` reads it from there;
`envsync push` never writes to it. Perfect for company-wide keys (Stripe, Sentry, …) that
many projects share — update once, every project pulls the new value.

## Security

- `.envsync` contains key names and Bitwarden item names only — no secret values
- Secret values never appear in envsync's output (logs, status, errors)
- Pulled files are written with `600` (owner read/write only) permissions
- All values are stored as **hidden** custom fields in Bitwarden
- Auth is fully delegated to the official `bw` CLI — envsync never sees your master password
- Published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) — verifiable build from GitHub Actions

## Troubleshooting

| Error | Fix |
|---|---|
| `Bitwarden CLI (bw) is not installed` | `npm install -g @bitwarden/cli` |
| `You are not logged in to Bitwarden` | `bw login` |
| `Your Bitwarden vault is locked` | `export BW_SESSION=$(bw unlock --raw)` |
| `No item "xxx" found in the Bitwarden "envsync" folder` | The project owner hasn't run `envsync push` yet, or your account can't see the item |

## License

MIT
