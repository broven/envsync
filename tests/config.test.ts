import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ConfigError,
  loadConfig,
  mergeConfig,
  saveConfig,
  validateConfig,
  type EnvsyncConfig,
} from '../src/core/config.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'envsync-config-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const validConfig: EnvsyncConfig = {
  version: 1,
  project: 'myapp',
  files: {
    '.env': {
      example: '.env.example',
      keys: {
        DATABASE_URL: true,
        STRIPE_KEY: { folder: 'stripe', item: 'stripe-dev', field: 'publishable_key' },
      },
    },
  },
};

describe('validateConfig', () => {
  it('accepts a valid config', () => {
    expect(validateConfig(validConfig)).toEqual(validConfig);
  });

  it('rejects wrong version', () => {
    expect(() => validateConfig({ ...validConfig, version: 2 })).toThrow(ConfigError);
  });

  it('rejects missing project', () => {
    expect(() => validateConfig({ ...validConfig, project: '' })).toThrow(ConfigError);
  });

  it('rejects invalid key spec', () => {
    const bad = {
      ...validConfig,
      files: { '.env': { example: '.env.example', keys: { FOO: 'not-valid' } } },
    };
    expect(() => validateConfig(bad)).toThrow(ConfigError);
  });

  it('rejects external ref missing fields', () => {
    const bad = {
      ...validConfig,
      files: { '.env': { example: '.env.example', keys: { FOO: { folder: 'x' } } } },
    };
    expect(() => validateConfig(bad)).toThrow(ConfigError);
  });
});

describe('saveConfig / loadConfig', () => {
  it('round-trips a config', () => {
    saveConfig(root, validConfig);
    const loaded = loadConfig(root);
    expect(loaded.project).toBe('myapp');
    expect(loaded.files['.env'].keys.DATABASE_URL).toBe(true);
    expect(loaded.files['.env'].keys.STRIPE_KEY).toEqual({
      folder: 'stripe',
      item: 'stripe-dev',
      field: 'publishable_key',
    });
  });

  it('writes $schema and pretty-prints', () => {
    saveConfig(root, validConfig);
    const raw = readFileSync(join(root, '.envsync'), 'utf8');
    expect(raw).toContain('"$schema"');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('throws helpful error when .envsync is missing', () => {
    expect(() => loadConfig(root)).toThrow(/envsync init/);
  });

  it('throws on invalid JSON', () => {
    writeFileSync(join(root, '.envsync'), '{not json', 'utf8');
    expect(() => loadConfig(root)).toThrow(/not valid JSON/);
  });
});

describe('mergeConfig', () => {
  it('preserves external refs when scan reports the same key', () => {
    const merged = mergeConfig(validConfig, {
      '.env': {
        example: '.env.example',
        keys: { DATABASE_URL: true, STRIPE_KEY: true, NEW_KEY: true },
      },
    });
    // external ref must survive
    expect(merged.files['.env'].keys.STRIPE_KEY).toEqual({
      folder: 'stripe',
      item: 'stripe-dev',
      field: 'publishable_key',
    });
    expect(merged.files['.env'].keys.NEW_KEY).toBe(true);
  });

  it('keeps existing files not present in the scan', () => {
    const merged = mergeConfig(validConfig, {
      'apps/web/.env': { example: 'apps/web/.env.example', keys: { VITE_URL: true } },
    });
    expect(Object.keys(merged.files).sort()).toEqual(['.env', 'apps/web/.env']);
  });

  it('keeps the existing project name', () => {
    const merged = mergeConfig(validConfig, {});
    expect(merged.project).toBe('myapp');
  });
});
