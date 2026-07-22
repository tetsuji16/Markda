import * as vscode from 'vscode';
import type { EditorSettings } from './protocol.js';

export function getEditorSettings(uri?: vscode.Uri): EditorSettings {
  const config = vscode.workspace.getConfiguration('markda', uri);
  const configuredThemeMode = config.inspect<'auto' | 'light' | 'dark'>('editor.themeMode')?.globalValue;
  return {
    contentWidth: config.get('editor.contentWidth', 0),
    autoPairMarkdown: config.get('editor.autoPairMarkdown', true),
    typewriterKeepCentered: config.get('editor.typewriterKeepCentered', true),
    previewUpdateDelay: config.get('editor.previewUpdateDelay', 500),
    liveTableMaxCells: config.get('editor.liveTableMaxCells', 600),
    // The toolbar controls a user-wide preference. Read its global value
    // directly so resource/workspace overrides cannot make another document
    // appear to forget the selection. `updateThemeMode` writes to this same
    // target, which also lets VS Code persist it across restarts.
    themeMode: configuredThemeMode ?? config.get<'auto' | 'light' | 'dark'>('editor.themeMode', 'auto'),
    markdown: {
      math: config.get('markdown.math', true),
      diagrams: config.get('markdown.diagrams', true),
      html: config.get('markdown.html', true),
      breaks: config.get('markdown.breaks', false),
    },
    security: {
      allowRemoteResources: config.get('security.allowRemoteResources', 'prompt'),
      allowUnsafeHtml: config.get('security.allowUnsafeHtml', false),
    },
    theme: {
      light: config.get('theme.light', 'paper'),
      dark: config.get('theme.dark', 'midnight'),
    },
  };
}
