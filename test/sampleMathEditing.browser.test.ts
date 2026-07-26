/// <reference types="@vitest/browser/providers/playwright" />

import { page, userEvent } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('sample-style display math editing in Chromium', () => {
  it('opens and edits indented single-line display math with a real pointer click', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const text = [
      '### 1. 数式 & テキスト装飾',
      '- **インライン数式**: オイラーの等式 $e^{i\\pi} + 1 = 0$ や `MSE` 計算式。',
      '- **ブロック数式**:',
      '  $$J(\\theta) = -\\frac{1}{m} \\sum_{i=1}^{m} y^{(i)}$$',
      '',
      '### 2. データ処理フロー',
    ].join('\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///sample.md', resourceBaseUri: 'http://localhost/', themeBaseUri: '',
      version: 1, text,
      settings: {
        contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
        previewUpdateDelay: 500, liveTableMaxCells: 600, themeMode: 'light',
        markdown: { math: true, diagrams: false, html: false, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => undefined, setState: vi.fn(), postMessage: vi.fn(),
    }));

    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();
    await vi.waitUntil(() => view.dom.querySelector('.markda-block-math .katex'), { timeout: 5_000 });
    await page.getByRole('button', { name: 'Edit math source', exact: true }).click();

    const source = view.dom.querySelector<HTMLTextAreaElement>(
      '.markda-block-math-wrap .markda-block-source-editor:not([hidden])',
    );
    expect(source).not.toBeNull();
    expect(document.activeElement).toBe(source);

    await userEvent.keyboard('{Control>}a{/Control}x^3');
    source!.blur();
    await settle();

    expect(view.state.doc.toString()).toContain('  $$x^3$$');
    expect(view.state.doc.toString()).toContain('- **ブロック数式**:');
  });
});
