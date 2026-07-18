import * as vscode from 'vscode';
import type { EditorSettings } from './protocol.js';

export function getEditorSettings(uri?: vscode.Uri): EditorSettings {
  const config = vscode.workspace.getConfiguration('markda', uri);
  return {
    contentWidth: config.get('editor.contentWidth', 860),
    autoPairMarkdown: config.get('editor.autoPairMarkdown', true),
    typewriterKeepCentered: config.get('editor.typewriterKeepCentered', true),
    previewUpdateDelay: config.get('editor.previewUpdateDelay', 500),
    liveTableMaxCells: config.get('editor.liveTableMaxCells', 600),
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
