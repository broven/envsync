/**
 * In-memory fake of the bw CLI, driven through the BwExecutor interface.
 * Lets command tests exercise the real BwClient logic without a vault.
 */
import type { BwExecutor, BwField, BwItem } from '../src/bitwarden/bw.js';

export interface FakeVault {
  executor: BwExecutor;
  folders: { id: string; name: string }[];
  items: BwItem[];
  status: 'unauthenticated' | 'locked' | 'unlocked';
  syncCount: number;
}

export function createFakeVault(
  initial: { status?: FakeVault['status'] } = {},
): FakeVault {
  let nextId = 1;
  const genId = (prefix: string) => `${prefix}-${nextId++}`;

  const vault: FakeVault = {
    folders: [],
    items: [],
    status: initial.status ?? 'unlocked',
    syncCount: 0,
    executor: async (args: string[]) => {
      const decode = (b64: string) => JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));

      if (args[0] === 'status') {
        return JSON.stringify({ status: vault.status });
      }
      if (args[0] === 'sync') {
        vault.syncCount++;
        return 'Syncing complete.';
      }
      if (args[0] === 'list' && args[1] === 'folders') {
        return JSON.stringify(vault.folders);
      }
      if (args[0] === 'list' && args[1] === 'items') {
        const folderIdIdx = args.indexOf('--folderid');
        const folderId = folderIdIdx >= 0 ? args[folderIdIdx + 1] : null;
        return JSON.stringify(
          folderId ? vault.items.filter((i) => i.folderId === folderId) : vault.items,
        );
      }
      if (args[0] === 'create' && args[1] === 'folder') {
        const data = decode(args[2]) as { name: string };
        const folder = { id: genId('folder'), name: data.name };
        vault.folders.push(folder);
        return JSON.stringify(folder);
      }
      if (args[0] === 'create' && args[1] === 'item') {
        const data = decode(args[2]) as Partial<BwItem> & { fields?: BwField[] };
        const item: BwItem = {
          id: genId('item'),
          name: data.name!,
          folderId: data.folderId ?? null,
          type: data.type ?? 2,
          notes: data.notes,
          fields: data.fields ?? [],
        };
        vault.items.push(item);
        return JSON.stringify(item);
      }
      if (args[0] === 'edit' && args[1] === 'item') {
        const id = args[2];
        const data = decode(args[3]) as Partial<BwItem>;
        const idx = vault.items.findIndex((i) => i.id === id);
        if (idx === -1) throw new Error(`fake-bw: no item with id ${id}`);
        vault.items[idx] = { ...vault.items[idx], ...data, id };
        return JSON.stringify(vault.items[idx]);
      }
      throw new Error(`fake-bw: unhandled command: bw ${args.join(' ')}`);
    },
  };

  return vault;
}

/** Convenience: seed a folder + secure note item with fields */
export function seedProject(
  vault: FakeVault,
  folderName: string,
  itemName: string,
  fields: Record<string, string>,
): void {
  let folder = vault.folders.find((f) => f.name === folderName);
  if (!folder) {
    folder = { id: `folder-seed-${vault.folders.length}`, name: folderName };
    vault.folders.push(folder);
  }
  vault.items.push({
    id: `item-seed-${vault.items.length}`,
    name: itemName,
    folderId: folder.id,
    type: 2,
    fields: Object.entries(fields).map(([name, value]) => ({ name, value, type: 1 })),
  });
}
