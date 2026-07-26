/// <reference types="@vitest/browser/providers/playwright" />

import { userEvent } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('VS Code-style document search in Chromium', () => {
  it('keeps CodeMirror document search while presenting a compact themed find widget', async () => {
    document.body.className = 'vscode-dark';
    (globalThis as typeof globalThis & { __markdaInitial?: unknown }).__markdaInitial = {
      type: 'initialize', uri: 'file:///search-browser.md', resourceBaseUri: 'http://localhost/', themeBaseUri: '',
      version: 1, text: ['# Search', '', 'alpha beta alpha', '', 'Alpha'].join('\n'), locale: 'en',
      settings: {
        contentWidth: 860, autoPairMarkdown: true, typewriterKeepCentered: true,
        previewUpdateDelay: 500, liveTableMaxCells: 600, themeMode: 'light',
        markdown: { math: false, diagrams: false, html: false, breaks: false },
        theme: { light: 'paper', dark: 'midnight' },
        security: { allowRemoteResources: 'never', allowUnsafeHtml: false },
      },
    };
    vi.stubGlobal('acquireVsCodeApi', () => ({
      getState: () => ({
        schemaVersion: 2, sourceMode: false, focusMode: false, typewriterMode: false, previewVisible: false,
      }),
      setState: vi.fn(),
      postMessage: vi.fn(),
    }));

    await import('../src/webview/main.js');
    await settle();

    const content = document.querySelector<HTMLElement>('.cm-content')!;
    await userEvent.click(content);
    await userEvent.keyboard('{Control>}f{/Control}');
    await settle();

    const panel = document.querySelector<HTMLElement>('.cm-panel.cm-search')!;
    const panels = panel.parentElement!;
    const search = panel.querySelector<HTMLInputElement>('input[name=search]')!;
    const replace = panel.querySelector<HTMLInputElement>('input[name=replace]')!;
    const replaceToggle = panel.querySelector<HTMLButtonElement>('.markda-replace-toggle')!;
    expect(panel).not.toBeNull();
    expect(getComputedStyle(panels).position).toBe('absolute');
    expect(getComputedStyle(panel).display).toBe('grid');
    expect(getComputedStyle(panel).backgroundColor).toBe('rgb(243, 243, 243)');
    expect(getComputedStyle(panel).boxShadow).not.toBe('none');
    expect(getComputedStyle(search).height).toBe('24px');
    expect(panel.classList.contains('markda-replace-collapsed')).toBe(true);
    expect(replaceToggle.getAttribute('aria-expanded')).toBe('false');
    expect(getComputedStyle(replace).display).toBe('none');
    expect(replaceToggle.getBoundingClientRect().left).toBeLessThan(search.getBoundingClientRect().left);
    for (const control of panel.querySelectorAll<HTMLElement>('button, label')) {
      expect(getComputedStyle(control).fontSize).toBe('0px');
      if (getComputedStyle(control).display === 'none') continue;
      expect(control.getBoundingClientRect().width).toBe(24);
      expect(control.getBoundingClientRect().height).toBe(24);
    }

    await userEvent.keyboard('alpha');
    await settle();
    expect(document.querySelectorAll('.cm-searchMatch')).toHaveLength(3);

    const textBeforeNavigation = content.textContent;
    await userEvent.keyboard('{Enter}');
    await settle();
    expect(document.activeElement).toBe(search);
    expect(document.querySelectorAll('.cm-searchMatch-selected')).toHaveLength(1);
    const firstMatchLeft = document.querySelector<HTMLElement>('.cm-searchMatch-selected')!.getBoundingClientRect().left;
    await userEvent.keyboard('{Enter}');
    await settle();
    expect(document.activeElement).toBe(search);
    expect(document.querySelector<HTMLElement>('.cm-searchMatch-selected')!.getBoundingClientRect().left).toBeGreaterThan(firstMatchLeft);
    expect(content.textContent).toBe(textBeforeNavigation);
    expect(document.querySelectorAll('.cm-searchMatch')).toHaveLength(3);

    const caseToggle = panel.querySelector<HTMLInputElement>('input[name=case]')!;
    await userEvent.click(caseToggle.closest('label')!);
    await settle();
    expect(caseToggle.checked).toBe(true);
    expect(document.querySelectorAll('.cm-searchMatch')).toHaveLength(2);

    await userEvent.click(panel.querySelector<HTMLButtonElement>('button[name=next]')!);
    await settle();
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.querySelectorAll('.cm-searchMatch-selected')).toHaveLength(1);

    const collapsedHeight = panel.getBoundingClientRect().height;
    await userEvent.click(replaceToggle);
    await settle();
    expect(panel.classList.contains('markda-replace-collapsed')).toBe(false);
    expect(replaceToggle.getAttribute('aria-expanded')).toBe('true');
    expect(getComputedStyle(replace).display).not.toBe('none');
    expect(panel.getBoundingClientRect().height).toBeGreaterThan(collapsedHeight);
    expect(replace.getBoundingClientRect().top).toBeGreaterThan(search.getBoundingClientRect().top);

    document.querySelector<HTMLButtonElement>('#theme-toggle')!.click();
    await settle();
    expect(getComputedStyle(panel).backgroundColor).toBe('rgb(37, 37, 38)');

    search.focus();
    await userEvent.keyboard('{Escape}');
    await settle();
    expect(document.querySelector('.cm-panel.cm-search')).toBeNull();
    expect(document.activeElement).toBe(content);
    await userEvent.keyboard('omega');
    await settle();
    expect(content.textContent).toContain('omega');
  });
});
