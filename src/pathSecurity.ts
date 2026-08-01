import * as path from 'node:path';
import { realpath } from 'node:fs/promises';

/**
 * Returns whether a resolved path remains within a resolved parent directory.
 * This is intentionally lexical: callers that operate on symlinks must resolve
 * those separately before performing a destructive operation.
 */
export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Resolves filesystem links before applying the containment check. An unreadable
 * or missing path is not considered safe for operations that change files.
 */
export async function isRealPathInside(parent: string, child: string): Promise<boolean> {
  try {
    const [resolvedParent, resolvedChild] = await Promise.all([realpath(parent), realpath(child)]);
    return isPathInside(resolvedParent, resolvedChild);
  } catch {
    return false;
  }
}
