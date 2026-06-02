import pc from 'picocolors';

export const log = {
  info(msg: string): void {
    console.log(msg);
  },
  success(msg: string): void {
    console.log(pc.green('✓') + ' ' + msg);
  },
  warn(msg: string): void {
    console.warn(pc.yellow('⚠') + ' ' + msg);
  },
  error(msg: string): void {
    console.error(pc.red('✗') + ' ' + msg);
  },
  dim(msg: string): void {
    console.log(pc.dim(msg));
  },
};

/**
 * Mask a secret value for display: keep a short prefix, never reveal length.
 *   "sk-1234567890" -> "sk-1****"
 *   "abc"           -> "****"
 */
export function mask(value: string): string {
  if (value.length <= 4) return '****';
  return value.slice(0, 4) + '****';
}
