import { describe, expect, it } from 'vitest';

import { fieldName, filePrefix, keyFromFieldName } from '../src/core/fieldname.js';

describe('filePrefix', () => {
  it('strips leading dot from root files', () => {
    expect(filePrefix('.env')).toBe('env');
    expect(filePrefix('.env.production')).toBe('env.production');
    expect(filePrefix('.dev.vars')).toBe('dev.vars');
    expect(filePrefix('.dev.vars.staging')).toBe('dev.vars.staging');
  });

  it('keeps directory path for nested files', () => {
    expect(filePrefix('apps/web/.env')).toBe('apps/web/env');
    expect(filePrefix('packages/api/.dev.vars')).toBe('packages/api/dev.vars');
  });

  it('normalizes windows separators', () => {
    expect(filePrefix('apps\\web\\.env')).toBe('apps/web/env');
  });
});

describe('fieldName', () => {
  it('joins prefix and key with a dash', () => {
    expect(fieldName('.env', 'DATABASE_URL')).toBe('env-DATABASE_URL');
    expect(fieldName('.env.production', 'API_KEY')).toBe('env.production-API_KEY');
    expect(fieldName('apps/web/.env', 'VITE_API_URL')).toBe('apps/web/env-VITE_API_URL');
  });
});

describe('keyFromFieldName', () => {
  it('extracts the key when prefix matches', () => {
    expect(keyFromFieldName('env-DATABASE_URL', '.env')).toBe('DATABASE_URL');
    expect(keyFromFieldName('apps/web/env-VITE_API_URL', 'apps/web/.env')).toBe('VITE_API_URL');
  });

  it('returns null when prefix does not match', () => {
    expect(keyFromFieldName('env.production-API_KEY', '.env')).toBeNull();
  });

  it('handles keys containing dashes', () => {
    expect(keyFromFieldName('env-MY-WEIRD-KEY', '.env')).toBe('MY-WEIRD-KEY');
  });
});
