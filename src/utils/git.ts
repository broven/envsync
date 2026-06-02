import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

export class NotARepoError extends Error {
  constructor(dir: string) {
    super(`Not a git repository: ${dir}\nenvsync must be run inside a git repository.`);
  }
}

/** Resolve the git repository root for a directory */
export function findRepoRoot(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new NotARepoError(cwd);
  }
}

/** Default project name = repository directory name */
export function defaultProjectName(repoRoot: string): string {
  return basename(repoRoot);
}

/** Check which of the given repo-relative paths are NOT covered by .gitignore */
export function findUnignoredPaths(repoRoot: string, relPaths: string[]): string[] {
  if (relPaths.length === 0) return [];
  try {
    const stdout = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: repoRoot,
      encoding: 'utf8',
      input: relPaths.join('\n'),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const ignored = new Set(stdout.split('\n').filter(Boolean));
    return relPaths.filter((p) => !ignored.has(p));
  } catch (err) {
    // git check-ignore exits 1 when NO paths are ignored
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) {
      const ignored = new Set((e.stdout ?? '').split('\n').filter(Boolean));
      return relPaths.filter((p) => !ignored.has(p));
    }
    throw err;
  }
}
