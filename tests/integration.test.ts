/**
 * End-to-end flow against a temp git repo and an in-memory Bitwarden vault:
 *
 *   owner repo:  init -> push
 *   clone repo:  pull -> .env files materialize with the right values
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BwClient } from '../src/bitwarden/bw.js';
import { initCommand } from '../src/commands/init.js';
import { pushCommand } from '../src/commands/push.js';
import { pullCommand } from '../src/commands/pull.js';
import { loadConfig } from '../src/core/config.js';
import { parseDotenv, getEntries } from '../src/core/dotenv.js';
import { createFakeVault, seedProject, type FakeVault } from './fake-bw.js';

let ownerRepo: string;
let cloneRepo: string;
let vault: FakeVault;
let originalCwd: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function initGitRepo(dir: string): void {
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@test.dev');
  git(dir, 'config', 'user.name', 'Test');
}

function write(dir: string, relPath: string, content: string): void {
  const abs = join(dir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

beforeEach(() => {
  originalCwd = process.cwd();
  ownerRepo = mkdtempSync(join(tmpdir(), 'envsync-owner-'));
  cloneRepo = mkdtempSync(join(tmpdir(), 'envsync-clone-'));
  vault = createFakeVault();
  initGitRepo(ownerRepo);
  initGitRepo(cloneRepo);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(ownerRepo, { recursive: true, force: true });
  rmSync(cloneRepo, { recursive: true, force: true });
});

describe('init -> push -> pull', () => {
  it('full owner-to-teammate flow', async () => {
    // ── Owner repo setup ──────────────────────────────────────────────────
    write(ownerRepo, '.env', 'DATABASE_URL=postgres://localhost/dev\nAPI_KEY=sk-secret-123\n');
    write(ownerRepo, '.env.example', 'DATABASE_URL=\nAPI_KEY=\n');
    // monorepo sub-app with values but NO example file
    write(ownerRepo, 'apps/web/.env', 'VITE_API_URL=https://api.dev\n');
    // cloudflare workers vars
    write(ownerRepo, 'packages/worker/.dev.vars', 'CF_API_TOKEN=cf-tok-456\n');
    // a file in node_modules that must be ignored
    write(ownerRepo, 'node_modules/pkg/.env', 'SHOULD_NOT=appear\n');

    // ── init ──────────────────────────────────────────────────────────────
    process.chdir(ownerRepo);
    await initCommand({ yes: true });

    const config = loadConfig(ownerRepo);
    expect(Object.keys(config.files).sort()).toEqual([
      '.env',
      'apps/web/.env',
      'packages/worker/.dev.vars',
    ]);
    expect(config.files['.env'].keys).toEqual({ DATABASE_URL: true, API_KEY: true });

    // example files auto-generated for files that lacked them
    expect(existsSync(join(ownerRepo, 'apps/web/.env.example'))).toBe(true);
    expect(existsSync(join(ownerRepo, 'packages/worker/.dev.vars.example'))).toBe(true);
    // generated example contains keys but no values
    const generatedExample = readFileSync(join(ownerRepo, 'apps/web/.env.example'), 'utf8');
    expect(generatedExample).toContain('VITE_API_URL=');
    expect(generatedExample).not.toContain('https://api.dev');

    // .gitignore updated (init --yes auto-accepts)
    const gitignore = readFileSync(join(ownerRepo, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env');

    // ── push ──────────────────────────────────────────────────────────────
    await pushCommand({}, new BwClient(vault.executor));

    const folder = vault.folders.find((f) => f.name === 'envsync');
    expect(folder).toBeDefined();
    const item = vault.items.find((i) => i.name === config.project);
    expect(item).toBeDefined();
    const fieldMap = Object.fromEntries(item!.fields!.map((f) => [f.name, f.value]));
    expect(fieldMap).toEqual({
      'env-DATABASE_URL': 'postgres://localhost/dev',
      'env-API_KEY': 'sk-secret-123',
      'apps/web/env-VITE_API_URL': 'https://api.dev',
      'packages/worker/dev.vars-CF_API_TOKEN': 'cf-tok-456',
    });
    // all fields are hidden type
    expect(item!.fields!.every((f) => f.type === 1)).toBe(true);

    // ── simulate clone: copy .envsync + example files only (no values) ────
    const ownerConfig = readFileSync(join(ownerRepo, '.envsync'), 'utf8');
    // clone dir has a different name -> project name comes from .envsync, not dir
    write(cloneRepo, '.envsync', ownerConfig);
    write(cloneRepo, '.env.example', readFileSync(join(ownerRepo, '.env.example'), 'utf8'));
    write(
      cloneRepo,
      'apps/web/.env.example',
      readFileSync(join(ownerRepo, 'apps/web/.env.example'), 'utf8'),
    );

    // ── pull ──────────────────────────────────────────────────────────────
    process.chdir(cloneRepo);
    await pullCommand({}, new BwClient(vault.executor));

    const pulledEnv = getEntries(parseDotenv(readFileSync(join(cloneRepo, '.env'), 'utf8')));
    expect(pulledEnv).toEqual({
      DATABASE_URL: 'postgres://localhost/dev',
      API_KEY: 'sk-secret-123',
    });

    const pulledWebEnv = getEntries(
      parseDotenv(readFileSync(join(cloneRepo, 'apps/web/.env'), 'utf8')),
    );
    expect(pulledWebEnv).toEqual({ VITE_API_URL: 'https://api.dev' });

    const pulledVars = getEntries(
      parseDotenv(readFileSync(join(cloneRepo, 'packages/worker/.dev.vars'), 'utf8')),
    );
    expect(pulledVars).toEqual({ CF_API_TOKEN: 'cf-tok-456' });

    // pulled files have restrictive permissions
    const mode = statSync(join(cloneRepo, '.env')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('pull resolves external references from other folders', async () => {
    // owner pushes the project secrets, stripe key lives elsewhere
    seedProject(vault, 'stripe', 'stripe-dev', { publishable_key: 'pk_test_777' });
    seedProject(vault, 'envsync', 'extapp', { 'env-DATABASE_URL': 'postgres://remote' });

    write(
      cloneRepo,
      '.envsync',
      JSON.stringify({
        version: 1,
        project: 'extapp',
        files: {
          '.env': {
            example: '.env.example',
            keys: {
              DATABASE_URL: true,
              STRIPE_PUBLISHABLE_KEY: {
                folder: 'stripe',
                item: 'stripe-dev',
                field: 'publishable_key',
              },
            },
          },
        },
      }),
    );

    process.chdir(cloneRepo);
    await pullCommand({}, new BwClient(vault.executor));

    const pulled = getEntries(parseDotenv(readFileSync(join(cloneRepo, '.env'), 'utf8')));
    expect(pulled).toEqual({
      DATABASE_URL: 'postgres://remote',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_777',
    });
  });

  it('pull without --force only fills missing keys, preserving local edits', async () => {
    seedProject(vault, 'envsync', 'fillapp', {
      'env-A': 'remote-a',
      'env-B': 'remote-b',
    });
    write(
      cloneRepo,
      '.envsync',
      JSON.stringify({
        version: 1,
        project: 'fillapp',
        files: { '.env': { example: '.env.example', keys: { A: true, B: true } } },
      }),
    );
    // local file already has A customized
    write(cloneRepo, '.env', 'A=my-local-override\n');

    process.chdir(cloneRepo);
    await pullCommand({}, new BwClient(vault.executor));

    const pulled = getEntries(parseDotenv(readFileSync(join(cloneRepo, '.env'), 'utf8')));
    expect(pulled).toEqual({ A: 'my-local-override', B: 'remote-b' });
  });

  it('pull --force overwrites local values with remote', async () => {
    seedProject(vault, 'envsync', 'forceapp', { 'env-A': 'remote-a' });
    write(
      cloneRepo,
      '.envsync',
      JSON.stringify({
        version: 1,
        project: 'forceapp',
        files: { '.env': { example: '.env.example', keys: { A: true } } },
      }),
    );
    write(cloneRepo, '.env', 'A=local-version\n');

    process.chdir(cloneRepo);
    await pullCommand({ force: true }, new BwClient(vault.executor));

    const pulled = getEntries(parseDotenv(readFileSync(join(cloneRepo, '.env'), 'utf8')));
    expect(pulled).toEqual({ A: 'remote-a' });
  });

  it('pull fails with a helpful error when the project was never pushed', async () => {
    write(
      cloneRepo,
      '.envsync',
      JSON.stringify({
        version: 1,
        project: 'ghost-project',
        files: { '.env': { example: '.env.example', keys: { A: true } } },
      }),
    );

    process.chdir(cloneRepo);
    await expect(pullCommand({}, new BwClient(vault.executor))).rejects.toThrow(
      /envsync push/,
    );
  });

  it('push fails with a helpful error when bw is locked', async () => {
    const lockedVault = createFakeVault({ status: 'locked' });
    write(ownerRepo, '.env', 'A=1\n');
    write(ownerRepo, '.env.example', 'A=\n');

    process.chdir(ownerRepo);
    await initCommand({ yes: true });
    await expect(pushCommand({}, new BwClient(lockedVault.executor))).rejects.toThrow(
      /BW_SESSION/,
    );
  });

  it('push is idempotent: second push reports nothing to do', async () => {
    write(ownerRepo, '.env', 'A=1\n');
    write(ownerRepo, '.env.example', 'A=\n');

    process.chdir(ownerRepo);
    await initCommand({ yes: true });
    await pushCommand({}, new BwClient(vault.executor));
    const itemCountAfterFirst = vault.items.length;
    const fieldsAfterFirst = JSON.stringify(vault.items[0].fields);

    await pushCommand({}, new BwClient(vault.executor));
    expect(vault.items.length).toBe(itemCountAfterFirst);
    expect(JSON.stringify(vault.items[0].fields)).toBe(fieldsAfterFirst);
  });

  it('init merges with existing .envsync, preserving external refs', async () => {
    write(ownerRepo, '.env', 'DATABASE_URL=postgres://x\nSTRIPE_KEY=pk_live_111\n');
    write(ownerRepo, '.env.example', 'DATABASE_URL=\nSTRIPE_KEY=\n');
    // user hand-edited .envsync to make STRIPE_KEY an external ref
    write(
      ownerRepo,
      '.envsync',
      JSON.stringify({
        version: 1,
        project: 'mergeapp',
        files: {
          '.env': {
            example: '.env.example',
            keys: {
              DATABASE_URL: true,
              STRIPE_KEY: { folder: 'stripe', item: 'stripe-dev', field: 'pk' },
            },
          },
        },
      }),
    );

    process.chdir(ownerRepo);
    await initCommand({ yes: true });

    const config = loadConfig(ownerRepo);
    expect(config.project).toBe('mergeapp');
    expect(config.files['.env'].keys.STRIPE_KEY).toEqual({
      folder: 'stripe',
      item: 'stripe-dev',
      field: 'pk',
    });
  });
});
