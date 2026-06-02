import { describe, expect, it } from 'vitest';

import {
  BitwardenLockedError,
  BitwardenNotLoggedInError,
  BwClient,
} from '../src/bitwarden/bw.js';
import { createFakeVault, seedProject } from './fake-bw.js';

describe('BwClient', () => {
  it('preflight passes when unlocked', async () => {
    const vault = createFakeVault({ status: 'unlocked' });
    const bw = new BwClient(vault.executor);
    await expect(bw.preflight()).resolves.toBeUndefined();
  });

  it('preflight throws when not logged in', async () => {
    const vault = createFakeVault({ status: 'unauthenticated' });
    const bw = new BwClient(vault.executor);
    await expect(bw.preflight()).rejects.toThrow(BitwardenNotLoggedInError);
  });

  it('preflight throws when locked, with unlock hint', async () => {
    const vault = createFakeVault({ status: 'locked' });
    const bw = new BwClient(vault.executor);
    await expect(bw.preflight()).rejects.toThrow(BitwardenLockedError);
    await expect(bw.preflight()).rejects.toThrow(/BW_SESSION/);
  });

  it('ensureFolder creates the folder once and reuses it', async () => {
    const vault = createFakeVault();
    const bw = new BwClient(vault.executor);
    const first = await bw.ensureFolder('envsync');
    const second = await bw.ensureFolder('envsync');
    expect(first.id).toBe(second.id);
    expect(vault.folders).toHaveLength(1);
  });

  it('creates and finds secure note items with hidden fields', async () => {
    const vault = createFakeVault();
    const bw = new BwClient(vault.executor);
    const folder = await bw.ensureFolder('envsync');
    await bw.createSecureNote(folder.id, 'myapp', [
      { name: 'env-FOO', value: 'bar', type: 1 },
    ]);

    const item = await bw.findItem(folder.id, 'myapp');
    expect(item).not.toBeNull();
    expect(item!.fields).toEqual([{ name: 'env-FOO', value: 'bar', type: 1 }]);
  });

  it('updates item fields', async () => {
    const vault = createFakeVault();
    const bw = new BwClient(vault.executor);
    const folder = await bw.ensureFolder('envsync');
    const item = await bw.createSecureNote(folder.id, 'myapp', [
      { name: 'env-FOO', value: 'old', type: 1 },
    ]);

    await bw.updateItemFields(item, [{ name: 'env-FOO', value: 'new', type: 1 }]);
    const updated = await bw.findItem(folder.id, 'myapp');
    expect(updated!.fields![0].value).toBe('new');
  });

  it('reads external fields from another folder', async () => {
    const vault = createFakeVault();
    seedProject(vault, 'stripe', 'stripe-dev', { publishable_key: 'pk_test_123' });
    const bw = new BwClient(vault.executor);

    expect(await bw.readExternalField('stripe', 'stripe-dev', 'publishable_key')).toBe(
      'pk_test_123',
    );
    expect(await bw.readExternalField('stripe', 'stripe-dev', 'nope')).toBeNull();
    expect(await bw.readExternalField('stripe', 'nope', 'publishable_key')).toBeNull();
    expect(await bw.readExternalField('nope', 'stripe-dev', 'publishable_key')).toBeNull();
  });
});
