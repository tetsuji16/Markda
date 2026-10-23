import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { createMarkdownRenderer, extractTitle } from './markdown.js';
import {
  blockedRemoteImagePlaceholder, browserExportContentSecurityPolicy, createHtmlDocument, exportContentFitCss, exportReadinessScript, heightProbeScript, isNetworkPathReference,
  mermaidExportScript, parseProbedHeight, pdfPageCss,
} from './htmlExport.js';
import { substituteVariables } from './externalExport.js';
import {
  browserArgs, browserWorkingDirectory, exportFailureMessage, findBrowserExecutable, isValidPdf, isValidPng, staticRenderedDocument,
  verifyRenderedHtml,
} from './exportBrowser.js';

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
    const markdown = document.getText();
    const renderer = this.rendererFor(document);
    const body = renderer.render(markdown);
    const exportConfig = vscode.workspace.getConfiguration('markda', document.uri);
    const allowRemoteImages = exportConfig.get<string>('security.allowRemoteResources', 'prompt') === 'always';
    const paper = exportConfig.get<string>('export.pdfPaperSize', 'A4');
    const safePaper = ['A4', 'A5', 'Letter', 'Legal'].includes(paper) ? paper : 'A4';
    const margin = Math.max(0, Math.min(80, exportConfig.get<number>('export.pdfMarginMm', 15)));
    const localDocument = document.uri.scheme === 'file';
    const baseHref = localDocument ? pathToFileURL(`${path.dirname(document.uri.fsPath)}${path.sep}`).href : '';
    const nonce = randomBytes(16).toString('base64url');
    const scripts = await this.exportScripts(body, nonce, allowRemoteImages);
    const html = createHtmlDocument(
      extractTitle(markdown, path.basename(document.fileName)),
      body,
      vscode.env.language,
      `${await this.loadKatexCss()}\n${pdfPageCss(safePaper, margin)}`,
      baseHref,
      browserExportContentSecurityPolicy(allowRemoteImages, nonce),
      scripts,
    );
    const temporaryFolder = await mkdtemp(path.join(os.tmpdir(), 'markda-pdf-'));
    const temporaryHtml = path.join(temporaryFolder, 'document.html');
    try {
      await this.assertWritableDestination(target);
      const browser = await this.findPdfBrowser(document.uri);
      if (!browser) throw new Error('PDF export requires Microsoft Edge, Google Chrome, or Chromium. Set markda.export.pdfBrowserPath to its executable path.');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(temporaryHtml), Buffer.from(html, 'utf8'));
      const userDataDirectory = path.join(temporaryFolder, 'browser-profile');
      const pageUrl = pathToFileURL(temporaryHtml).href;
      const cwd = await browserWorkingDirectory(localDocument ? path.dirname(document.uri.fsPath) : undefined);
      const renderedPage = await runProcess(browser, browserArgs('probe', userDataDirectory, pageUrl, undefined, 1280), cwd, renderTimeoutMs);
      const captureHtml = path.join(temporaryFolder, 'capture.html');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(captureHtml), Buffer.from(staticRenderedDocument(renderedPage, nonce), 'utf8'));
      const temporaryPdf = path.join(temporaryFolder, 'export.pdf');
      await runProcess(browser, browserArgs('pdf', userDataDirectory, pathToFileURL(captureHtml).href, temporaryPdf), cwd, browserTimeoutMs);
      const pdf = await readFile(temporaryPdf).catch(() => undefined);
      if (!isValidPdf(pdf)) throw new Error('The browser did not create a valid PDF.');
      await vscode.workspace.fs.writeFile(target, pdf);
      void vscode.window.showInformationMessage(vscode.l10n.t('markda: Exported {0}', path.basename(target.fsPath)));
    } catch (error) {
      void vscode.window.showErrorMessage(exportFailureMessage(error));
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
    const config = vscode.workspace.getConfiguration('markda', document.uri);
    const allowRemoteImages = config.get<string>('security.allowRemoteResources', 'prompt') === 'always';
    const width = Math.max(480, Math.min(2400, config.get<number>('export.imageWidth', 900)));
    const fontSize = Math.max(12, Math.min(48, config.get<number>('export.imageFontSize', 18)));
    const markdown = document.getText();
    const body = this.rendererFor(document).render(markdown);
    const localDocument = document.uri.scheme === 'file';
    const baseHref = localDocument ? pathToFileURL(`${path.dirname(document.uri.fsPath)}${path.sep}`).href : '';
    const nonce = randomBytes(16).toString('base64url');
    const scripts = await this.exportScripts(body, nonce, allowRemoteImages);
    const html = createHtmlDocument(
      extractTitle(markdown, path.basename(document.fileName)),
      body,
      vscode.env.language,
      `${await this.loadKatexCss()}\nbody{font-size:${fontSize}px}.markda-export{max-width:${width - 80}px;padding:40px}${exportContentFitCss()}`,
      baseHref,
      browserExportContentSecurityPolicy(allowRemoteImages, nonce),
      `${scripts}${heightProbeScript(nonce)}`,
    );
    const temporaryFolder = await mkdtemp(path.join(os.tmpdir(), 'markda-image-'));
    const temporaryHtml = path.join(temporaryFolder, 'document.html');
    try {
      await this.assertWritableDestination(target);
      const browser = await this.findPdfBrowser(document.uri);
      if (!browser) throw new Error('Image export requires Microsoft Edge, Google Chrome, or Chromium. Set markda.export.pdfBrowserPath to its executable path.');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(temporaryHtml), Buffer.from(html, 'utf8'));
      const pageUrl = pathToFileURL(temporaryHtml).href;
      const cwd = await browserWorkingDirectory(localDocument ? path.dirname(document.uri.fsPath) : undefined);
      const userDataDirectory = path.join(temporaryFolder, 'browser-profile');
      // Measure at the final width with scrollbars hidden so text wraps exactly
      // as in the screenshot. Readiness is verified separately from this estimate.
      try {
        const probe = await runProcess(browser, browserArgs('probe', userDataDirectory, pageUrl, undefined, width), cwd, probeTimeoutMs);
        const renderedHtml = staticRenderedDocument(probe, nonce);
        const measuredHeight = parseProbedHeight(probe, nonce);
        const captureHtml = path.join(temporaryFolder, 'capture.html');
        await vscode.workspace.fs.writeFile(vscode.Uri.file(captureHtml), Buffer.from(renderedHtml, 'utf8'));
        const height = Math.max(minimumImageHeight, Math.min(maximumImageHeight, measuredHeight
          ?? Math.ceil((markdown.split(/\r\n|\r|\n/u).length * fontSize * 1.7) + 180)));
        const temporaryImage = path.join(temporaryFolder, 'export.png');
        await runProcess(browser, browserArgs('screenshot', userDataDirectory, pathToFileURL(captureHtml).href, temporaryImage, width, height), cwd, browserTimeoutMs);
        const image = await readFile(temporaryImage).catch(() => undefined);
        if (!isValidPng(image)) throw new Error('The browser did not create a valid PNG image.');
        await vscode.workspace.fs.writeFile(target, image);
        if (measuredHeight !== undefined && measuredHeight > maximumImageHeight) {
          void vscode.window.showWarningMessage(vscode.l10n.t('markda: The document is taller than {0}px, so the exported image only shows the beginning. Use PDF export for the full document.', maximumImageHeight));
        } else {
          void vscode.window.showInformationMessage(vscode.l10n.t('markda: Exported {0}', path.basename(target.fsPath)));
        }
        return;
      } catch (error) {
        if (error instanceof Error && /Mermaid|diagram|page assets/u.test(error.message)) throw error;
        throw new Error('The browser could not finish preparing the image export. Check local image paths and retry.');
      }
    } catch (error) {
      void vscode.window.showErrorMessage(exportFailureMessage(error));
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
    }, async () => runProcess(substituteVariables(target.command, variables), args, variables['documentDir']!, undefined, 'External export command'));
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
    const renderer = createMarkdownRenderer({
      breaks: config.get('markdown.breaks', false),
      html: config.get('markdown.html', true) && config.get('security.allowUnsafeHtml', false),
    });
    // The browser loads this page from file:// with the document folder as its
    // base, so `//host/share/x.png` would become a UNC path on Windows.
    const defaultImage = renderer.renderer.rules.image!;
    renderer.renderer.rules.image = (tokens, index, options, env, self) => {
      const token = tokens[index];
      if (token && isNetworkPathReference(token.attrGet('src') ?? '')) {
        token.attrSet('data-markda-remote-blocked', 'true');
        token.attrSet('src', blockedRemoteImagePlaceholder);
      }
      return defaultImage(tokens, index, options, env, self);
    };
    return renderer;
  }

  private async findPdfBrowser(uri: vscode.Uri): Promise<string | undefined> {
    const configured = vscode.workspace.getConfiguration('markda', uri).get<string>('export.pdfBrowserPath', '').trim();
    return findBrowserExecutable({ configuredPath: configured });
  }

  private async exportScripts(body: string, nonce: string, allowRemoteImages: boolean): Promise<string> {
    if (!/language-mermaid/iu.test(body)) return exportReadinessScript(nonce, allowRemoteImages);
    if (!this.extensionUri) throw new Error('The bundled Mermaid renderer is unavailable. Rebuild the extension and retry the export.');
    const bundleUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'exportMermaid.js');
    let bundle: string;
    try { bundle = Buffer.from(await vscode.workspace.fs.readFile(bundleUri)).toString('utf8'); }
    catch { throw new Error('The bundled Mermaid renderer is unavailable. Rebuild the extension and retry the export.'); }
    return mermaidExportScript(bundle, nonce, allowRemoteImages);
  }

  private async assertWritableDestination(target: vscode.Uri): Promise<void> {
    const folder = target.with({ path: path.posix.dirname(target.path) });
    try {
      const stat = await vscode.workspace.fs.stat(folder);
      if ((stat.type & vscode.FileType.Directory) === 0) throw new Error();
      const probe = vscode.Uri.joinPath(folder, `.markda-export-${randomBytes(8).toString('hex')}.tmp`);
      try { await vscode.workspace.fs.writeFile(probe, Buffer.from('')); }
      finally { await vscode.workspace.fs.delete(probe).then(() => undefined, () => undefined); }
    } catch {
      throw new Error('The export destination folder is unavailable or read-only. Choose a writable folder and retry.');
    }
  }

  private loadKatexCss(): Promise<string> {
    if (!this.extensionUri) return Promise.resolve('');
    return this.katexCss ??= inlineStylesheetAssets(vscode.Uri.joinPath(this.extensionUri, 'dist', 'katex.css'));
  }
}

const minimumImageHeight = 720;
const maximumImageHeight = 16_000;
// A remote image that never finishes loading keeps a headless page open
// indefinitely. Height probing falls back to the estimate after its timeout;
// PDF and screenshot runs report an error instead of hanging the command.
const probeTimeoutMs = 20_000;
const browserTimeoutMs = 120_000;
const renderTimeoutMs = 35_000;

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

/** Resolves with the start of stdout; callers only need the head of a dumped DOM. */
function runProcess(command: string, args: readonly string[], cwd: string, timeoutMs?: number, processLabel = 'Export browser'): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, windowsHide: true, shell: false });
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      child.kill();
      reject(new Error(`Export command did not finish within ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { if (stdout.length < 8_000_000) stdout += chunk.toString('utf8'); });
    child.stderr.on('data', () => undefined);
    child.once('error', () => { clearTimeout(timer); reject(new Error(`${processLabel} could not start.`)); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${processLabel} exited with code ${code ?? 'unknown'}.`));
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
