import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { createMarkdownRenderer, extractTitle } from './markdown.js';
import { createHtmlDocument } from './htmlExport.js';
import { substituteVariables } from './externalExport.js';

interface PreviousExport {
  source: string;
  destination: string;
  styled: boolean;
}

interface ExternalExportTarget {
  name: string;
  command: string;
  args?: readonly string[];
  extension?: string;
}

export class ExportService {
  private previous?: PreviousExport;
  private katexCss?: Promise<string>;

  constructor(private readonly extensionUri?: vscode.Uri) {}

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
      ? createHtmlDocument(extractTitle(markdown, path.basename(document.fileName)), body, vscode.env.language, await this.loadKatexCss())
      : body;
    await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
    this.previous = { source: document.uri.toString(), destination: target.toString(), styled };
    void vscode.window.showInformationMessage(vscode.l10n.t('markda: Exported {0}', path.basename(target.fsPath)));
  }

  async exportPdf(document: vscode.TextDocument, destination?: vscode.Uri): Promise<void> {
    const target = destination ?? await vscode.window.showSaveDialog({
      defaultUri: document.uri.with({ path: document.uri.path.replace(/\.[^/.]+$/u, '') + '.pdf' }),
      filters: { PDF: ['pdf'] },
      saveLabel: vscode.l10n.t('Export PDF'),
    });
    if (!target) return;
    const browser = await this.findPdfBrowser(document.uri);
    if (!browser) {
      void vscode.window.showErrorMessage(vscode.l10n.t('markda: PDF export requires Microsoft Edge, Google Chrome, or Chromium. Set markda.export.pdfBrowserPath if it is installed in a custom location.'));
      return;
    }
    const markdown = document.getText();
    const renderer = this.rendererFor(document);
    const body = renderer.render(markdown);
    const exportConfig = vscode.workspace.getConfiguration('markda', document.uri);
    const paper = exportConfig.get<string>('export.pdfPaperSize', 'A4');
    const safePaper = ['A4', 'A5', 'Letter', 'Legal'].includes(paper) ? paper : 'A4';
    const margin = Math.max(0, Math.min(80, exportConfig.get<number>('export.pdfMarginMm', 15)));
    const baseHref = pathToFileURL(`${path.dirname(document.uri.fsPath)}${path.sep}`).href;
    const html = createHtmlDocument(
      extractTitle(markdown, path.basename(document.fileName)),
      body,
      vscode.env.language,
      `${await this.loadKatexCss()}\n@page{size:${safePaper};margin:${margin}mm}`,
      baseHref,
    );
    const temporaryFolder = await mkdtemp(path.join(os.tmpdir(), 'markda-pdf-'));
    const temporaryHtml = path.join(temporaryFolder, 'document.html');
    try {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(temporaryHtml), Buffer.from(html, 'utf8'));
      const args = [
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        '--allow-file-access-from-files',
        `--print-to-pdf=${target.fsPath}`,
        pathToFileURL(temporaryHtml).href,
      ];
      await runProcess(browser, args, path.dirname(document.uri.fsPath));
      try {
        await vscode.workspace.fs.stat(target);
      } catch {
        throw new Error('The browser completed without creating the PDF file.');
      }
      void vscode.window.showInformationMessage(vscode.l10n.t('markda: Exported {0}', path.basename(target.fsPath)));
    } finally {
      await rm(temporaryFolder, { recursive: true, force: true });
    }
  }

  async exportImage(document: vscode.TextDocument, destination?: vscode.Uri): Promise<void> {
    const target = destination ?? await vscode.window.showSaveDialog({
      defaultUri: document.uri.with({ path: document.uri.path.replace(/\.[^/.]+$/u, '') + '.png' }),
      filters: { PNG: ['png'] },
      saveLabel: vscode.l10n.t('Export Image'),
    });
    if (!target) return;
    const browser = await this.findPdfBrowser(document.uri);
    if (!browser) {
      void vscode.window.showErrorMessage(vscode.l10n.t('markda: Image export requires Microsoft Edge, Google Chrome, or Chromium.'));
      return;
    }
    const config = vscode.workspace.getConfiguration('markda', document.uri);
    const width = Math.max(480, Math.min(2400, config.get<number>('export.imageWidth', 900)));
    const fontSize = Math.max(12, Math.min(48, config.get<number>('export.imageFontSize', 18)));
    const markdown = document.getText();
    const body = this.rendererFor(document).render(markdown);
    const baseHref = pathToFileURL(`${path.dirname(document.uri.fsPath)}${path.sep}`).href;
    const estimatedHeight = Math.max(720, Math.min(16_000,
      Math.ceil((markdown.split(/\r\n|\r|\n/u).length * fontSize * 1.7) + 180)));
    const html = createHtmlDocument(
      extractTitle(markdown, path.basename(document.fileName)),
      body,
      vscode.env.language,
      `${await this.loadKatexCss()}\nbody{font-size:${fontSize}px}.markda-export{max-width:${width - 80}px;padding:40px}`,
      baseHref,
    );
    const temporaryFolder = await mkdtemp(path.join(os.tmpdir(), 'markda-image-'));
    const temporaryHtml = path.join(temporaryFolder, 'document.html');
    try {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(temporaryHtml), Buffer.from(html, 'utf8'));
      await runProcess(browser, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
        `--window-size=${width},${estimatedHeight}`,
        `--screenshot=${target.fsPath}`,
        pathToFileURL(temporaryHtml).href,
      ], path.dirname(document.uri.fsPath));
      await vscode.workspace.fs.stat(target);
      void vscode.window.showInformationMessage(vscode.l10n.t('markda: Exported {0}', path.basename(target.fsPath)));
    } finally {
      await rm(temporaryFolder, { recursive: true, force: true });
    }
  }

  async exportExternal(document: vscode.TextDocument): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(vscode.l10n.t('markda: External export commands are disabled in untrusted workspaces.'));
      return;
    }
    const configured = vscode.workspace.getConfiguration('markda', document.uri).get<unknown[]>('export.targets', []);
    const targets = configured.flatMap((value) => isExternalTarget(value) ? [value] : []);
    if (!targets.length) {
      const open = vscode.l10n.t('Open Settings');
      const selected = await vscode.window.showInformationMessage(
        vscode.l10n.t('markda: Configure markda.export.targets to add Pandoc or other export commands.'),
        open,
      );
      if (selected === open) await vscode.commands.executeCommand('workbench.action.openSettings', 'markda.export.targets');
      return;
    }
    const target = targets.length === 1
      ? targets[0]
      : await vscode.window.showQuickPick(targets.map((item) => ({ label: item.name, target: item })), {
        placeHolder: vscode.l10n.t('Choose an external export target'),
      }).then((item) => item?.target);
    if (!target) return;
    const extension = normalizeExtension(target.extension);
    const destination = extension ? await vscode.window.showSaveDialog({
      defaultUri: document.uri.with({ path: document.uri.path.replace(/\.[^/.]+$/u, '') + extension }),
      filters: { [target.name]: [extension.slice(1)] },
      saveLabel: vscode.l10n.t('Export'),
    }) : undefined;
    if (extension && !destination) return;
    const variables: Readonly<Record<string, string>> = {
      source: document.uri.fsPath,
      destination: destination?.fsPath ?? '',
      documentDir: path.dirname(document.uri.fsPath),
      documentName: path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)),
      workspaceFolder: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.uri.fsPath),
    };
    const args = (target.args ?? []).map((argument) => substituteVariables(argument, variables));
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('markda: Exporting with {0}', target.name),
    }, async () => runProcess(substituteVariables(target.command, variables), args, variables['documentDir']!));
    void vscode.window.showInformationMessage(vscode.l10n.t('markda: External export completed: {0}', target.name));
  }

  async exportPrevious(document: vscode.TextDocument): Promise<void> {
    if (!this.previous || this.previous.source !== document.uri.toString()) {
      void vscode.window.showWarningMessage(vscode.l10n.t('markda: This document has no previous export.'));
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
      saveLabel: vscode.l10n.t('Export'),
    });
  }

  private rendererFor(document: vscode.TextDocument) {
    const config = vscode.workspace.getConfiguration('markda', document.uri);
    return createMarkdownRenderer({
      breaks: config.get('markdown.breaks', false),
      html: config.get('markdown.html', true) && config.get('security.allowUnsafeHtml', false),
    });
  }

  private async findPdfBrowser(uri: vscode.Uri): Promise<string | undefined> {
    const configured = vscode.workspace.getConfiguration('markda', uri).get<string>('export.pdfBrowserPath', '').trim();
    const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean) as string[];
    const candidates = [
      configured,
      ...roots.flatMap((root) => [
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(candidate));
        return candidate;
      } catch { /* Try the next installed browser. */ }
    }
    return undefined;
  }

  private loadKatexCss(): Promise<string> {
    if (!this.extensionUri) return Promise.resolve('');
    return this.katexCss ??= inlineStylesheetAssets(vscode.Uri.joinPath(this.extensionUri, 'dist', 'katex.css'));
  }
}

