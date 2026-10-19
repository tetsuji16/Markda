import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('VS Code host localization bundles', () => {
  it('covers every runtime message with matching placeholders and preserved terms', () => {
    const root = resolve(process.cwd());
    const result = spawnSync(process.execPath, ['scripts/generate-runtime-localizations.mjs', '--check'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
