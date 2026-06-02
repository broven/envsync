import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { scanEnvFiles } from '../src/core/scanner.js';

let root: string;

function file(relPath: string, content = 'FOO=bar\n'): void {
  const abs = join(root, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'envsync-scan-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scanEnvFiles', () => {
  it('finds root .env files and pairs them with examples', () => {
    file('.env');
    file('.env.example', 'FOO=\n');
    const groups = scanEnvFiles(root);
    expect(groups).toEqual([
      { path: '.env', examplePath: '.env.example', hasActual: true, hasExample: true },
    ]);
  });

  it('handles example-only and actual-only groups', () => {
    file('.env.production.example', 'KEY=\n');
    file('.env.local');
    const groups = scanEnvFiles(root);
    expect(groups).toEqual([
      {
        path: '.env.local',
        examplePath: '.env.local.example',
        hasActual: true,
        hasExample: false,
      },
      {
        path: '.env.production',
        examplePath: '.env.production.example',
        hasActual: false,
        hasExample: true,
      },
    ]);
  });

  it('finds .dev.vars files', () => {
    file('.dev.vars');
    file('.dev.vars.example', 'CF_TOKEN=\n');
    file('.dev.vars.staging');
    const groups = scanEnvFiles(root);
    expect(groups.map((g) => g.path)).toEqual(['.dev.vars', '.dev.vars.staging']);
  });

  it('recurses into subdirectories (monorepo)', () => {
    file('.env');
    file('apps/web/.env');
    file('apps/web/.env.example', 'X=\n');
    file('packages/api/.dev.vars');
    const groups = scanEnvFiles(root);
    expect(groups.map((g) => g.path)).toEqual([
      '.env',
      'apps/web/.env',
      'packages/api/.dev.vars',
    ]);
  });

  it('skips dependency and build directories', () => {
    file('.env');
    file('node_modules/some-pkg/.env');
    file('node_modules/some-pkg/.env.example');
    file('.venv/lib/.env');
    file('venv/.env');
    file('__pycache__/.env');
    file('vendor/lib/.env');
    file('dist/.env');
    file('build/.env');
    file('target/debug/.env');
    file('.git/.env');
    file('.next/.env');
    file('coverage/.env');
    const groups = scanEnvFiles(root);
    expect(groups.map((g) => g.path)).toEqual(['.env']);
  });

  it('does not match unrelated dotfiles', () => {
    file('.envsync', '{}');
    file('.environment');
    file('.envrc', 'export FOO=bar');
    file('env.txt');
    const groups = scanEnvFiles(root);
    expect(groups).toEqual([]);
  });

  it('returns empty array for repo with no env files', () => {
    file('src/index.ts', 'console.log(1)');
    expect(scanEnvFiles(root)).toEqual([]);
  });
});
