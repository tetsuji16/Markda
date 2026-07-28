import * as vscode from 'vscode';
import type { EditorSettings } from './protocol.js';

export function getThemeMode(uri?: vscode.Uri): EditorSettings['themeMode'] {
  const config = vscode.workspace.getConfiguration('markda', uri);
  // The toolbar writes a user-wide preference. Read that target directly so a
  // resource/workspace override cannot make another document forget it.
  const configuredThemeMode = config.inspect<'auto' | 'light' | 'dark'>('editor.themeMode')?.globalValue;
  return configuredThemeMode ?? config.get<'auto' | 'light' | 'dark'>('editor.themeMode', 'auto');
}

export function getEditorSettings(uri?: vscode.Uri, themeMode = getThemeMode(uri)): EditorSettings {
  const config = vscode.workspace.getConfiguration('markda', uri);
  return {
    contentWidth: config.get('editor.contentWidth', 0),
    autoPairMarkdown: config.get('editor.autoPairMarkdown', true),
    typewriterKeepCentered: config.get('editor.typewriterKeepCentered', true),
    previewUpdateDelay: config.get('editor.previewUpdateDelay', 500),
    liveTableMaxCells: config.get('editor.liveTableMaxCells', 600),
    fontFamily: config.get('editor.fontFamily', ''),
    fontSize: config.get('editor.fontSize', 16),
    lineHeight: config.get('editor.lineHeight', 1.6),
    paragraphSpacing: config.get('editor.paragraphSpacing', 0),
    themeMode,
    enableDefaultKeybindings: config.get('editor.enableDefaultKeybindings', false),
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
