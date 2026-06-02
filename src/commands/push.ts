import pc from 'picocolors';

import { BwClient } from '../bitwarden/bw.js';
import { loadConfig } from '../core/config.js';
import { buildPushPlan, ENVSYNC_FOLDER, readLocalState } from '../core/sync.js';
import { findRepoRoot } from '../utils/git.js';
import { log } from '../utils/output.js';

export interface PushOptions {
  /** show what would be pushed without writing to Bitwarden */
  dryRun?: boolean;
}

export async function pushCommand(options: PushOptions, bw = new BwClient()): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  const config = loadConfig(repoRoot);
  const local = readLocalState(repoRoot, config);

  log.info(`Project: ${pc.bold(config.project)}`);

  await bw.preflight();
  await bw.sync();

  const folder = await bw.ensureFolder(ENVSYNC_FOLDER);
  const existingItem = await bw.findItem(folder.id, config.project);

  const plan = buildPushPlan(config, local, existingItem);

  for (const name of plan.missingLocal) {
    log.warn(`${name}: no local value, skipped`);
  }
  for (const name of plan.external) {
    log.dim(`${name}: external reference, not pushed`);
  }

  if (plan.created.length === 0 && plan.updated.length === 0) {
    log.success('Everything up to date. Nothing to push.');
    return;
  }

  if (options.dryRun) {
    for (const name of plan.created) log.info(`  ${pc.green('+')} ${name}`);
    for (const name of plan.updated) log.info(`  ${pc.yellow('~')} ${name}`);
    log.info(pc.dim('\nDry run — nothing was written to Bitwarden.'));
    return;
  }

  if (existingItem) {
    await bw.updateItemFields(existingItem, plan.fields);
  } else {
    await bw.createSecureNote(folder.id, config.project, plan.fields);
  }
  await bw.sync();

  log.success(
    `Pushed to Bitwarden (${ENVSYNC_FOLDER}/${config.project}): ` +
      `${pc.green(`${plan.created.length} added`)}, ` +
      `${pc.yellow(`${plan.updated.length} updated`)}, ` +
      `${plan.unchanged.length} unchanged` +
      (plan.missingLocal.length > 0 ? pc.yellow(`, ${plan.missingLocal.length} skipped`) : ''),
  );
}
