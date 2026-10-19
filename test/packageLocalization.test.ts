import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('package localization catalogs', () => {
  it('validates catalogs and manifest without writing files', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-package-localizations.mjs', '--check'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
