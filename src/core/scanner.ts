import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Directories that are never scanned (dependencies, build output, VCS) */
export const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'bower_components',
  '.venv',
  'venv',
  '.virtualenv',
  '__pycache__',
  'site-packages',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  '.idea',
  '.vscode',
]);

const EXAMPLE_SUFFIX = '.example';

/** Basenames we treat as env files: .env, .env.*, .dev.vars, .dev.vars.* */
function isEnvBasename(name: string): boolean {
  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    name === '.dev.vars' ||
    name.startsWith('.dev.vars.')
  );
}

/**
 * A pair of (actual env file, example file) sharing the same base path.
 * Either side may be missing.
 */
export interface EnvFileGroup {
  /** repo-relative path of the actual values file, e.g. "apps/web/.env" */
  path: string;
  /** repo-relative path of the example file, e.g. "apps/web/.env.example" */
  examplePath: string;
  hasActual: boolean;
  hasExample: boolean;
}

/**
 * Recursively scan a repository for env files and group them with their
 * example counterparts.
 */
export function scanEnvFiles(rootDir: string): EnvFileGroup[] {
  const found: string[] = [];
  walk(rootDir, rootDir, found);

  // Group by the "actual" path: strip .example suffix when present
  const groups = new Map<string, EnvFileGroup>();

  for (const relPath of found) {
    const isExample = relPath.endsWith(EXAMPLE_SUFFIX);
    const actualPath = isExample ? relPath.slice(0, -EXAMPLE_SUFFIX.length) : relPath;

    let group = groups.get(actualPath);
    if (!group) {
      group = {
        path: actualPath,
        examplePath: actualPath + EXAMPLE_SUFFIX,
        hasActual: false,
        hasExample: false,
      };
      groups.set(actualPath, group);
    }
    if (isExample) {
      group.hasExample = true;
    } else {
      group.hasActual = true;
    }
  }

  return [...groups.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function walk(rootDir: string, dir: string, found: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — skip
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      walk(rootDir, join(dir, entry.name), found);
    } else if (entry.isFile() && isEnvBasename(entry.name)) {
      found.push(relative(rootDir, join(dir, entry.name)).replace(/\\/g, '/'));
    }
  }
}
