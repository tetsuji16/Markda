import { describe, expect, it, vi } from 'vitest';
import { CompositionCommitGate, domFragmentToMarkdown, liveEnterEdit } from '../src/webview/editorLogic.js';

describe('liveEnterEdit', () => {
  it('creates a real paragraph break in prose', () => {
    expect(liveEnterEdit('first paragraph', 15, false)).toEqual({
      from: 15, to: 15, insert: '\n\n', cursor: 17,
    });
  });

  it('uses a Markdown hard break for Shift+Enter', () => {
    expect(liveEnterEdit('first line', 10, true)?.insert).toBe('  \n');
    expect(liveEnterEdit('first line  ', 12, true)?.insert).toBe('\n');
  });

  it('leaves structural blocks to the Markdown keymap', () => {
    expect(liveEnterEdit('- item', 6, false)).toBeUndefined();
    expect(liveEnterEdit('> quote', 7, false)).toBeUndefined();
    expect(liveEnterEdit('```ts', 5, false)).toBeUndefined();
    expect(liveEnterEdit('# heading', 9, false)).toBeUndefined();
  });

  it('does not add a redundant blank line', () => {
    expect(liveEnterEdit('paragraph\n\nnext', 9, false)?.insert).toBe('\n');
  });

  it('preserves the document line ending', () => {
    expect(liveEnterEdit('one\r\ntwo', 8, false)?.insert).toBe('\r\n\r\n');
    expect(liveEnterEdit('one\r\ntwo', 8, true)?.insert).toBe('  \r\n');
  });

  it('keeps native newline behavior inside code fences', () => {
    const code = '```ts\nconst value = 1;\n```';
    expect(liveEnterEdit(code, code.indexOf(';'), false)).toBeUndefined();
    expect(liveEnterEdit(code, code.indexOf(';'), true)).toBeUndefined();
  });
});

describe('CompositionCommitGate', () => {
  it('does not commit partial IME composition text', () => {
    const commit = vi.fn();
    const gate = new CompositionCommitGate();
    gate.start();
    expect(gate.request(commit)).toBe(false);
    expect(commit).not.toHaveBeenCalled();
    gate.end(commit);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('flushes the final value when an editable cell loses focus', () => {
    const commit = vi.fn();
    const gate = new CompositionCommitGate();
    gate.start();
    gate.request(commit);
    gate.flush(commit);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('smart paste conversion', () => {
  it('converts common rich-text structures to Markdown', () => {
    const originalNode = globalThis.Node;
    const originalElement = globalThis.HTMLElement;
    class FakeText {
      readonly nodeType = 3;
      constructor(readonly textContent: string) {}
    }
    class FakeElement {
      readonly nodeType = 1;
      readonly childNodes: Array<FakeElement | FakeText>;
      readonly children: FakeElement[];
      parentElement: FakeElement | null = null;
      constructor(readonly tagName: string, children: Array<FakeElement | FakeText> = [], private readonly attributes: Record<string, string> = {}) {
        this.childNodes = children;
        this.children = children.filter((child): child is FakeElement => child instanceof FakeElement);
        for (const child of this.children) child.parentElement = this;
      }
      get textContent(): string { return this.childNodes.map((child) => child.textContent).join(''); }
      getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
      querySelectorAll(): FakeElement[] { return []; }
    }
    Object.assign(globalThis, { Node: { TEXT_NODE: 3 }, HTMLElement: FakeElement });
    try {
      const root = new FakeElement('BODY', [
        new FakeElement('H2', [new FakeText('Title')]),
        new FakeElement('P', [
          new FakeText('Use '), new FakeElement('STRONG', [new FakeText('bold')]), new FakeText(' and '),
          new FakeElement('A', [new FakeText('link')], { href: 'https://example.com/a b' }),
        ]),
        new FakeElement('UL', [new FakeElement('LI', [new FakeText('One')]), new FakeElement('LI', [new FakeText('Two')])]),
      ]);
      expect(domFragmentToMarkdown(root as unknown as ParentNode)).toBe('## Title\n\nUse **bold** and [link](https://example.com/a%20b)\n\n- One\n- Two');
    } finally {
      Object.assign(globalThis, { Node: originalNode, HTMLElement: originalElement });
    }
  });
});
