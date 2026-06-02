import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as p from '@clack/prompts';
import pc from 'picocolors';

import {
  configExists,
  loadConfig,
  mergeConfig,
  saveConfig,
  CONFIG_FILENAME,
  SCHEMA_URL,
  type EnvsyncConfig,
  type FileEntry,
} from '../core/config.js';
import { getKeys, parseDotenv, serializeDotenv, setEntry, toExample } from '../core/dotenv.js';
import { scanEnvFiles } from '../core/scanner.js';
import { defaultProjectName, findRepoRoot, findUnignoredPaths } from '../utils/git.js';
import { log } from '../utils/output.js';

export interface InitOptions {
  /** skip prompts, accept defaults */
  yes?: boolean;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());

  // Prompts only make sense in an interactive terminal. In scripts, CI or
  // when piped (e.g. some `npx` setups), fall back to defaults — same as --yes.
  const interactive = !options.yes && process.stdin.isTTY === true;

  p.intro(pc.bgCyan(pc.black(' envsync init ')));

  // ── Scan ────────────────────────────────────────────────────────────────
  const groups = scanEnvFiles(repoRoot);
  if (groups.length === 0) {
    p.outro('No .env / .dev.vars files found in this repository.');
    return;
  }

  p.log.info(
    `Found ${groups.length} env file group(s):\n` +
      groups
        .map((g) => {
          const parts: string[] = [];
          if (g.hasActual) parts.push(g.path);
          if (g.hasExample) parts.push(g.examplePath);
          return '  ' + parts.join(', ');
        })
        .join('\n'),
  );

  // ── Generate missing example files & collect keys ───────────────────────
  const scannedFiles: Record<string, FileEntry> = {};
  const generatedExamples: string[] = [];
  const exampleUpdated: string[] = [];

  for (const group of groups) {
    const actualAbs = join(repoRoot, group.path);
    const exampleAbs = join(repoRoot, group.examplePath);

    // Case 2: actual exists but no example -> generate example from actual
    if (group.hasActual && !group.hasExample) {
      const actualDoc = parseDotenv(readFileSync(actualAbs, 'utf8'));
      writeFileSync(exampleAbs, serializeDotenv(toExample(actualDoc)), 'utf8');
      generatedExamples.push(group.examplePath);
      group.hasExample = true;
    }

    const exampleDoc = parseDotenv(readFileSync(exampleAbs, 'utf8'));
    let keys = getKeys(exampleDoc);

    // Keep the example file in sync: if the actual file has keys the example
    // is missing, add them to the example (keys only, no values)
    if (group.hasActual) {
      const actualKeys = getKeys(parseDotenv(readFileSync(actualAbs, 'utf8')));
      const missingInExample = actualKeys.filter((k) => !keys.includes(k));
      if (missingInExample.length > 0) {
        for (const key of missingInExample) setEntry(exampleDoc, key, '');
        writeFileSync(exampleAbs, serializeDotenv(exampleDoc), 'utf8');
        exampleUpdated.push(group.examplePath);
        keys = [...keys, ...missingInExample];
      }
    }

    if (keys.length === 0) continue;

    scannedFiles[group.path] = {
      example: group.examplePath,
      keys: Object.fromEntries(keys.map((k) => [k, true as const])),
    };
  }

  if (generatedExamples.length > 0) {
    p.log.success(`Generated example file(s):\n  ${generatedExamples.join('\n  ')}`);
  }
  if (exampleUpdated.length > 0) {
    p.log.success(`Added missing keys to example file(s):\n  ${exampleUpdated.join('\n  ')}`);
  }

  if (Object.keys(scannedFiles).length === 0) {
    p.outro('No environment variables found in any env file.');
    return;
  }

  // ── Build / merge config ────────────────────────────────────────────────
  let config: EnvsyncConfig;

  if (configExists(repoRoot)) {
    const existing = loadConfig(repoRoot);
    config = mergeConfig(existing, scannedFiles);
    p.log.info(`Merged scan results into existing ${CONFIG_FILENAME} (project: ${config.project})`);
  } else {
    let project = defaultProjectName(repoRoot);
    if (interactive) {
      const answer = await p.text({
        message: 'Bitwarden item name for this project',
        defaultValue: project,
        placeholder: project,
      });
      if (p.isCancel(answer)) {
        p.cancel('Cancelled.');
        process.exit(1);
      }
      project = answer || project;
    }
    config = {
      $schema: SCHEMA_URL,
      version: 1,
      project,
      files: scannedFiles,
    };
  }

  saveConfig(repoRoot, config);
  const totalKeys = Object.values(config.files).reduce(
    (sum, f) => sum + Object.keys(f.keys).length,
    0,
  );
  p.log.success(
    `Wrote ${CONFIG_FILENAME}: ${Object.keys(config.files).length} file(s), ${totalKeys} key(s)`,
  );

  // ── .gitignore check ────────────────────────────────────────────────────
  const actualFiles = Object.keys(config.files).filter((f) => existsSync(join(repoRoot, f)));
  const unignored = findUnignoredPaths(repoRoot, actualFiles);

  if (unignored.length > 0) {
    p.log.warn(
      `These env files are NOT covered by .gitignore:\n  ${unignored.join('\n  ')}`,
    );
    // Non-interactive: always add to .gitignore (the safe default)
    let addToGitignore = true;
    if (interactive) {
      const answer = await p.confirm({
        message: 'Add them to .gitignore?',
        initialValue: true,
      });
      addToGitignore = !p.isCancel(answer) && answer;
    }
    if (addToGitignore) {
      const gitignorePath = join(repoRoot, '.gitignore');
      const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
      const newline = existing.endsWith('\n') || existing === '' ? '' : '\n';
      appendFileSync(
        gitignorePath,
        `${newline}\n# envsync: local env files\n${unignored.join('\n')}\n`,
        'utf8',
      );
      p.log.success('Updated .gitignore');
    }
  }

  // ── Done ────────────────────────────────────────────────────────────────
  p.outro(
    `Next steps:\n` +
      `   ${pc.cyan('envsync push')}   upload local values to Bitwarden\n` +
      `   ${pc.dim(`git add ${CONFIG_FILENAME} *.example && git commit`)}`,
  );
}

// Re-export for testing without prompts
export { log };
