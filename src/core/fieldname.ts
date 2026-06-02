/**
 * Mapping between env file paths and Bitwarden custom field names.
 *
 * Field name = `<processed file path>-<KEY>` where the processed path is the
 * relative file path with the leading dot of the basename removed:
 *   .env                  -> env
 *   .env.production       -> env.production
 *   apps/web/.env         -> apps/web/env
 *   packages/api/.dev.vars -> packages/api/dev.vars
 */

/** Convert a repo-relative env file path to its field name prefix */
export function filePrefix(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  const lastSlash = normalized.lastIndexOf('/');
  const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : '';
  const base = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  return dir + base.replace(/^\./, '');
}

/** Build the Bitwarden field name for a key in a given env file */
export function fieldName(relPath: string, key: string): string {
  return `${filePrefix(relPath)}-${key}`;
}

/**
 * Parse a field name back into { prefix, key }.
 * Keys never contain `-`? They can (rare), so we can't split blindly.
 * Instead the caller provides the known prefix.
 */
export function keyFromFieldName(name: string, relPath: string): string | null {
  const prefix = `${filePrefix(relPath)}-`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : null;
}
