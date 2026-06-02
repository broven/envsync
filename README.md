# envsync

> Sync `.env` files to Bitwarden — commit the mapping, not the secrets.

`envsync` scans your git repository for env files (`.env`, `.env.*`, Cloudflare's `.dev.vars`, …),
stores their values in your Bitwarden vault, and generates a **value-free** `.envsync` mapping file
that is safe to commit. Anyone who clones the repo just runs `envsync pull` to materialize all env
files from Bitwarden.

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

## Install

```bash
npm install -g envsync
```

## Quick start

### Project owner

```bash
cd your-project
export BW_SESSION=$(bw unlock --raw)

envsync init     # scan env files, generate .envsync (+ missing .example files)
envsync push     # upload values to Bitwarden

git add .envsync *.example
git commit -m "chore: add envsync"
```

### Teammates

```bash
git clone your-project && cd your-project
export BW_SESSION=$(bw unlock --raw)

envsync pull     # all .env files materialize with values from Bitwarden
```

## Commands

| Command | Description |
|---|---|
| `envsync init` | Scan the repo for env files and generate the `.envsync` mapping. Auto-creates missing `.example` files and offers to update `.gitignore`. |
| `envsync push` | Upload local env values to Bitwarden. Keys without local values are skipped (never overwrites remote values with blanks). `--dry-run` to preview. |
| `envsync pull` | Generate local env files from Bitwarden. Existing files only get missing keys filled; use `--force` to overwrite completely. Files are created with `600` permissions. |
| `envsync status` | Compare local values with Bitwarden: ✓ synced / ↑ local only / ↓ remote only / ≠ different. Never prints secret values. |

## What gets scanned

- `.env`, `.env.local`, `.env.production`, … and their `.example` counterparts
- `.dev.vars`, `.dev.vars.*` (Cloudflare Workers / Wrangler)
- Recursively, including monorepo sub-packages
- Dependency/build directories are skipped: `node_modules`, `.venv`, `venv`, `__pycache__`, `vendor`, `dist`, `build`, `target`, …

**Example file logic:**

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
  "$schema": "https://unpkg.com/envsync/schema.json",
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

Point any key at an existing item in another folder by replacing `true` with
`{ "folder": "...", "item": "...", "field": "..." }`. `envsync pull` reads it from there;
`envsync push` never writes to it. Perfect for company-wide keys (Stripe, Sentry, …) that
many projects share.

## Security notes

- `.envsync` contains key names and Bitwarden item names only — no secret values
- Secret values never appear in envsync's output (logs, status, errors)
- Pulled files are written with `600` (owner read/write only) permissions
- All values are stored as **hidden** custom fields in Bitwarden
- Auth is fully delegated to the official `bw` CLI — envsync never sees your master password

## License

MIT
