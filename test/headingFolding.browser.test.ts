/// <reference types="@vitest/browser/providers/playwright" />

import { foldedRanges } from '@codemirror/language';
import { describe, expect, it, vi } from 'vitest';
import { focusCurrentSection, foldAllHeadings, unfoldAllHeadings, unfoldContaining } from '../src/webview/headingFolding.js';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('heading folding in the live editor', () => {
  it('folds without changing Markdown, keeps widgets intact, and reveals nested focus and navigation targets', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const text = [
      '# Parent', '', 'Parent intro.', '', '## Nested', '', 'Nested content.', '',
      '$$', 'x^2', '$$', '',
      '| A | B |', '| --- | --- |', '| 1 | 2 |', '',
      '# Unrelated', '', 'Other content.',
    ].join('\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///folding.md', resourceBaseUri: 'http://localhost/', themeBaseUri: '',
      version: 1, text,
      settings: {
        contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
        previewUpdateDelay: 500, liveTableMaxCells: 600, themeMode: 'light',
        markdown: { math: true, diagrams: false, html: false, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => undefined, setState: vi.fn(), postMessage: vi.fn() }));
    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();
    await vi.waitUntil(() => view.dom.querySelector('.markda-live-table-wrap') !== null, { timeout: 5_000 });
    const original = view.state.doc.toString();
    expect(view.dom.querySelector('.markda-block-math-wrap')).not.toBeNull();

    expect(foldAllHeadings(view)).toBe(true);
    await settle();
    expect(view.state.doc.toString()).toBe(original);
    expect(view.dom.querySelector('.cm-foldPlaceholder')).not.toBeNull();
    expect(view.dom.querySelector('.markda-block-math-wrap')).toBeNull();
    expect(view.dom.querySelector('.markda-live-table-wrap')).toBeNull();
    expect(unfoldAllHeadings(view)).toBe(true);
    await settle();
    expect(view.dom.querySelector('.markda-block-math-wrap')).not.toBeNull();
    expect(view.dom.querySelector('.markda-live-table-wrap')).not.toBeNull();
    expect(view.state.doc.toString()).toBe(original);

    const nestedContent = original.indexOf('Nested content.') + 3;
    view.dispatch({ selection: { anchor: nestedContent } });
    foldAllHeadings(view);
    expect(focusCurrentSection(view)).toBe(true);
    await settle();
    let hidden = false;
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      if (from <= nestedContent && nestedContent < to) hidden = true;
    });
    expect(hidden).toBe(false);
    expect(view.dom.textContent).toContain('Nested content.');

    const target = original.indexOf('Other content.') + 2;
    foldAllHeadings(view);
    expect(unfoldContaining(view, target)).toBe(true);
    await settle();
    hidden = false;
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      if (from <= target && target < to) hidden = true;
    });
    expect(hidden).toBe(false);
    expect(view.state.doc.toString()).toBe(original);
  });
});
