import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { areValidTextChanges, decodeImageSource, parseEditorToHostMessage, type EditorCommand, type EditorToHostMessage, type HostToEditorMessage, type TextChange } from './protocol.js';
import { getEditorSettings } from './settings.js';
import { getStatistics } from './statistics.js';
import { findMinimalChange } from './textChange.js';
import { OutlineProvider } from './outlineProvider.js';

interface EditorView {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  pendingTransactions: Set<string>;
  messageQueue: Promise<void>;
}

export class MarkdaEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  static readonly viewType = 'markda.editor';
  private readonly views = new Set<EditorView>();
  private readonly disposables: vscode.Disposable[] = [];
  private activeView: EditorView | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly outline: OutlineProvider,
    private readonly status: vscode.StatusBarItem,
    private readonly onDidActivateDocument?: (uri: vscode.Uri) => void,
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('markda')) return;
        for (const view of this.views) {
          this.post(view, { type: 'configurationChanged', settings: getEditorSettings(view.document.uri) });
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshStatus()),
    );
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri, this.context.globalStorageUri, vscode.Uri.joinPath(document.uri, '..')],
    };
    const view: EditorView = { panel, document, pendingTransactions: new Set(), messageQueue: Promise.resolve() };
    this.views.add(view);
    this.activeView = view;
    this.onDidActivateDocument?.(document.uri);
    panel.onDidChangeViewState(() => {
      if (panel.active) {
        this.activeView = view;
        this.onDidActivateDocument?.(document.uri);
        this.refreshStatus();
      }
    });
    panel.onDidDispose(() => {
      this.views.delete(view);
      if (this.activeView === view) this.activeView = [...this.views].find((candidate) => candidate.panel.active);
      this.refreshStatus();
    });
    panel.webview.onDidReceiveMessage((rawMessage: unknown) => {
      const message = parseEditorToHostMessage(rawMessage);
      if (!message) {
        if (isMessageType(rawMessage, 'edit')) this.resync(view);
        return;
      }
      view.messageQueue = view.messageQueue.then(() => this.onMessage(view, message)).catch((error: unknown) => {
        console.error('markda: Failed to handle a webview message.', error);
        if (message.type === 'edit') this.resync(view);
      });
    });
    // Install the message listener before loading the webview. The webview posts
    // `ready` as soon as its script runs, so loading it first can lose that
    // one-shot handshake and leave the editor without its initial document.
    panel.webview.html = this.getHtml(panel.webview, document.uri, this.initializationMessage(view));
  }

  sendCommand(command: EditorCommand, payload?: unknown): void {
    const view = this.getActiveView();
    if (view) this.post(view, { type: 'command', command, payload });
  }

  getActiveDocument(): vscode.TextDocument | undefined {
    return this.getActiveView()?.document;
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }

  private async onMessage(view: EditorView, message: EditorToHostMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        // The initial document is embedded in the webview HTML so the editor can
        // paint immediately. `ready` only confirms that command messaging is live.
        this.refreshStatus();
        return;
      case 'edit':
        await this.applyEdit(view, message.baseVersion, message.transactionId, message.changes);
        return;
      case 'finalSync':
        await this.applyFinalSync(view, message.uri, message.expectedText, message.text);
        return;
      case 'save':
        await this.saveDocument(view, message.uri, message.expectedText, message.text);
        return;
      case 'outline':
        if (view === this.getActiveView()) this.outline.update(message.headings);
        return;
      case 'statistics':
        if (view === this.getActiveView()) this.setStatus(message.statistics.words, message.statistics.characters);
        return;
      case 'openLink':
        await this.openLink(view.document.uri, message.href);
        return;
      case 'requestImage':
        await this.insertImage(view);
        return;
      case 'saveImages':
        await this.saveImages(view, message.images);
        return;
      case 'manageImage':
        await this.manageImage(view, message.source, message.from, message.action);
        return;
      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text);
        return;
      case 'updateThemeMode':
        await vscode.workspace.getConfiguration('markda').update('editor.themeMode', message.mode, vscode.ConfigurationTarget.Global);
        return;
      case 'state':
        await vscode.commands.executeCommand('setContext', 'markda.sourceMode', message.sourceMode);
        if (message.cursor !== undefined && view === this.getActiveView()) this.outline.setCursor(message.cursor);
        return;
    }
  }

  private async applyEdit(view: EditorView, baseVersion: number, transactionId: string, changes: readonly TextChange[]): Promise<void> {
    if (baseVersion !== view.document.version || !areValidTextChanges(changes, view.document.getText().length)) {
      this.resync(view);
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const change of [...changes].sort((a, b) => b.from - a.from)) {
      const range = new vscode.Range(view.document.positionAt(change.from), view.document.positionAt(change.to));
      edit.replace(view.document.uri, range, change.insert);
    }
    view.pendingTransactions.add(transactionId);
    if (!await vscode.workspace.applyEdit(edit)) {
      view.pendingTransactions.delete(transactionId);
      this.resync(view);
    }
  }

  private async applyFinalSync(view: EditorView, uri: string, expectedText: string, text: string): Promise<void> {
    if (uri !== view.document.uri.toString() || text === view.document.getText()) return;
    // Only finish a local tail when all preceding queued local edits produced the
    // exact state predicted by the webview. Never overwrite an external change.
    if (view.document.getText() !== expectedText) {
      this.resync(view);
      return;
    }
    const change = findMinimalChange(expectedText, text);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(view.document.uri, new vscode.Range(view.document.positionAt(change.from), view.document.positionAt(change.to)), change.insert);
    await vscode.workspace.applyEdit(edit);
  }

  private async saveDocument(view: EditorView, uri: string, expectedText: string, text: string): Promise<void> {
    if (uri !== view.document.uri.toString()) return;
    if (text !== view.document.getText()) {
      // The save snapshot is queued after any edits already posted by the
      // webview. It may therefore fill only the local, not-yet-posted tail. If
      // something else changed the document first, preserve that change and
      // ask the webview to reconcile instead of overwriting it.
      if (view.document.getText() !== expectedText) {
        this.resync(view);
        void vscode.window.showWarningMessage('markda: The document changed while saving. Review the latest contents and save again.');
        return;
      }
      const change = findMinimalChange(expectedText, text);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(view.document.uri, new vscode.Range(view.document.positionAt(change.from), view.document.positionAt(change.to)), change.insert);
      if (!await vscode.workspace.applyEdit(edit)) {
        this.resync(view);
        void vscode.window.showErrorMessage('markda: Could not synchronize the latest edit before saving.');
        return;
      }
    }
    if (!await view.document.save()) {
      void vscode.window.showErrorMessage('markda: The document could not be saved.');
    }
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    for (const view of this.views) {
      if (view.document.uri.toString() !== event.document.uri.toString()) continue;
      const sourceTransactionId = event && (view.pendingTransactions.size > 0 ? this.matchPendingTransaction(view, event) : undefined);
      if (sourceTransactionId) view.pendingTransactions.delete(sourceTransactionId);
      // The originating webview already owns the submitted text. A lightweight
      // acknowledgement avoids serializing and transferring the complete document
      // after every keystroke. Other views still receive the authoritative text.
      this.post(view, sourceTransactionId
        ? { type: 'documentChanged', version: event.document.version, sourceTransactionId }
        : { type: 'documentChanged', version: event.document.version, text: event.document.getText() });
    }
  }

  /**
   * Identifies which pending transaction (if any) produced `event`. When several
   * webviews edit the same document at once, each acknowledgement must clear its own
   * transaction id rather than the oldest one, otherwise edits from other views would
   * be stranded and never confirmed. We correlate by document version: a transaction
   * posted against `baseVersion` becomes authoritative at `baseVersion + 1`, so the
   * transaction whose base matches the version just before this change is the owner.
   */
  private matchPendingTransaction(view: EditorView, event: vscode.TextDocumentChangeEvent): string | undefined {
    const priorVersion = event.document.version - 1;
    for (const transactionId of view.pendingTransactions) {
      if (transactionId.startsWith(`${priorVersion}:`)) return transactionId;
    }
    // Fall back to the oldest pending transaction when a direct match is unavailable.
    return view.pendingTransactions.values().next().value as string | undefined;
  }

  private async insertImage(view: EditorView): Promise<void> {
    const picked = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] } });
    if (!picked?.length) return;
    const images: { path: string; alt: string }[] = [];
    for (const source of picked) images.push(await this.copyImage(view, source));
    this.post(view, { type: 'command', command: 'insertImage', payload: { images } });
  }

  private async saveImages(view: EditorView, values: readonly { name: string; dataUrl: string }[]): Promise<void> {
    const images: { path: string; alt: string }[] = [];
    for (const [index, value] of values.entries()) {
      const match = value.dataUrl.match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/u);
      if (!match) continue;
      const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
      const safeStem = path.parse(value.name).name.replace(/[^\p{L}\p{N}._-]+/gu, '-') || `pasted-image-${index + 1}`;
      const destination = await this.imageDestination(view, `${safeStem}.${extension}`);
      await vscode.workspace.fs.writeFile(destination, Buffer.from(match[2] ?? '', 'base64'));
      images.push(this.imagePayload(view, destination, safeStem));
    }
    if (images.length) this.post(view, { type: 'command', command: 'insertImage', payload: { images } });
  }

  private async copyImage(view: EditorView, source: vscode.Uri): Promise<{ path: string; alt: string }> {
    const config = vscode.workspace.getConfiguration('markda', view.document.uri);
    const documentName = path.parse(view.document.uri.fsPath).name;
    const copyFolder = config.get<string>('image.folder', '${currentFileNameWithoutExt}.assets')
      .replaceAll('${currentFileNameWithoutExt}', documentName).trim();
    if (!copyFolder) return this.imagePayload(view, source, path.parse(source.fsPath).name);
    const destination = await this.imageDestination(view, path.basename(source.fsPath));
    if (destination.toString() !== source.toString()) await vscode.workspace.fs.copy(source, destination, { overwrite: false });
    return this.imagePayload(view, destination, path.parse(source.fsPath).name);
  }

  private async imageDestination(view: EditorView, filename: string): Promise<vscode.Uri> {
    const documentFolder = path.dirname(view.document.uri.fsPath);
    const config = vscode.workspace.getConfiguration('markda', view.document.uri);
    const copyFolderSetting = config.get<string>('image.folder', '${currentFileNameWithoutExt}.assets');
    const documentName = path.parse(view.document.uri.fsPath).name;
    const copyFolder = copyFolderSetting.replaceAll('${currentFileNameWithoutExt}', documentName).trim();
    let target = await availableDestination(vscode.Uri.file(path.join(documentFolder, filename)));
    if (copyFolder && !path.isAbsolute(copyFolder)) {
      const destinationFolder = path.resolve(documentFolder, copyFolder);
      const workspace = vscode.workspace.getWorkspaceFolder(view.document.uri);
      if (workspace && !isInside(workspace.uri.fsPath, destinationFolder)) {
        void vscode.window.showErrorMessage('markda: The configured image folder must stay inside the workspace.');
        throw new Error('Image folder is outside the workspace.');
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(destinationFolder));
      target = await availableDestination(vscode.Uri.file(path.join(destinationFolder, filename)));
    } else if (path.isAbsolute(copyFolder)) {
      void vscode.window.showErrorMessage('markda: Absolute image folders are not allowed. Use a workspace-relative folder.');
      throw new Error('Invalid absolute image folder.');
    }
    return target;
  }

  private imagePayload(view: EditorView, target: vscode.Uri, alt: string): { path: string; alt: string } {
    const documentFolder = path.dirname(view.document.uri.fsPath);
    const config = vscode.workspace.getConfiguration('markda', view.document.uri);
    const useRelative = config.get<boolean>('image.useRelativePath', true);
    let imagePath = useRelative
      ? path.relative(documentFolder, target.fsPath).replaceAll(path.sep, '/')
      : target.fsPath.replaceAll(path.sep, '/');
    if (useRelative && config.get<boolean>('image.ensureDotSlash', false) && !imagePath.startsWith('.')) imagePath = `./${imagePath}`;
    return { path: encodeMarkdownPath(imagePath), alt: escapeMarkdownLabel(alt) };
  }

  private async manageImage(view: EditorView, sourceValue: string, from: number, action: 'move' | 'copy' | 'delete'): Promise<void> {
    if (/^(?:https?:|data:|vscode-webview:)/iu.test(sourceValue)) {
      void vscode.window.showWarningMessage('markda: Only local image files can be managed.');
      return;
    }
    const decoded = decodeImageSource(sourceValue);
    if (decoded === undefined) {
      void vscode.window.showErrorMessage('markda: The image path is invalid.');
      return;
    }
    const documentFolder = path.dirname(view.document.uri.fsPath);
    const sourcePath = path.resolve(documentFolder, decoded);
    const workspace = vscode.workspace.getWorkspaceFolder(view.document.uri);
    const allowedRoot = workspace?.uri.fsPath ?? documentFolder;
    if (!isInside(allowedRoot, sourcePath)) {
      void vscode.window.showErrorMessage('markda: Image management is restricted to the current workspace.');
      return;
    }
    const source = vscode.Uri.file(sourcePath);
    if (action === 'delete') {
      const choice = await vscode.window.showWarningMessage(`Move image to trash?\n${source.fsPath}`, { modal: true }, 'Move to Trash');
      if (choice !== 'Move to Trash') return;
      await vscode.workspace.fs.delete(source, { useTrash: true });
      this.post(view, { type: 'command', command: 'removeImageSource', payload: { source: sourceValue, from } });
      return;
    }
    const target = await vscode.window.showSaveDialog({
      defaultUri: source,
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] },
      saveLabel: action === 'move' ? 'Move Image' : 'Copy Image',
    });
    if (!target || target.toString() === source.toString()) return;
    if (await exists(target)) {
      void vscode.window.showErrorMessage('markda: The selected destination already exists.');
      return;
    }
    if (action === 'move') await vscode.workspace.fs.rename(source, target, { overwrite: false });
    else await vscode.workspace.fs.copy(source, target, { overwrite: false });
    const newSource = this.imagePayload(view, target, '').path;
    this.post(view, { type: 'command', command: 'replaceImageSource', payload: { source: sourceValue, newSource, from } });
  }

  private async openLink(documentUri: vscode.Uri, href: string): Promise<void> {
    if (/^https?:/iu.test(href)) {
      const policy = vscode.workspace.getConfiguration('markda', documentUri).get<string>('security.allowRemoteResources', 'prompt');
      if (policy === 'never') return;
      if (policy === 'prompt') {
        const choice = await vscode.window.showWarningMessage(`Open external link?\n${href}`, { modal: true }, 'Open');
        if (choice !== 'Open') return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    const target = vscode.Uri.joinPath(documentUri, '..', href.split('#')[0] ?? href);
    if (target.scheme !== 'file') {
      void vscode.window.showWarningMessage('markda: Only local file links can be opened.');
      return;
    }
    const workspace = vscode.workspace.getWorkspaceFolder(documentUri);
    const allowedRoot = workspace?.uri.fsPath ?? path.dirname(documentUri.fsPath);
    if (!isInside(allowedRoot, target.fsPath)) {
      void vscode.window.showWarningMessage('markda: Links outside the workspace cannot be opened.');
      return;
    }
    await vscode.commands.executeCommand('vscode.open', target);
  }

  private refreshStatus(): void {
    const document = this.getActiveDocument();
    if (!document) {
      this.status.hide();
      return;
    }
    const statistics = getStatistics(document.getText());
    this.setStatus(statistics.words, statistics.characters);
  }

  private setStatus(words: number, characters: number): void {
    this.status.text = `$(pencil) ${words} words`;
    this.status.tooltip = `${words} words · ${characters} characters`;
    this.status.show();
  }

  private getActiveView(): EditorView | undefined {
    return [...this.views].find((view) => view.panel.active) ?? this.activeView;
  }

  private post(view: EditorView, message: HostToEditorMessage): void {
    void view.panel.webview.postMessage(message);
  }

  private resync(view: EditorView): void {
    this.post(view, { type: 'documentChanged', version: view.document.version, text: view.document.getText() });
  }

  private initializationMessage(view: EditorView): Extract<HostToEditorMessage, { type: 'initialize' }> {
    return {
      type: 'initialize', uri: view.document.uri.toString(),
      resourceBaseUri: `${view.panel.webview.asWebviewUri(vscode.Uri.joinPath(view.document.uri, '..')).toString()}/`,
      themeBaseUri: `${view.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.globalStorageUri, 'themes')).toString()}/`,
      version: view.document.version,
      text: view.document.getText(), settings: getEditorSettings(view.document.uri),
    };
  }

  private getHtml(
    webview: vscode.Webview,
    documentUri: vscode.Uri,
    initialization: Extract<HostToEditorMessage, { type: 'initialize' }>,
  ): string {
    const nonce = createNonce();
    const allowRemoteImages = vscode.workspace.getConfiguration('markda', documentUri).get<string>('security.allowRemoteResources', 'prompt') === 'always';
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const styles = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
    const initialData = JSON.stringify(initialization)
      .replace(/&/gu, '\\u0026').replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e')
      .replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
    return `<!doctype html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:${allowRemoteImages ? ' https:' : ''}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
<link rel="stylesheet" href="${styles}"><title>markda</title></head>
<body><div id="app" role="application" aria-label="markda Markdown editor"></div><script nonce="${nonce}">globalThis.__markdaInitial=${initialData};</script><script type="module" nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}

function createNonce(): string {
  return randomBytes(24).toString('base64url');
}

function isMessageType(value: unknown, type: string): boolean {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === type;
}

function encodeMarkdownPath(value: string): string {
  return value.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\\\[\]]/gu, '\\$&');
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function availableDestination(preferred: vscode.Uri): Promise<vscode.Uri> {
  if (!await exists(preferred)) return preferred;
  const parsed = path.parse(preferred.fsPath);
  for (let index = 1; index < 10_000; index++) {
    const candidate = vscode.Uri.file(path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`));
    if (!await exists(candidate)) return candidate;
  }
  throw new Error('Unable to allocate a unique image filename.');
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return false;
    throw error;
  }
}
