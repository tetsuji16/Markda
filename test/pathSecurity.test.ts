import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { isPathInside, isRealPathInside } from '../src/pathSecurity.js';

describe('isPathInside', () => {
  const root = path.resolve('workspace', 'note-folder');

  it('accepts paths in the allowed directory', () => {
    expect(isPathInside(root, path.join(root, 'note.assets', 'image.png'))).toBe(true);
  });

  it('rejects a configured folder that escapes a standalone document directory', () => {
    expect(isPathInside(root, path.resolve(root, '..', 'outside', 'image.png'))).toBe(false);
  });

  it('fails closed when a managed image does not exist', async () => {
    await expect(isRealPathInside(root, path.join(root, 'missing.png'))).resolves.toBe(false);
  });
});
