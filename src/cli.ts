import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import pc from 'picocolors';

import { initCommand } from './commands/init.js';
import { pushCommand } from './commands/push.js';
import { pullCommand } from './commands/pull.js';
import { statusCommand } from './commands/status.js';
import { BitwardenError } from './bitwarden/bw.js';
import { ConfigError } from './core/config.js';
import { NotARepoError } from './utils/git.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
    return pkg.version as string;
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

program
  .name('envsync')
  .description('Sync .env files to Bitwarden — commit the mapping, not the secrets.')
  .version(getVersion());

program
  .command('init')
  .description('Scan the repo for env files and generate the .envsync mapping')
  .option('-y, --yes', 'skip prompts and accept defaults')
  .action((opts) => run(() => initCommand(opts)));

program
  .command('push')
  .description('Upload local env values to Bitwarden')
  .option('--dry-run', 'show what would be pushed without writing')
  .action((opts) => run(() => pushCommand({ dryRun: opts.dryRun })));

program
  .command('pull')
  .description('Generate local env files from Bitwarden values')
  .option('-f, --force', 'overwrite existing files instead of only filling missing keys')
  .action((opts) => run(() => pullCommand({ force: opts.force })));

program
  .command('status')
  .description('Compare local env values with Bitwarden')
  .action(() => run(() => statusCommand()));

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (
      err instanceof BitwardenError ||
      err instanceof ConfigError ||
      err instanceof NotARepoError
    ) {
      console.error(pc.red('✗ ') + err.message);
      process.exit(1);
    }
    throw err;
  }
}

program.parseAsync().catch((err) => {
  console.error(pc.red('✗ Unexpected error: ') + (err as Error).message);
  process.exit(1);
});
