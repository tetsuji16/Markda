import { describe, expect, it, vi } from 'vitest';

const { getConfiguration } = vi.hoisted(() => ({
  getConfiguration: vi.fn(() => ({
    get: vi.fn((_key: string, fallback: unknown) => fallback),
    inspect: vi.fn(() => ({ globalValue: 'dark' })),
    update: vi.fn(),
  })),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration,
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
  window: {
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
  },
  Uri: {
    joinPath: vi.fn((base: { toString(): string }, ...parts: string[]) => ({
      toString: () => `${base.toString()}/${parts.join('/')}`,
    })),
  },
}));

import { MarkdaEditorProvider } from '../src/editorProvider.js';

describe('editor provider theme synchronization', () => {
  it('re-sends the selected theme whenever another editor tab becomes active', async () => {
    let onDidChangeViewState: (() => void) | undefined;
    const postMessage = vi.fn(async () => true);
    const panel = {
      active: false,
      webview: {
        options: {}, html: '', cspSource: 'test-source', postMessage,
        asWebviewUri: (uri: unknown) => uri,
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidChangeViewState: vi.fn((listener: () => void) => {
        onDidChangeViewState = listener;
        return { dispose: vi.fn() };
      }),
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const document = {
      uri: { toString: () => 'file:///second.md' },
      version: 1,
      getText: () => '# Second file',
    };
    const context = {
      extensionUri: { toString: () => 'file:///extension' },
      globalStorageUri: { toString: () => 'file:///storage' },
    };
    const outline = { update: vi.fn(), setCursor: vi.fn() };
    const status = { text: '', tooltip: '', show: vi.fn(), hide: vi.fn() };
    const provider = new MarkdaEditorProvider(context as never, outline as never, status as never);

    await provider.resolveCustomTextEditor(document as never, panel as never, {} as never);
    panel.active = true;
    onDidChangeViewState?.();

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'configurationChanged',
      settings: expect.objectContaining({ themeMode: 'dark' }),
    }));
  });
});
