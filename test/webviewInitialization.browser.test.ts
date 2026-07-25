/// <reference types="@vitest/browser/providers/playwright" />

import { describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForElement(selector: string): Promise<HTMLElement> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

describe('live Markdown initialization in Chromium', () => {
  it('starts live preview when the initial viewport contains math and block widgets', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize',
      uri: 'file:///initialization.md',
      resourceBaseUri: 'http://localhost/',
      themeBaseUri: 'http://localhost/',
      assetBaseUri: '/src/webview/',
      version: 1,
      text: [
        '# Live preview',
        '',
        'Destination line.',
        '',
        'Hard-wrapped prose should use',
        'the remaining editor width.',
        '',
        'Explicit hard break.  ',
        'Next visual line.',
        '',
        'Markdown: **bold text**',
        '',
        'Inline math: $E = mc^2$',
        '',
        '| Item | Status |',
        '| --- | --- |',
        '| Preview | OK |',
        '',
        '```ts',
        'const ready = true;',
        '```',
      ].join('\n'),
      settings: {
        contentWidth: 520,
        autoPairMarkdown: true,
        typewriterKeepCentered: true,
        previewUpdateDelay: 500,
        liveTableMaxCells: 600,
        themeMode: 'auto',
        markdown: { math: true, diagrams: false, html: false, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => undefined,
      setState: vi.fn(),
      postMessage: vi.fn(),
    }));

    const { __getEditorView } = await import('../src/webview/main.js');
    await settle();

    const view = __getEditorView();
    expect(document.querySelector('.markda-meta')).not.toBeNull();
    expect(document.querySelector('.markda-inline-math')).not.toBeNull();
    expect(document.querySelector('.markda-live-table-wrap')).not.toBeNull();
    expect(document.querySelector('.markda-live-code')).not.toBeNull();

    const textRect = (text: string): DOMRect => {
      const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const offset = node.textContent?.indexOf(text) ?? -1;
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        return range.getBoundingClientRect();
      }
      throw new Error(`Unable to find rendered text: ${text}`);
    };
    const wrappedFirst = textRect('Hard-wrapped');
    const wrappedSecond = textRect('the remaining');
    expect(document.querySelectorAll('.markda-soft-break')).toHaveLength(1);
    expect(Math.abs(wrappedFirst.top - wrappedSecond.top)).toBeLessThanOrEqual(2);
    expect(wrappedSecond.left).toBeGreaterThan(wrappedFirst.left);
    expect(Math.abs(textRect('Explicit hard break.').top - textRect('Next visual line.').top)).toBeGreaterThan(2);

    const accessibleMath = await waitForElement('.markda-inline-math .katex-mathml');
    const visualMath = await waitForElement('.markda-inline-math .katex-html');
    // KaTeX emits both accessible MathML and visual HTML. Without katex.css the
    // two representations are displayed side by side, which duplicates and
    // corrupts every formula in the editor.
    expect(getComputedStyle(accessibleMath).position).toBe('absolute');
    expect(accessibleMath.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    expect(getComputedStyle(visualMath).fontFamily).toContain('KaTeX_Main');

    view.focus();
    const source = view.state.doc.toString();
    const destination = source.indexOf('Destination') + 4;
    const clickDestination = async (): Promise<void> => {
      const coordinates = view.coordsAtPos(destination);
      expect(coordinates).not.toBeNull();
      const clientX = coordinates!.left + 1;
      const clientY = (coordinates!.top + coordinates!.bottom) / 2;
      const target = document.elementFromPoint(clientX, clientY);
      expect(target).not.toBeNull();
      target!.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1, clientX, clientY,
      }));
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, detail: 1, clientX, clientY,
      }));
      await settle();
      expect(view.state.selection.main.empty).toBe(true);
      expect(view.state.selection.main.head).toBe(destination);
    };
    const boldFrom = source.indexOf('bold text');
    view.dispatch({ selection: { anchor: boldFrom, head: boldFrom + 'bold text'.length } });
    await settle();
    expect(document.querySelectorAll('.markda-meta-expanded')).toHaveLength(2);

    await clickDestination();
    expect(document.querySelector('.markda-meta-expanded')).toBeNull();
    expect(document.querySelector('.markda-strong')?.textContent).toBe('bold text');

    const mathFrom = source.indexOf('E = mc^2');
    view.dispatch({ selection: { anchor: mathFrom, head: mathFrom + 'E = mc^2'.length } });
    await settle();
    expect(document.querySelector('.markda-inline-math-source')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-command="toggleBold"]')!.focus();
    await settle();
    expect(document.querySelector('.markda-inline-math-source')).toBeNull();
    expect(document.querySelector('.markda-inline-math')).not.toBeNull();

    view.focus();
    view.dispatch({ selection: { anchor: mathFrom, head: mathFrom + 'E = mc^2'.length } });
    await settle();
    expect(document.querySelector('.markda-inline-math-source')).not.toBeNull();

    await clickDestination();
    expect(document.querySelector('.markda-inline-math-source')).toBeNull();
    expect(document.querySelector('.markda-inline-math')).not.toBeNull();
  });
});
