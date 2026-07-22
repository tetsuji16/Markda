import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConfiguration, persistedTheme, updateThemeMode } = vi.hoisted(() => {
  const persistedTheme = { value: 'dark' as 'auto' | 'light' | 'dark' };
  const updateThemeMode = vi.fn(async (_key: string, value: 'auto' | 'light' | 'dark') => {
    persistedTheme.value = value;
  });
  return {
    persistedTheme,
    updateThemeMode,
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, fallback: unknown) => fallback),
      inspect: vi.fn(() => ({ globalValue: persistedTheme.value })),
      update: updateThemeMode,
    })),
  };
});

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
  ConfigurationTarget: { Global: 1 },
}));

import { MarkdaEditorProvider } from '../src/editorProvider.js';

describe('editor provider theme synchronization', () => {
  beforeEach(() => {
    persistedTheme.value = 'dark';
    updateThemeMode.mockClear();
  });

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

  it('accepts a toolbar theme change, broadcasts it, and persists it globally', async () => {
    let onDidReceiveMessage: ((message: unknown) => void) | undefined;
    const postMessage = vi.fn(async () => true);
    const panel = {
      active: true,
      webview: {
        options: {}, html: '', cspSource: 'test-source', postMessage,
        asWebviewUri: (uri: unknown) => uri,
        onDidReceiveMessage: vi.fn((listener: (message: unknown) => void) => {
          onDidReceiveMessage = listener;
          return { dispose: vi.fn() };
        }),
      },
      onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const document = {
      uri: { toString: () => 'file:///theme.md' }, version: 1, getText: () => '# Theme',
    };
    const context = {
      extensionUri: { toString: () => 'file:///extension' },
      globalStorageUri: { toString: () => 'file:///storage' },
    };
    const provider = new MarkdaEditorProvider(
      context as never,
      { update: vi.fn(), setCursor: vi.fn() } as never,
      { text: '', tooltip: '', show: vi.fn(), hide: vi.fn() } as never,
    );
    await provider.resolveCustomTextEditor(document as never, panel as never, {} as never);
    postMessage.mockClear();
    updateThemeMode.mockClear();

    onDidReceiveMessage?.({ type: 'updateThemeMode', mode: 'light' });
    await vi.waitFor(() => expect(updateThemeMode).toHaveBeenCalledWith('editor.themeMode', 'light', 1));

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'configurationChanged', settings: expect.objectContaining({ themeMode: 'light' }),
    }));
  });

  it('restores the globally persisted theme after the provider is restarted', async () => {
    const createProviderView = async () => {
      let receiveMessage: ((message: unknown) => void) | undefined;
      const postMessage = vi.fn(async () => true);
      const panel = {
        active: true,
        webview: {
          options: {}, html: '', cspSource: 'test-source', postMessage,
          asWebviewUri: (uri: unknown) => uri,
          onDidReceiveMessage: vi.fn((listener: (message: unknown) => void) => {
            receiveMessage = listener;
            return { dispose: vi.fn() };
          }),
        },
        onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
        onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      };
      const provider = new MarkdaEditorProvider(
        {
          extensionUri: { toString: () => 'file:///extension' },
          globalStorageUri: { toString: () => 'file:///storage' },
        } as never,
        { update: vi.fn(), setCursor: vi.fn() } as never,
        { text: '', tooltip: '', show: vi.fn(), hide: vi.fn() } as never,
      );
      await provider.resolveCustomTextEditor({
        uri: { toString: () => 'file:///restart.md' }, version: 1, getText: () => '# Restart',
      } as never, panel as never, {} as never);
      return { provider, postMessage, receive: (message: unknown) => receiveMessage?.(message) };
    };

    const beforeRestart = await createProviderView();
    beforeRestart.receive({ type: 'updateThemeMode', mode: 'light' });
    await vi.waitFor(() => expect(persistedTheme.value).toBe('light'));
    beforeRestart.provider.dispose();

    const afterRestart = await createProviderView();
    afterRestart.postMessage.mockClear();
    afterRestart.receive({ type: 'ready' });
    await vi.waitFor(() => expect(afterRestart.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'configurationChanged', settings: expect.objectContaining({ themeMode: 'light' }),
    })));
  });
});
