import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

import pc from 'picocolors';

import { BwClient, BitwardenError } from '../bitwarden/bw.js';
import { loadConfig } from '../core/config.js';
import { parseDotenv, serializeDotenv, setEntry, getEntries, type DotenvDocument } from '../core/dotenv.js';
import { ENVSYNC_FOLDER, resolveRemoteValues } from '../core/sync.js';
import { findRepoRoot } from '../utils/git.js';
import { log } from '../utils/output.js';

export interface PullOptions {
  /** overwrite existing files completely instead of only filling missing keys */
  force?: boolean;
}

export async function pullCommand(options: PullOptions, bw = new BwClient()): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  const config = loadConfig(repoRoot);

  log.info(`Project: ${pc.bold(config.project)}`);

  await bw.preflight();
  await bw.sync();

  const folder = await bw.findFolder(ENVSYNC_FOLDER);
  const projectItem = folder ? await bw.findItem(folder.id, config.project) : null;

  if (!projectItem) {
    throw new BitwardenError(
      `No item "${config.project}" found in the Bitwarden "${ENVSYNC_FOLDER}" folder.\n` +
        `The project owner needs to run \`envsync push\` first ` +
        `(or you may not have access to the item).`,
    );
  }

  const remote = await resolveRemoteValues(bw, config, projectItem);

  let filesWritten = 0;
  let keysWritten = 0;

  for (const [filePath, entry] of Object.entries(config.files)) {
    const values = remote.values[filePath] ?? {};
    const abs = join(repoRoot, filePath);
    const exampleAbs = join(repoRoot, entry.example);

    let doc: DotenvDocument;
    let added: string[];

    if (existsSync(abs) && !options.force) {
      // Fill mode: only add keys that are missing locally
      doc = parseDotenv(readFileSync(abs, 'utf8'));
      const existing = getEntries(doc);
      added = [];
      for (const key of Object.keys(entry.keys)) {
        const hasLocal = existing[key] !== undefined && existing[key] !== '';
        if (!hasLocal && values[key] !== undefined) {
          setEntry(doc, key, values[key]);
          added.push(key);
        }
      }
      if (added.length === 0) continue;
    } else {
      // Create mode (or --force): start from the example file as template
      doc = existsSync(exampleAbs)
        ? parseDotenv(readFileSync(exampleAbs, 'utf8'))
        : { lines: [] };
      added = [];
      for (const key of Object.keys(entry.keys)) {
        if (values[key] !== undefined) {
          setEntry(doc, key, values[key]);
          added.push(key);
        } else {
          setEntry(doc, key, ''); // key exists but no remote value -> leave blank
        }
      }
    }

    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, serializeDotenv(doc), 'utf8');
    chmodSync(abs, 0o600);
    filesWritten++;
    keysWritten += added.length;
    log.success(`${filePath}: ${added.length} key(s) written`);
  }

  for (const missing of remote.missing) {
    log.warn(`${missing}: not found in Bitwarden, left blank`);
  }

  if (filesWritten === 0) {
    log.success('All local env files already have values. Nothing to do.');
  } else {
    log.success(
      `Done: ${filesWritten} file(s), ${keysWritten} key(s) from ` +
        `${ENVSYNC_FOLDER}/${config.project}`,
    );
  }
}
