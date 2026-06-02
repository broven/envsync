import { describe, expect, it } from 'vitest';

import { BwClient } from '../src/bitwarden/bw.js';
import type { EnvsyncConfig } from '../src/core/config.js';
import { buildPushPlan, resolveRemoteValues } from '../src/core/sync.js';
import { createFakeVault, seedProject } from './fake-bw.js';

const config: EnvsyncConfig = {
  version: 1,
  project: 'myapp',
  files: {
    '.env': {
      example: '.env.example',
      keys: {
        DATABASE_URL: true,
        API_KEY: true,
        STRIPE_KEY: { folder: 'stripe', item: 'stripe-dev', field: 'publishable_key' },
      },
    },
    'apps/web/.env': {
      example: 'apps/web/.env.example',
      keys: { VITE_URL: true },
    },
  },
};

describe('buildPushPlan', () => {
  it('creates fields for new keys with local values', () => {
    const plan = buildPushPlan(
      config,
      {
        '.env': { DATABASE_URL: 'postgres://x', API_KEY: 'sk-1' },
        'apps/web/.env': { VITE_URL: 'https://api.dev' },
      },
      null,
    );
    expect(plan.created.sort()).toEqual(['apps/web/env-VITE_URL', 'env-API_KEY', 'env-DATABASE_URL']);
    expect(plan.external).toEqual(['env-STRIPE_KEY']);
    expect(plan.fields).toContainEqual({
      name: 'env-DATABASE_URL',
      value: 'postgres://x',
      type: 1,
    });
  });

  it('skips keys without local values and keeps remote value', () => {
    const existingItem = {
      id: 'i1',
      name: 'myapp',
      folderId: 'f1',
      type: 2,
      fields: [{ name: 'env-API_KEY', value: 'remote-value', type: 1 }],
    };
    const plan = buildPushPlan(config, { '.env': {}, 'apps/web/.env': {} }, existingItem);
    expect(plan.created).toEqual([]);
    expect(plan.missingLocal).toContain('env-API_KEY');
    // remote value preserved, not blanked
    expect(plan.fields).toContainEqual({ name: 'env-API_KEY', value: 'remote-value', type: 1 });
  });

  it('detects updated vs unchanged values', () => {
    const existingItem = {
      id: 'i1',
      name: 'myapp',
      folderId: 'f1',
      type: 2,
      fields: [
        { name: 'env-DATABASE_URL', value: 'postgres://old', type: 1 },
        { name: 'env-API_KEY', value: 'sk-same', type: 1 },
      ],
    };
    const plan = buildPushPlan(
      config,
      { '.env': { DATABASE_URL: 'postgres://new', API_KEY: 'sk-same' }, 'apps/web/.env': {} },
      existingItem,
    );
    expect(plan.updated).toEqual(['env-DATABASE_URL']);
    expect(plan.unchanged).toEqual(['env-API_KEY']);
  });

  it('preserves unmanaged fields on the item', () => {
    const existingItem = {
      id: 'i1',
      name: 'myapp',
      folderId: 'f1',
      type: 2,
      fields: [{ name: 'someone-elses-field', value: 'keep me', type: 0 }],
    };
    const plan = buildPushPlan(config, { '.env': { DATABASE_URL: 'x' }, 'apps/web/.env': {} }, existingItem);
    expect(plan.fields).toContainEqual({ name: 'someone-elses-field', value: 'keep me', type: 0 });
  });

  it('never pushes external-ref keys even when a local value exists', () => {
    const plan = buildPushPlan(
      config,
      { '.env': { STRIPE_KEY: 'pk_local' }, 'apps/web/.env': {} },
      null,
    );
    expect(plan.fields.find((f) => f.name === 'env-STRIPE_KEY')).toBeUndefined();
  });
});

describe('resolveRemoteValues', () => {
  it('resolves project fields and external refs', async () => {
    const vault = createFakeVault();
    seedProject(vault, 'envsync', 'myapp', {
      'env-DATABASE_URL': 'postgres://remote',
      'apps/web/env-VITE_URL': 'https://remote',
    });
    seedProject(vault, 'stripe', 'stripe-dev', { publishable_key: 'pk_test_999' });

    const bw = new BwClient(vault.executor);
    const folder = await bw.findFolder('envsync');
    const item = await bw.findItem(folder!.id, 'myapp');

    const remote = await resolveRemoteValues(bw, config, item);

    expect(remote.values['.env'].DATABASE_URL).toBe('postgres://remote');
    expect(remote.values['.env'].STRIPE_KEY).toBe('pk_test_999');
    expect(remote.values['apps/web/.env'].VITE_URL).toBe('https://remote');
    // API_KEY exists in config but not remotely
    expect(remote.missing).toEqual(['.env:API_KEY']);
  });

  it('reports everything missing when project item is null', async () => {
    const vault = createFakeVault();
    const bw = new BwClient(vault.executor);
    const remote = await resolveRemoteValues(bw, config, null);
    expect(remote.missing).toHaveLength(4);
  });
});
