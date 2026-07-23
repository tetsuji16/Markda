/// <reference types="@vitest/browser/providers/playwright" />

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';

const settings = {
  contentWidth: 520,
  autoPairMarkdown: true,
  typewriterKeepCentered: true,
  previewUpdateDelay: 500,
  liveTableMaxCells: 600,
  themeMode: 'auto' as const,
  markdown: { math: false, diagrams: false, html: false, breaks: false },
  theme: { light: 'paper', dark: 'midnight' },
  security: { allowRemoteResources: 'never' as const, allowUnsafeHtml: false },
};

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('editable widget history in Chromium', () => {
  it('keeps the viewport stable when Ctrl+Z restores a code block edit', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const originalCode = [
      'y_pred = torch.sigmoid(torch.tensor([0.5, -1.2]))',
      'print(f"Predictions: {y_pred.tolist()}")',
    ].join('\n');
    const changedPrediction = 'print(f"Predictions: {y_pred.tolist()}!")';
    const text = [
      ...Array.from({ length: 45 }, (_, index) => `Leading paragraph ${index + 1}.`),
      '',
      '```js',
      originalCode,
      '```',
      '',
      'Trailing paragraph.',
    ].join('\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize',
      uri: 'file:///widget-undo.md',
      resourceBaseUri: 'http://localhost/',
      themeBaseUri: 'http://localhost/',
      version: 1,
      text,
      settings,
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => undefined,
      setState: vi.fn(),
      postMessage: vi.fn(),
    }));

    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();
    const view = __getEditorView();
    const codePosition = text.indexOf(originalCode);
    view.dispatch({
      selection: EditorSelection.cursor(0),
      effects: EditorView.scrollIntoView(codePosition, { y: 'center' }),
    });
    await settle();

    const code = view.dom.querySelector<HTMLElement>('.markda-live-code code[contenteditable="true"]')!;
    expect(code).toBeTruthy();
    const beforeUndoScrollTop = view.scrollDOM.scrollTop;
    expect(beforeUndoScrollTop).toBeGreaterThan(0);
    code.focus();
    // Chromium commonly represents a contenteditable newline as an implicit
    // break before a div. textContent concatenates these nodes and used to
    // commit a corrupt code block before Undo ran.
    const secondLine = document.createElement('div');
    secondLine.textContent = changedPrediction;
    code.replaceChildren(document.createTextNode(originalCode.split('\n')[0] ?? ''), secondLine);
    code.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(view.state.doc.toString()).toContain(`${originalCode.split('\n')[0]}\n${changedPrediction}`);

    code.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    await settle();

    expect(view.state.doc.toString()).toContain(originalCode);
    expect(Math.abs(view.scrollDOM.scrollTop - beforeUndoScrollTop)).toBeLessThanOrEqual(2);
  });
});
