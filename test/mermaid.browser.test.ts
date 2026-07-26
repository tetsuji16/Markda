/// <reference types="@vitest/browser/providers/playwright" />

import { describe, expect, it, vi } from 'vitest';

async function waitForMermaid(selector: string): Promise<HTMLElement> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const rendered = document.querySelector<HTMLElement>(selector);
    if (rendered?.querySelector('svg')) return rendered;
    if (rendered?.classList.contains('markda-render-error')) throw new Error(rendered.title);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  throw new Error('Mermaid did not render within 15 seconds');
}

function expectVisibleLabels(rendered: HTMLElement): void {
  for (const label of ['Edit Markdown', 'Update preview', 'Save file']) {
    const text = Array.from(rendered.querySelectorAll<SVGTextElement>('text'))
      .find((element) => element.textContent?.includes(label));
    expect(text, `missing SVG text label: ${label}`).toBeDefined();
    expect(text!.getBoundingClientRect().width, `zero-width SVG text label: ${label}`).toBeGreaterThan(0);
    expect(getComputedStyle(text!).fill).not.toBe('none');
  }
}

describe('Mermaid rendering in Chromium', () => {
  it('renders every flowchart label visibly in the editor and preview', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    const source = [
      'flowchart LR',
      '  Edit[Edit Markdown] --> Preview[Update preview]',
      '  Preview --> Save[Save file]',
    ].join('\n');
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///mermaid.md', resourceBaseUri: 'http://localhost/', themeBaseUri: '',
      version: 1, text: ['```mermaid', source, '```'].join('\n'),
      settings: {
        contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
        previewUpdateDelay: 0, liveTableMaxCells: 600, themeMode: 'light',
        markdown: { math: false, diagrams: true, html: false, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => ({
        schemaVersion: 2, sourceMode: false, focusMode: false, typewriterMode: false, previewVisible: true,
      }),
      setState: vi.fn(),
      postMessage: vi.fn(),
    }));

    await import('../src/webview/main.js');
    expect(document.querySelector('#preview-button')).toBeNull();
    const rendered = await waitForMermaid('[data-markda-renderer="mermaid"]');

    expect(rendered.querySelector('foreignObject')).toBeNull();
    expect(rendered.textContent).toContain('Edit Markdown');
    expect(rendered.textContent).toContain('Update preview');
    expect(rendered.textContent).toContain('Save file');
    expectVisibleLabels(rendered);

    const previewDiagram = await waitForMermaid('#preview .markda-diagram');
    expect(previewDiagram.textContent).toContain('Edit Markdown');
    expect(previewDiagram.textContent).toContain('Update preview');
    expect(previewDiagram.textContent).toContain('Save file');
    expectVisibleLabels(previewDiagram);
  });
});
