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

/**
 * Checks the closest existing ancestor when `child` has not been created yet.
 * This prevents a not-yet-created destination from escaping through a symlink
 * in one of its existing parent directories.
 */
export async function isRealPathOrNearestParentInside(parent: string, child: string): Promise<boolean> {
  let candidate = path.resolve(child);
  while (true) {
    try {
      const [resolvedParent, resolvedCandidate] = await Promise.all([realpath(parent), realpath(candidate)]);
      return isPathInside(resolvedParent, resolvedCandidate);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') return false;
      const next = path.dirname(candidate);
      if (next === candidate) return false;
      candidate = next;
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
