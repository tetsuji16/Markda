import type { TextChange } from './protocol.js';

/** Returns the smallest single replacement that transforms before into after. */
export function findMinimalChange(before: string, after: string): TextChange {
  let from = 0;
  const limit = Math.min(before.length, after.length);
  while (from < limit && before.charCodeAt(from) === after.charCodeAt(from)) from++;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > from && afterEnd > from && before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)) {
    beforeEnd--;
    afterEnd--;
  }
  return { from, to: beforeEnd, insert: after.slice(from, afterEnd) };
}

export function applyTextChange(source: string, change: TextChange): string {
  return source.slice(0, change.from) + change.insert + source.slice(change.to);
}
