import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class BitwardenError extends Error {}

export class BitwardenNotInstalledError extends BitwardenError {
  constructor() {
    super(
      'Bitwarden CLI (bw) is not installed.\n' +
        'Install it with one of:\n' +
        '  npm install -g @bitwarden/cli\n' +
        '  brew install bitwarden-cli',
    );
  }
}

export class BitwardenNotLoggedInError extends BitwardenError {
  constructor() {
    super('You are not logged in to Bitwarden.\nRun: bw login');
  }
}

export class BitwardenLockedError extends BitwardenError {
  constructor() {
    super(
      'Your Bitwarden vault is locked.\n' +
        'Run: export BW_SESSION=$(bw unlock --raw)\n' +
        'then re-run this command.',
    );
  }
}

export type BwStatus = 'unauthenticated' | 'locked' | 'unlocked';

export interface BwFolder {
  id: string;
  name: string;
}

export interface BwField {
  name: string;
  value: string;
  /** 0 = text, 1 = hidden, 2 = boolean, 3 = linked */
  type: number;
}

export interface BwItem {
  id: string;
  name: string;
  folderId: string | null;
  /** 1 = login, 2 = secure note, 3 = card, 4 = identity */
  type: number;
  notes?: string | null;
  fields?: BwField[];
  secureNote?: { type: number };
}

/** Field type for secrets — hidden in the Bitwarden UI */
export const FIELD_TYPE_HIDDEN = 1;

const ITEM_TYPE_SECURE_NOTE = 2;

const NOTE_BODY =
  'Managed by envsync (https://www.npmjs.com/package/@metajs/envsync). ' +
  'Each field is one environment variable: <file>-<KEY>.';

/** Executes a bw CLI command — injectable for tests */
export type BwExecutor = (args: string[]) => Promise<string>;

const defaultExecutor: BwExecutor = async (args) => {
  try {
    const { stdout } = await execFileAsync('bw', [...args, '--nointeraction'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
      env: process.env,
    });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
    if (e.code === 'ENOENT') {
      throw new BitwardenNotInstalledError();
    }
    const detail = (e.stderr || e.stdout || e.message || '').trim();
    throw new BitwardenError(`bw ${args[0]} failed: ${detail}`);
  }
};

export class BwClient {
  private exec: BwExecutor;

  constructor(executor: BwExecutor = defaultExecutor) {
    this.exec = executor;
  }

  async status(): Promise<BwStatus> {
    const out = await this.exec(['status']);
    try {
      return (JSON.parse(out) as { status: BwStatus }).status;
    } catch {
      throw new BitwardenError(`Unexpected output from \`bw status\`: ${out.slice(0, 200)}`);
    }
  }

  /** Verify bw is installed, logged in and unlocked. Throws a helpful error otherwise. */
  async preflight(): Promise<void> {
    const status = await this.status();
    if (status === 'unauthenticated') throw new BitwardenNotLoggedInError();
    if (status === 'locked') throw new BitwardenLockedError();
  }

  async sync(): Promise<void> {
    await this.exec(['sync']);
  }

  async listFolders(): Promise<BwFolder[]> {
    const out = await this.exec(['list', 'folders']);
    return JSON.parse(out) as BwFolder[];
  }

  async findFolder(name: string): Promise<BwFolder | null> {
    const folders = await this.listFolders();
    return folders.find((f) => f.name === name) ?? null;
  }

  async ensureFolder(name: string): Promise<BwFolder> {
    const existing = await this.findFolder(name);
    if (existing) return existing;
    const out = await this.exec(['create', 'folder', encode({ name })]);
    return JSON.parse(out) as BwFolder;
  }

  async listItemsInFolder(folderId: string): Promise<BwItem[]> {
    const out = await this.exec(['list', 'items', '--folderid', folderId]);
    return JSON.parse(out) as BwItem[];
  }

  async findItem(folderId: string, itemName: string): Promise<BwItem | null> {
    const items = await this.listItemsInFolder(folderId);
    return items.find((i) => i.name === itemName) ?? null;
  }

  async createSecureNote(folderId: string, name: string, fields: BwField[]): Promise<BwItem> {
    const item = {
      type: ITEM_TYPE_SECURE_NOTE,
      secureNote: { type: 0 },
      name,
      notes: NOTE_BODY,
      folderId,
      fields,
      // bw CLI requires these to be present even for secure notes
      login: null,
      card: null,
      identity: null,
      reprompt: 0,
      favorite: false,
      collectionIds: [],
    };
    const out = await this.exec(['create', 'item', encode(item)]);
    return JSON.parse(out) as BwItem;
  }

  async updateItemFields(item: BwItem, fields: BwField[]): Promise<BwItem> {
    const updated = { ...item, fields };
    const out = await this.exec(['edit', 'item', item.id, encode(updated)]);
    return JSON.parse(out) as BwItem;
  }

  /** Read a single field value from an item in a named folder (external refs) */
  async readExternalField(
    folderName: string,
    itemName: string,
    fieldName: string,
  ): Promise<string | null> {
    const folder = await this.findFolder(folderName);
    if (!folder) return null;
    const item = await this.findItem(folder.id, itemName);
    if (!item) return null;
    const field = (item.fields ?? []).find((f) => f.name === fieldName);
    return field?.value ?? null;
  }
}

function encode(data: unknown): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
}
