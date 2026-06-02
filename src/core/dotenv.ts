/**
 * Minimal dotenv parser/serializer that preserves comments, blank lines and
 * key order so files can be round-tripped without losing structure.
 */

export type DotenvLine =
  | {
      type: 'entry';
      key: string;
      value: string;
      /** `export ` prefix present */
      exported: boolean;
      /** quote style used in the source, null = unquoted */
      quote: '"' | "'" | null;
      /** trailing inline comment, including the leading `#` */
      inlineComment: string | null;
    }
  | { type: 'comment'; raw: string }
  | { type: 'blank' }
  /** anything we can't parse — preserved verbatim */
  | { type: 'raw'; raw: string };

export interface DotenvDocument {
  lines: DotenvLine[];
}

const ENTRY_RE = /^(export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/;

export function parseDotenv(content: string): DotenvDocument {
  const lines: DotenvLine[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      lines.push({ type: 'blank' });
      continue;
    }
    if (trimmed.startsWith('#')) {
      lines.push({ type: 'comment', raw: rawLine });
      continue;
    }

    const match = ENTRY_RE.exec(trimmed);
    if (!match) {
      lines.push({ type: 'raw', raw: rawLine });
      continue;
    }

    const [, exportPrefix, key, rest] = match;
    const { value, quote, inlineComment } = parseValue(rest);
    lines.push({
      type: 'entry',
      key,
      value,
      exported: Boolean(exportPrefix),
      quote,
      inlineComment,
    });
  }

  // Drop trailing blank produced by a final newline
  if (lines.length > 0 && lines[lines.length - 1].type === 'blank') {
    lines.pop();
  }

  return { lines };
}

function parseValue(rest: string): {
  value: string;
  quote: '"' | "'" | null;
  inlineComment: string | null;
} {
  const trimmed = rest.trim();

  for (const q of ['"', "'"] as const) {
    if (trimmed.startsWith(q)) {
      const end = findClosingQuote(trimmed, q);
      if (end > 0) {
        const value = trimmed.slice(1, end);
        const after = trimmed.slice(end + 1).trim();
        return {
          value: q === '"' ? unescapeDoubleQuoted(value) : value,
          quote: q,
          inlineComment: after.startsWith('#') ? after : null,
        };
      }
    }
  }

  // Unquoted: an inline comment starts at " #"
  const commentIdx = trimmed.search(/\s#/);
  if (commentIdx >= 0) {
    return {
      value: trimmed.slice(0, commentIdx).trim(),
      quote: null,
      inlineComment: trimmed.slice(commentIdx).trim(),
    };
  }
  return { value: trimmed, quote: null, inlineComment: null };
}

function findClosingQuote(str: string, quote: '"' | "'"): number {
  for (let i = 1; i < str.length; i++) {
    if (str[i] === '\\' && quote === '"') {
      i++; // skip escaped char inside double quotes
      continue;
    }
    if (str[i] === quote) return i;
  }
  return -1;
}

function unescapeDoubleQuoted(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function escapeDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Whether a value needs quoting when serialized */
function needsQuotes(value: string): boolean {
  return /[\s#'"\\\n]/.test(value) || value === '';
}

export function serializeDotenv(doc: DotenvDocument): string {
  const out: string[] = [];

  for (const line of doc.lines) {
    switch (line.type) {
      case 'blank':
        out.push('');
        break;
      case 'comment':
      case 'raw':
        out.push(line.raw);
        break;
      case 'entry': {
        const prefix = line.exported ? 'export ' : '';
        let valueStr: string;
        if (line.quote === '"' || (line.quote === null && needsQuotes(line.value) && line.value !== '')) {
          valueStr = `"${escapeDoubleQuoted(line.value)}"`;
        } else if (line.quote === "'") {
          valueStr = `'${line.value}'`;
        } else {
          valueStr = line.value;
        }
        const comment = line.inlineComment ? ` ${line.inlineComment}` : '';
        out.push(`${prefix}${line.key}=${valueStr}${comment}`);
        break;
      }
    }
  }

  return out.join('\n') + '\n';
}

/** Extract key → value map (last occurrence wins, mirroring dotenv behavior) */
export function getEntries(doc: DotenvDocument): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const line of doc.lines) {
    if (line.type === 'entry') entries[line.key] = line.value;
  }
  return entries;
}

/** List keys in order of first appearance */
export function getKeys(doc: DotenvDocument): string[] {
  const keys: string[] = [];
  for (const line of doc.lines) {
    if (line.type === 'entry' && !keys.includes(line.key)) keys.push(line.key);
  }
  return keys;
}

/** Update an existing entry's value, or append a new entry at the end */
export function setEntry(doc: DotenvDocument, key: string, value: string): void {
  for (const line of doc.lines) {
    if (line.type === 'entry' && line.key === key) {
      line.value = value;
      return;
    }
  }
  doc.lines.push({
    type: 'entry',
    key,
    value,
    exported: false,
    quote: null,
    inlineComment: null,
  });
}

/**
 * Build an example document from an actual file: same structure
 * (comments, order, blank lines) but all values emptied.
 */
export function toExample(doc: DotenvDocument): DotenvDocument {
  return {
    lines: doc.lines.map((line) =>
      line.type === 'entry' ? { ...line, value: '', quote: null } : { ...line },
    ),
  };
}
