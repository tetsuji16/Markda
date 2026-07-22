/// <reference types="@vitest/browser/providers/playwright" />

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
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function textCharacterRect(element: Element, offset: number): DOMRect {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (remaining < length) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.setEnd(node, remaining + 1);
      return range.getBoundingClientRect();
    }
    remaining -= length;
  }
  throw new Error(`Text offset ${offset} is not rendered`);
}

function documentCharacterRect(view: ReturnType<typeof import('../src/webview/main.js')['__getEditorView']>, position: number): DOMRect {
  const point = view.domAtPos(position);
  if (point.node.nodeType === Node.TEXT_NODE && point.offset < (point.node.textContent?.length ?? 0)) {
    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.setEnd(point.node, point.offset + 1);
    return range.getBoundingClientRect();
  }
  const coordinates = view.coordsAtPos(position);
  if (!coordinates) throw new Error(`Position ${position} is not rendered`);
  return new DOMRect(coordinates.left, coordinates.top, Math.max(1, coordinates.right - coordinates.left), coordinates.bottom - coordinates.top);
}

describe('live Markdown pointer geometry in Chromium', () => {
  it('keeps normal and wrapped text under the pointer across block re-layout and scrolling', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize',
      uri: 'file:///browser-cursor.md',
      resourceBaseUri: 'http://localhost/',
      themeBaseUri: 'http://localhost/',
      version: 1,
      text: ['First ordinary paragraph.', 'Second ordinary paragraph.', 'Third ordinary paragraph.'].join('\n'),
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

    const clickPosition = async (position: number, line: Element, offset?: number): Promise<void> => {
      const character = offset === undefined ? documentCharacterRect(view, position) : textCharacterRect(line, offset);
      const clickX = character.left + Math.min(1, character.width / 3);
      const clickY = (character.top + character.bottom) / 2;
      const nativePoint = document.caretPositionFromPoint(clickX, clickY);
      expect(nativePoint && view.posAtDOM(nativePoint.offsetNode, nativePoint.offset)).toBe(position);
      line.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1, clientX: clickX, clientY: clickY,
      }));
      // The logical selection must be correct on mousedown—there must be no
      // transient highlight on the line returned by CodeMirror's stale height map.
      expect(view.state.selection.main.head).toBe(position);
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, cancelable: true, button: 0, detail: 1, clientX: clickX, clientY: clickY,
      }));
      line.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, button: 0, detail: 1, clientX: clickX, clientY: clickY,
      }));
      await settle();
      expect(view.state.selection.main.head).toBe(position);
      const browserSelection = window.getSelection();
      const caretTop = browserSelection?.rangeCount ? browserSelection.getRangeAt(0).getBoundingClientRect().top : Number.POSITIVE_INFINITY;
      expect(Math.abs(caretTop - documentCharacterRect(view, position).top)).toBeLessThanOrEqual(2);
    };

    const ordinaryPosition = view.state.doc.line(2).from + 7;
    const ordinaryLine = view.contentDOM.querySelectorAll('.cm-line')[1]!;
    await clickPosition(ordinaryPosition, ordinaryLine, 7);

    const inlineDocument = ['Before **bold** and [Link](https://example.com) after.', 'Destination line.'].join('\n');
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: inlineDocument }, selection: { anchor: 0 } });
    await settle();
    const boldPosition = inlineDocument.indexOf('bold') + 1;
    const bold = view.dom.querySelector('.markda-strong')!;
    await clickPosition(boldPosition, bold, 1);
    expect(view.dom.querySelectorAll('.markda-meta-expanded')).toHaveLength(2);

    const destinationPosition = inlineDocument.indexOf('Destination') + 4;
    const destinationLine = view.contentDOM.querySelectorAll('.cm-line')[1]!;
    await clickPosition(destinationPosition, destinationLine, 4);
    expect(view.dom.querySelector('.markda-meta-expanded')).toBeNull();
    expect(view.dom.querySelector('.markda-strong')?.textContent).toBe('bold');

    const longParagraph = 'A wrapped ordinary paragraph '.repeat(14).trim();
    const sourceDocument = [
      '| Name | Value |',
      '| --- | ---: |',
      '| one | 1 |',
      '',
      '$$',
      'x^2 + y^2',
      '$$',
      '',
      '> [!NOTE]',
      '> Stable callout widget.',
      '',
      '![pixel](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==)',
      '',
      '```text',
      ...Array.from({ length: 12 }, (_, index) => `rendered block line ${index + 1}`),
      '```',
      '',
      longParagraph,
      '',
      ...Array.from({ length: 24 }, (_, index) => `Trailing paragraph ${index + 1}.`),
    ].join('\n');
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: sourceDocument },
      selection: { anchor: 0 },
    });
    await settle();

    const visiblePosition = view.state.doc.toString().indexOf('Trailing paragraph 1.') + 7;
    view.dispatch({ effects: EditorView.scrollIntoView(visiblePosition, { y: 'center' }) });
    await settle();
    expect(view.scrollDOM.scrollTop).toBeGreaterThan(0);
    const domPoint = view.domAtPos(visiblePosition);
    const visibleOrdinaryLine = (domPoint.node instanceof Element ? domPoint.node : domPoint.node.parentElement)?.closest('.cm-line');
    expect(visibleOrdinaryLine).not.toBeNull();
    await clickPosition(visiblePosition, visibleOrdinaryLine!);

    const dragHead = view.state.doc.toString().indexOf('Trailing paragraph 3.') + 10;
    const dragStartRect = documentCharacterRect(view, visiblePosition);
    const dragHeadRect = documentCharacterRect(view, dragHead);
    visibleOrdinaryLine!.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, cancelable: true, button: 0, buttons: 1, detail: 1,
      clientX: dragStartRect.left + 1, clientY: (dragStartRect.top + dragStartRect.bottom) / 2,
    }));
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, cancelable: true, button: 0, buttons: 1,
      clientX: dragHeadRect.left + 1, clientY: (dragHeadRect.top + dragHeadRect.bottom) / 2,
    }));
    expect(view.state.selection.main.anchor).toBe(visiblePosition);
    expect(view.state.selection.main.head).toBe(dragHead);
    const liveSelection = window.getSelection()!;
    expect(view.posAtDOM(liveSelection.anchorNode!, liveSelection.anchorOffset)).toBe(visiblePosition);
    expect(view.posAtDOM(liveSelection.focusNode!, liveSelection.focusOffset)).toBe(dragHead);
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, cancelable: true, button: 0,
      clientX: dragHeadRect.left + 1, clientY: (dragHeadRect.top + dragHeadRect.bottom) / 2,
    }));
    await settle();
    expect(view.state.selection.main.from).toBe(visiblePosition);
    expect(view.state.selection.main.to).toBe(dragHead);
  });
});