function isExternalTarget(value: unknown): value is ExternalExportTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  return typeof target.name === 'string' && target.name.length > 0 && target.name.length <= 100
    && typeof target.command === 'string' && target.command.length > 0 && target.command.length <= 8_192
    && (target.args === undefined || (Array.isArray(target.args) && target.args.length <= 100
      && target.args.every((argument) => typeof argument === 'string' && argument.length <= 8_192)))
    && (target.extension === undefined || typeof target.extension === 'string');
}

function normalizeExtension(value = ''): string {
  const cleaned = value.trim().replace(/^\.*|[^a-zA-Z0-9._-]/gu, '');
  return cleaned ? `.${cleaned}` : '';
}

function runProcess(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, windowsHide: true, shell: false });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 32_000) stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Export command exited with code ${code ?? 'unknown'}.${stderr ? `\n${stderr.trim()}` : ''}`));
    });
  });
}

async function inlineStylesheetAssets(stylesheet: vscode.Uri): Promise<string> {
  let css: string;
  try {
    css = Buffer.from(await vscode.workspace.fs.readFile(stylesheet)).toString('utf8');
  } catch {
    return '';
  }
  const matches = [...css.matchAll(/url\((?:"|')?([^"')]+)(?:"|')?\)/gu)];
  for (const match of matches) {
    const reference = match[1];
    if (!reference || /^(?:data:|https?:)/iu.test(reference)) continue;
    try {
      const data = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(stylesheet, '..', reference));
      const extension = path.extname(reference).slice(1).toLowerCase();
      const mime = extension === 'woff2' ? 'font/woff2' : extension === 'woff' ? 'font/woff' : 'application/octet-stream';
      css = css.replaceAll(match[0], `url(data:${mime};base64,${Buffer.from(data).toString('base64')})`);
    } catch { /* Keep the original URL when an optional font asset is absent. */ }
  }
  return css;
}
