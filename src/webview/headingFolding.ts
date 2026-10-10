import {
  codeFolding, foldEffect, foldGutter, foldService, foldedRanges, unfoldEffect,
} from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { headingAnchors } from '../markdownFeatures.js';
import type { HeadingAnchor } from '../markdownFeatures.js';
import type { EditorView } from '@codemirror/view';

export interface HeadingFoldRange {
  readonly heading: HeadingAnchor;
  /** The position immediately after the heading line. */
  readonly from: number;
  /** The start of the next heading line (or document end). */
  readonly to: number;
}

/** Compute content-only fold ranges, respecting heading levels and Markdown fences. */
export function headingFoldRanges(markdown: string): readonly HeadingFoldRange[] {
  const headings = headingAnchors(markdown);
  const lines = markdown.match(/[^\r\n]*(?:\r\n|\r|\n|$)/gu)?.filter(Boolean) ?? [];
  const lineStarts: number[] = [];
  const lineEnds: number[] = [];
  let offset = 0;
  for (const raw of lines) {
    lineStarts.push(offset);
    const content = raw.replace(/[\r\n]+$/u, '');
    lineEnds.push(offset + content.length);
    offset += raw.length;
  }
  const headingRows: { heading: HeadingAnchor; line: number; from: number; to: number }[] = [];
  let line = 0;
  for (const heading of headings) {
    while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= heading.from) line++;
    const setextUnderline = lines[line + 1]?.replace(/[\r\n]+$/u, '').match(/^\s{0,3}(?:=+|-+)\s*$/u);
    const from = lineEnds[setextUnderline ? line + 1 : line];
    if (from !== undefined) headingRows.push({ heading, line, from, to: markdown.length });
  }
  // A heading's section ends at the first following heading of the same or higher level.
  const stack: number[] = [];
  for (let index = 0; index < headingRows.length; index++) {
    const row = headingRows[index]!;
    while (stack.length && headingRows[stack[stack.length - 1]!]!.heading.level >= row.heading.level) {
      const ancestor = headingRows[stack.pop()!]!;
      // Leave the newline before the sibling heading in the document so the
      // heading remains a separate rendered block after its preceding fold.
      ancestor.to = lineEnds[row.line - 1] ?? lineStarts[row.line]!;
    }
    stack.push(index);
  }
  return headingRows.flatMap(({ heading, from, to }) => to > from ? [{ heading, from, to }] : []);
}

interface CachedRanges {
  readonly ranges: readonly HeadingFoldRange[];
  readonly byLine: ReadonlyMap<number, HeadingFoldRange>;
}

const rangeCache = new WeakMap<EditorState['doc'], CachedRanges>();

function rangesFor(state: EditorState): readonly HeadingFoldRange[] {
  let cached = rangeCache.get(state.doc);
  if (!cached) {
    const ranges = headingFoldRanges(state.doc.toString());
    cached = {
      ranges,
      byLine: new Map(ranges.map((range) => [state.doc.lineAt(range.heading.from).from, range])),
    };
    rangeCache.set(state.doc, cached);
  }
  return cached.ranges;
}

function rangeAtLine(state: EditorState, lineStart: number): HeadingFoldRange | undefined {
  rangesFor(state);
  return rangeCache.get(state.doc)?.byLine.get(lineStart);
}

/** CodeMirror heading folding with a compact gutter marker that appears on hover. */
export function headingFolding(): Extension {
  return [
    codeFolding({ placeholderText: '…' }),
    foldService.of((state, lineStart) => {
      const range = rangeAtLine(state, lineStart);
      return range ? { from: range.from, to: range.to } : null;
    }),
    foldGutter({
      openText: '⌄',
      closedText: '›',
      markerDOM(open) {
        const marker = document.createElement('span');
        marker.className = `cm-headingFoldMarker${open ? ' is-open' : ' is-closed'}`;
        marker.textContent = open ? '⌄' : '›';
        marker.setAttribute('aria-hidden', 'true');
        return marker;
      },
    }),
  ];
}

function headingRangeAt(view: EditorView, offset = view.state.selection.main.head): HeadingFoldRange | undefined {
  const ranges = rangesFor(view.state);
  const safeOffset = Math.max(0, Math.min(offset, view.state.doc.length));
  const lineStart = view.state.doc.lineAt(safeOffset).from;
  const exact = rangeCache.get(view.state.doc)?.byLine.get(lineStart);
  if (exact) return exact;
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle]!.heading.from <= safeOffset) low = middle + 1;
    else high = middle;
  }
  return ranges[low - 1];
}

export function toggleHeadingFold(view: EditorView, offset?: number): boolean {
  const range = headingRangeAt(view, offset);
  if (!range) return false;
  view.dispatch({ effects: isFolded(view.state, range)
    ? unfoldEffect.of({ from: range.from, to: range.to })
    : foldEffect.of({ from: range.from, to: range.to }) });
  return true;
}

export function foldAllHeadings(view: EditorView): boolean {
  const ranges = outermostRanges(rangesFor(view.state)).filter((range) => !isFolded(view.state, range));
  if (!ranges.length) return false;
  view.dispatch({ effects: ranges.map(({ from, to }) => foldEffect.of({ from, to })) });
  return true;
}

export function unfoldAllHeadings(view: EditorView): boolean {
  const ranges: { from: number; to: number }[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => { ranges.push({ from, to }); });
  if (!ranges.length) return false;
  view.dispatch({ effects: ranges.map(({ from, to }) => unfoldEffect.of({ from, to })) });
  return true;
}

export function focusCurrentSection(view: EditorView): boolean {
  const current = headingRangeAt(view);
  if (!current) return false;
  const ranges = rangesFor(view.state);
  const toFold: HeadingFoldRange[] = [];
  const effects = [];
  for (const range of ranges) {
    const ancestor = range.heading.from < current.heading.from && range.to >= current.heading.from;
    if (ancestor || range.heading.from === current.heading.from) {
      if (isFolded(view.state, range)) effects.push(unfoldEffect.of({ from: range.from, to: range.to }));
    } else toFold.push(range);
  }
  for (const range of outermostRanges(toFold)) {
    if (!isFolded(view.state, range)) effects.push(foldEffect.of({ from: range.from, to: range.to }));
  }
  if (!effects.length) return false;
  view.dispatch({ effects });
  return true;
}

function outermostRanges(ranges: readonly HeadingFoldRange[]): HeadingFoldRange[] {
  const result: HeadingFoldRange[] = [];
  let coveringEnd = -1;
  for (const range of ranges) {
    if (range.heading.from < coveringEnd) continue;
    result.push(range);
    coveringEnd = range.to;
  }
  return result;
}

/** Unfold any folded section that currently contains the target position. */
export function unfoldContaining(view: EditorView, position: number): boolean {
  const safePosition = Math.max(0, Math.min(position, view.state.doc.length));
  const ranges: { from: number; to: number }[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    if (from <= safePosition && safePosition < to) ranges.push({ from, to });
  });
  if (!ranges.length) return false;
  view.dispatch({ effects: ranges.map((range) => unfoldEffect.of(range)) });
  return true;
}

function isFolded(state: EditorState, range: HeadingFoldRange): boolean {
  let found = false;
  foldedRanges(state).between(range.from, range.to, (from, to) => {
    if (from === range.from && to === range.to) found = true;
  });
  return found;
}
