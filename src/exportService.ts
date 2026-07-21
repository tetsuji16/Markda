import * as path from 'node:path';
import * as vscode from 'vscode';
import { createMarkdownRenderer, extractTitle } from './markdown.js';
import { createHtmlDocument } from './htmlExport.js';

interface PreviousExport {
  source: string;
  destination: string;
  styled: boolean;
}

export class ExportService {
  private previous?: PreviousExport;

  async exportHtml(document: vscode.TextDocument, styled: boolean, destination?: vscode.Uri): Promise<void> {
    const target = destination ?? await this.chooseDestination(document.uri);
    if (!target) return;
    const markdown = document.getText();
    const documentConfig = vscode.workspace.getConfiguration('markda', document.uri);
    const renderer = createMarkdownRenderer({
      breaks: documentConfig.get('markdown.breaks', false),
      html: documentConfig.get('markdown.html', true) && documentConfig.get('security.allowUnsafeHtml', false),
    });
    const body = renderer.render(markdown);
    const html = styled
      ? createHtmlDocument(extractTitle(markdown, path.basename(document.fileName)), body)
      : body;
    await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
    this.previous = { source: document.uri.toString(), destination: target.toString(), styled };
    void vscode.window.showInformationMessage(`markda: Exported ${path.basename(target.fsPath)}`);
  }

  async exportPrevious(document: vscode.TextDocument): Promise<void> {
    if (!this.previous || this.previous.source !== document.uri.toString()) {
      void vscode.window.showWarningMessage('markda: This document has no previous export.');
      return;
    }
    await this.exportHtml(document, this.previous.styled, vscode.Uri.parse(this.previous.destination));
  }

  private async chooseDestination(source: vscode.Uri): Promise<vscode.Uri | undefined> {
    const config = vscode.workspace.getConfiguration('markda', source);
    const sameFolder = config.get<string>('export.defaultFolder', 'ask') === 'same';
    const suggested = source.with({ path: source.path.replace(/\.[^/.]+$/u, '') + '.html' });
    if (sameFolder) return suggested;
    return vscode.window.showSaveDialog({
      defaultUri: suggested,
      filters: { HTML: ['html', 'htm'] },
      saveLabel: 'Export',
    });
  }
}
