import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CONFIG_FILENAME = '.envsync';
export const SCHEMA_URL = 'https://unpkg.com/@metajs/envsync/schema.json';

/** A key whose value lives in another Bitwarden folder/item (shared secret) */
export interface ExternalRef {
  folder: string;
  item: string;
  field: string;
}

/** `true` = stored in this project's own item; object = external reference */
export type KeySpec = true | ExternalRef;

export interface FileEntry {
  example: string;
  keys: Record<string, KeySpec>;
}

export interface EnvsyncConfig {
  $schema?: string;
  version: 1;
  project: string;
  files: Record<string, FileEntry>;
}

export class ConfigError extends Error {}

export function configPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_FILENAME);
}

export function configExists(repoRoot: string): boolean {
  return existsSync(configPath(repoRoot));
}

export function loadConfig(repoRoot: string): EnvsyncConfig {
  const path = configPath(repoRoot);
  if (!existsSync(path)) {
    throw new ConfigError(
      `No ${CONFIG_FILENAME} found in ${repoRoot}. Run \`envsync init\` first.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ConfigError(`${CONFIG_FILENAME} is not valid JSON: ${(err as Error).message}`);
  }

  return validateConfig(parsed);
}

export function saveConfig(repoRoot: string, config: EnvsyncConfig): void {
  const ordered: EnvsyncConfig = {
    $schema: config.$schema ?? SCHEMA_URL,
    version: 1,
    project: config.project,
    files: config.files,
  };
  writeFileSync(configPath(repoRoot), JSON.stringify(ordered, null, 2) + '\n', 'utf8');
}

export function validateConfig(data: unknown): EnvsyncConfig {
  if (typeof data !== 'object' || data === null) {
    throw new ConfigError(`${CONFIG_FILENAME} must be a JSON object`);
  }
  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    throw new ConfigError(`Unsupported ${CONFIG_FILENAME} version: ${String(obj.version)}`);
  }
  if (typeof obj.project !== 'string' || obj.project.trim() === '') {
    throw new ConfigError(`${CONFIG_FILENAME}: "project" must be a non-empty string`);
  }
  if (typeof obj.files !== 'object' || obj.files === null) {
    throw new ConfigError(`${CONFIG_FILENAME}: "files" must be an object`);
  }

  for (const [filePath, entry] of Object.entries(obj.files as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) {
      throw new ConfigError(`${CONFIG_FILENAME}: files["${filePath}"] must be an object`);
    }
    const fileEntry = entry as Record<string, unknown>;
    if (typeof fileEntry.example !== 'string') {
      throw new ConfigError(`${CONFIG_FILENAME}: files["${filePath}"].example must be a string`);
    }
    if (typeof fileEntry.keys !== 'object' || fileEntry.keys === null) {
      throw new ConfigError(`${CONFIG_FILENAME}: files["${filePath}"].keys must be an object`);
    }
    for (const [key, spec] of Object.entries(fileEntry.keys as Record<string, unknown>)) {
      if (spec === true) continue;
      if (typeof spec === 'object' && spec !== null) {
        const ref = spec as Record<string, unknown>;
        if (
          typeof ref.folder === 'string' &&
          typeof ref.item === 'string' &&
          typeof ref.field === 'string'
        ) {
          continue;
        }
      }
      throw new ConfigError(
        `${CONFIG_FILENAME}: files["${filePath}"].keys["${key}"] must be true or ` +
          `{ folder, item, field }`,
      );
    }
  }

  return obj as unknown as EnvsyncConfig;
}

export function isExternalRef(spec: KeySpec): spec is ExternalRef {
  return spec !== true;
}

/**
 * Merge freshly scanned files/keys into an existing config.
 *
 * Rules:
 * - existing project name and external references are always preserved
 * - new files / keys found by the scan are added
 * - nothing is ever removed automatically (the user may prune by hand)
 */
export function mergeConfig(
  existing: EnvsyncConfig,
  scanned: Record<string, FileEntry>,
): EnvsyncConfig {
  const files: Record<string, FileEntry> = {};

  // Start with everything from the existing config
  for (const [path, entry] of Object.entries(existing.files)) {
    files[path] = { example: entry.example, keys: { ...entry.keys } };
  }

  // Layer scanned results on top without clobbering external refs
  for (const [path, entry] of Object.entries(scanned)) {
    if (!files[path]) {
      files[path] = { example: entry.example, keys: { ...entry.keys } };
      continue;
    }
    files[path].example = entry.example;
    for (const [key, spec] of Object.entries(entry.keys)) {
      if (files[path].keys[key] === undefined) {
        files[path].keys[key] = spec;
      }
      // existing spec (true or external ref) wins — never downgraded
    }
  }

  return {
    $schema: existing.$schema ?? SCHEMA_URL,
    version: 1,
    project: existing.project,
    files,
  };
}
