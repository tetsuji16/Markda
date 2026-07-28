import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConfiguration } = vi.hoisted(() => ({
  getConfiguration: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: { getConfiguration },
}));

import { getEditorSettings } from '../src/settings.js';

describe('editor settings', () => {
  beforeEach(() => {
    getConfiguration.mockReset();
  });

  it('uses the persisted global theme for every resource', () => {
    getConfiguration.mockReturnValue({
      get: vi.fn((key: string, fallback: unknown) => key === 'editor.themeMode' ? 'light' : fallback),
      inspect: vi.fn(() => ({ globalValue: 'dark' })),
    });

    expect(getEditorSettings({} as never).themeMode).toBe('dark');
  });

  it('keeps the effective setting until a global theme has been selected', () => {
    getConfiguration.mockReturnValue({
      get: vi.fn((key: string, fallback: unknown) => key === 'editor.themeMode' ? 'light' : fallback),
      inspect: vi.fn(() => ({ workspaceValue: 'light' })),
    });

    expect(getEditorSettings({} as never).themeMode).toBe('light');
  });

  it('uses the active in-memory theme while persistence is still pending', () => {
    getConfiguration.mockReturnValue({
      get: vi.fn((key: string, fallback: unknown) => key === 'editor.themeMode' ? 'light' : fallback),
      inspect: vi.fn(() => ({ globalValue: 'light' })),
    });

    expect(getEditorSettings({} as never, 'dark').themeMode).toBe('dark');
  });

  it('reports whether Markda keybindings have priority', () => {
    getConfiguration.mockReturnValue({
      get: vi.fn((key: string, fallback: unknown) => key === 'editor.enableDefaultKeybindings' ? true : fallback),
      inspect: vi.fn(() => ({})),
    });

    expect(getEditorSettings({} as never).enableDefaultKeybindings).toBe(true);
  });
});
