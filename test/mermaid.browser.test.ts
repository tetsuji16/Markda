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
  for (const label of ['Markdownを編集', 'プレビュー更新', 'ファイルを保存']) {
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
      '  Edit[Markdownを編集] --> Preview[プレビュー更新]',
      '  Preview --> Save[ファイルを保存]',
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
    vi.stubGlobal('acquireVsCodeApi', () => ({ getState: () => undefined, setState: vi.fn(), postMessage: vi.fn() }));

    await import('../src/webview/main.js');
    const rendered = await waitForMermaid('[data-markda-renderer="mermaid"]');

    expect(rendered.querySelector('foreignObject')).toBeNull();
    expect(rendered.textContent).toContain('Markdownを編集');
    expect(rendered.textContent).toContain('プレビュー更新');
    expect(rendered.textContent).toContain('ファイルを保存');
    expectVisibleLabels(rendered);

    document.querySelector<HTMLButtonElement>('#preview-button')!.click();
    const previewDiagram = await waitForMermaid('#preview .markda-diagram');
    expect(previewDiagram.textContent).toContain('Markdownを編集');
    expect(previewDiagram.textContent).toContain('プレビュー更新');
    expect(previewDiagram.textContent).toContain('ファイルを保存');
    expectVisibleLabels(previewDiagram);
  });
});
