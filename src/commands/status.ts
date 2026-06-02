import pc from 'picocolors';

import { BwClient } from '../bitwarden/bw.js';
import { isExternalRef, loadConfig } from '../core/config.js';
import { ENVSYNC_FOLDER, readLocalState, resolveRemoteValues } from '../core/sync.js';
import { findRepoRoot } from '../utils/git.js';
import { log } from '../utils/output.js';

type KeyState = 'synced' | 'local-only' | 'remote-only' | 'different' | 'missing';

const STATE_DISPLAY: Record<KeyState, string> = {
  synced: pc.green('✓ synced'),
  'local-only': pc.yellow('↑ local only'),
  'remote-only': pc.cyan('↓ remote only'),
  different: pc.red('≠ different'),
  missing: pc.dim('∅ missing'),
};

export async function statusCommand(bw = new BwClient()): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  const config = loadConfig(repoRoot);
  const local = readLocalState(repoRoot, config);

  log.info(`Project: ${pc.bold(config.project)}\n`);

  await bw.preflight();
  await bw.sync();

  const folder = await bw.findFolder(ENVSYNC_FOLDER);
  const projectItem = folder ? await bw.findItem(folder.id, config.project) : null;
  const remote = await resolveRemoteValues(bw, config, projectItem);

  if (!projectItem) {
    log.warn(`No item "${config.project}" in Bitwarden yet — run \`envsync push\` first.\n`);
  }

  const counts: Record<KeyState, number> = {
    synced: 0,
    'local-only': 0,
    'remote-only': 0,
    different: 0,
    missing: 0,
  };

  for (const [filePath, entry] of Object.entries(config.files)) {
    console.log(pc.bold(pc.underline(filePath)));

    for (const [key, spec] of Object.entries(entry.keys)) {
      const localValue = local[filePath]?.[key];
      const remoteValue = remote.values[filePath]?.[key];
      const hasLocal = localValue !== undefined && localValue !== '';
      const hasRemote = remoteValue !== undefined;

      let state: KeyState;
      if (hasLocal && hasRemote) {
        state = localValue === remoteValue ? 'synced' : 'different';
      } else if (hasLocal) {
        state = 'local-only';
      } else if (hasRemote) {
        state = 'remote-only';
      } else {
        state = 'missing';
      }
      counts[state]++;

      const suffix = isExternalRef(spec)
        ? pc.dim(` (external: ${spec.folder}/${spec.item})`)
        : '';
      console.log(`  ${STATE_DISPLAY[state].padEnd(25)} ${key}${suffix}`);
    }
    console.log();
  }

  const summary = (Object.entries(counts) as [KeyState, number][])
    .filter(([, n]) => n > 0)
    .map(([state, n]) => `${n} ${state}`)
    .join(', ');
  log.info(pc.dim(`Summary: ${summary}`));

  if (counts['local-only'] > 0 || counts.different > 0) {
    log.info(pc.dim(`Run \`envsync push\` to upload local changes.`));
  }
  if (counts['remote-only'] > 0) {
    log.info(pc.dim(`Run \`envsync pull\` to fetch remote values.`));
  }
}
