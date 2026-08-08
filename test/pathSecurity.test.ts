import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('rejects a path that only appears to be within the root through a symbolic link', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'markda-path-security-'));
    const allowed = path.join(temporary, 'allowed');
    const outside = path.join(temporary, 'outside');
    const linked = path.join(allowed, 'linked');
    try {
      await Promise.all([mkdir(allowed), mkdir(outside)]);
      await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
      await writeFile(path.join(outside, 'document.md'), 'outside');
      const target = path.join(linked, 'document.md');
      expect(isPathInside(allowed, target)).toBe(true);
      await expect(isRealPathInside(allowed, target)).resolves.toBe(false);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
