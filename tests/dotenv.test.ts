import { describe, expect, it } from 'vitest';

import {
  getEntries,
  getKeys,
  parseDotenv,
  serializeDotenv,
  setEntry,
  toExample,
} from '../src/core/dotenv.js';

describe('parseDotenv', () => {
  it('parses simple entries', () => {
    const doc = parseDotenv('FOO=bar\nBAZ=qux');
    expect(getEntries(doc)).toEqual({ FOO: 'bar', BAZ: 'qux' });
  });

  it('parses comments and blank lines', () => {
    const doc = parseDotenv('# header\n\nFOO=bar\n');
    expect(doc.lines).toEqual([
      { type: 'comment', raw: '# header' },
      { type: 'blank' },
      expect.objectContaining({ type: 'entry', key: 'FOO', value: 'bar' }),
    ]);
  });

  it('parses double-quoted values with escapes', () => {
    const doc = parseDotenv('MSG="hello \\"world\\"\\nbye"');
    expect(getEntries(doc)).toEqual({ MSG: 'hello "world"\nbye' });
  });

  it('parses single-quoted values literally', () => {
    const doc = parseDotenv("PASS='p@$$w0rd#123'");
    expect(getEntries(doc)).toEqual({ PASS: 'p@$$w0rd#123' });
  });

  it('strips inline comments from unquoted values', () => {
    const doc = parseDotenv('PORT=3000 # the port');
    expect(getEntries(doc)).toEqual({ PORT: '3000' });
    const line = doc.lines[0];
    expect(line.type === 'entry' && line.inlineComment).toBe('# the port');
  });

  it('keeps # inside unquoted value without space', () => {
    const doc = parseDotenv('COLOR=#ff0000');
    expect(getEntries(doc)).toEqual({ COLOR: '#ff0000' });
  });

  it('handles export prefix', () => {
    const doc = parseDotenv('export FOO=bar');
    expect(getEntries(doc)).toEqual({ FOO: 'bar' });
    const line = doc.lines[0];
    expect(line.type === 'entry' && line.exported).toBe(true);
  });

  it('handles empty values', () => {
    const doc = parseDotenv('EMPTY=\nALSO_EMPTY=""');
    expect(getEntries(doc)).toEqual({ EMPTY: '', ALSO_EMPTY: '' });
  });

  it('preserves unparseable lines as raw', () => {
    const doc = parseDotenv('this is not valid');
    expect(doc.lines[0]).toEqual({ type: 'raw', raw: 'this is not valid' });
  });

  it('last occurrence wins for duplicate keys', () => {
    const doc = parseDotenv('A=1\nA=2');
    expect(getEntries(doc)).toEqual({ A: '2' });
  });
});

describe('serializeDotenv', () => {
  it('round-trips a typical file', () => {
    const content = [
      '# Database',
      'DATABASE_URL=postgres://localhost/dev',
      '',
      '# API keys',
      'API_KEY="sk-123 456"',
      'export DEBUG=true',
      'EMPTY=',
    ].join('\n');
    const doc = parseDotenv(content);
    expect(serializeDotenv(doc)).toBe(content + '\n');
  });

  it('quotes values with spaces when serializing new entries', () => {
    const doc = parseDotenv('');
    setEntry(doc, 'MSG', 'hello world');
    expect(serializeDotenv(doc)).toBe('MSG="hello world"\n');
  });

  it('preserves inline comments', () => {
    const content = 'PORT=3000 # the port';
    expect(serializeDotenv(parseDotenv(content))).toBe(content + '\n');
  });
});

describe('setEntry', () => {
  it('updates existing entries in place', () => {
    const doc = parseDotenv('# comment\nFOO=old\nBAR=keep');
    setEntry(doc, 'FOO', 'new');
    expect(serializeDotenv(doc)).toBe('# comment\nFOO=new\nBAR=keep\n');
  });

  it('appends new entries at the end', () => {
    const doc = parseDotenv('FOO=bar');
    setEntry(doc, 'NEW', 'value');
    expect(getEntries(doc)).toEqual({ FOO: 'bar', NEW: 'value' });
  });
});

describe('toExample', () => {
  it('empties all values but keeps structure', () => {
    const doc = parseDotenv('# Database config\nDATABASE_URL=postgres://secret\n\nAPI_KEY="sk-123"');
    const example = toExample(doc);
    expect(serializeDotenv(example)).toBe('# Database config\nDATABASE_URL=\n\nAPI_KEY=\n');
    // original untouched
    expect(getEntries(doc).DATABASE_URL).toBe('postgres://secret');
  });
});

describe('getKeys', () => {
  it('returns keys in order of first appearance', () => {
    const doc = parseDotenv('B=1\nA=2\nB=3');
    expect(getKeys(doc)).toEqual(['B', 'A']);
  });
});
