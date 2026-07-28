import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { areValidTextChanges, decodeImageSource, parseEditorToHostMessage, type EditorCommand, type EditorDiagnostic, type EditorToHostMessage, type HostToEditorMessage, type TextChange } from './protocol.js';
import { getEditorSettings, getThemeMode } from './settings.js';
import { getStatistics } from './statistics.js';
import { findMinimalChange } from './textChange.js';
import { OutlineProvider } from './outlineProvider.js';
import { isRtlLocale } from './localization.js';
import { isMarkdownDocumentPath, parseDocumentLink } from './documentLink.js';

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
  private themeMode: ReturnType<typeof getThemeMode>;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly outline: OutlineProvider,
    private readonly status: vscode.StatusBarItem,
    private readonly onDidActivateDocument?: (uri: vscode.Uri) => void,
  ) {
    this.themeMode = getThemeMode();
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event)),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('markda')) return;
        if (event.affectsConfiguration('markda.editor.themeMode')) this.themeMode = getThemeMode();
        this.broadcastSettings();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshStatus()),
    );
    const languageApi = (vscode as typeof vscode & { languages?: typeof vscode.languages }).languages;
    if (languageApi) {
      this.disposables.push(languageApi.onDidChangeDiagnostics((event) => {
        const changed = new Set(event.uris.map((uri) => uri.toString()));
        for (const view of this.views) if (changed.has(view.document.uri.toString())) this.postDiagnostics(view);
      }));
    }
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
        // Messages sent while a webview is hidden can be dropped while VS Code
        // suspends its context. Reconcile the theme on every tab activation,
        // including retained contexts that do not emit another `ready` event.
        this.postSettings(view);
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
        // paint immediately. A hidden tab may have had its webview discarded and
        // recreated from older HTML, so always reconcile it with the current
        // in-memory settings when command messaging becomes live again.
        this.postSettings(view);
        this.postDiagnostics(view);
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
      case 'requestCodeActions':
        await this.showCodeActions(view, message.from, message.to);
        return;
      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(message.text);
        return;
      case 'updateThemeMode':
        // Keep the current selection in memory and notify every open tab before
        // waiting for VS Code to flush the global setting to disk. This closes
        // the gap where a fast tab switch could initialize from the old value.
        this.themeMode = message.mode;
        this.broadcastSettings();
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
    const documentText = view.document.getText();
    if (uri !== view.document.uri.toString() || text === documentText) return;
    // Only finish a local tail when all preceding queued local edits produced the
    // exact state predicted by the webview. Never overwrite an external change.
    if (documentText !== expectedText) {
      this.resync(view);
      return;
    }
    const change = findMinimalChange(expectedText, text);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(view.document.uri, new vscode.Range(view.document.positionAt(change.from), view.document.positionAt(change.to)), change.insert);
    if (!await vscode.workspace.applyEdit(edit)) this.resync(view);
  }

  private async saveDocument(view: EditorView, uri: string, expectedText: string, text: string): Promise<void> {
    if (uri !== view.document.uri.toString()) return;
    const documentText = view.document.getText();
    if (text !== documentText) {
      // The save snapshot is queued after any edits already posted by the
      // webview. It may therefore fill only the local, not-yet-posted tail. If
      // something else changed the document first, preserve that change and
      // ask the webview to reconcile instead of overwriting it.
      if (documentText !== expectedText) {
        this.resync(view);
        void vscode.window.showWarningMessage(vscode.l10n.t('markda: The document changed while saving. Review the latest contents and save again.'));
        return;
      }
      const change = findMinimalChange(expectedText, text);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(view.document.uri, new vscode.Range(view.document.positionAt(change.from), view.document.positionAt(change.to)), change.insert);
      if (!await vscode.workspace.applyEdit(edit)) {
        this.resync(view);
        void vscode.window.showErrorMessage(vscode.l10n.t('markda: Could not synchronize the latest edit before saving.'));
        return;
      }
    }
    if (!await view.document.save()) {
      void vscode.window.showErrorMessage(vscode.l10n.t('markda: The document could not be saved.'));
    }
  }

  private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    const documentUri = event.document.uri.toString();
    let documentText: string | undefined;
    for (const view of this.views) {
      if (view.document.uri.toString() !== documentUri) continue;
      const sourceTransactionId = event && (view.pendingTransactions.size > 0 ? this.matchPendingTransaction(view, event) : undefined);
      if (sourceTransactionId) view.pendingTransactions.delete(sourceTransactionId);
      // The originating webview already owns the submitted text. A lightweight
      // acknowledgement avoids serializing and transferring the complete document
      // after every keystroke. Other views still receive the authoritative text.
      this.post(view, sourceTransactionId
        ? { type: 'documentChanged', version: event.document.version, sourceTransactionId }
        : { type: 'documentChanged', version: event.document.version, text: documentText ??= event.document.getText() });
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
        void vscode.window.showErrorMessage(vscode.l10n.t('markda: The configured image folder must stay inside the workspace.'));
        throw new Error('Image folder is outside the workspace.');
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(destinationFolder));
      target = await availableDestination(vscode.Uri.file(path.join(destinationFolder, filename)));
    } else if (path.isAbsolute(copyFolder)) {
      void vscode.window.showErrorMessage(vscode.l10n.t('markda: Absolute image folders are not allowed. Use a workspace-relative folder.'));
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
      void vscode.window.showWarningMessage(vscode.l10n.t('markda: Only local image files can be managed.'));
      return;
    }
    const decoded = decodeImageSource(sourceValue);
    if (decoded === undefined) {
      void vscode.window.showErrorMessage(vscode.l10n.t('markda: The image path is invalid.'));
      return;
    }
    const documentFolder = path.dirname(view.document.uri.fsPath);
    const sourcePath = path.resolve(documentFolder, decoded);
    const workspace = vscode.workspace.getWorkspaceFolder(view.document.uri);
    const allowedRoot = workspace?.uri.fsPath ?? documentFolder;
    if (!isInside(allowedRoot, sourcePath)) {
      void vscode.window.showErrorMessage(vscode.l10n.t('markda: Image management is restricted to the current workspace.'));
      return;
    }
    const source = vscode.Uri.file(sourcePath);
    if (action === 'delete') {
      const moveToTrash = vscode.l10n.t('Move to Trash');
      const choice = await vscode.window.showWarningMessage(vscode.l10n.t('Move image to trash?\n{0}', source.fsPath), { modal: true }, moveToTrash);
      if (choice !== moveToTrash) return;
      await vscode.workspace.fs.delete(source, { useTrash: true });
      this.post(view, { type: 'command', command: 'removeImageSource', payload: { source: sourceValue, from } });
      return;
    }
    const target = await vscode.window.showSaveDialog({
      defaultUri: source,
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] },
      saveLabel: action === 'move' ? vscode.l10n.t('Move Image') : vscode.l10n.t('Copy Image'),
    });
    if (!target || target.toString() === source.toString()) return;
    if (await exists(target)) {
      void vscode.window.showErrorMessage(vscode.l10n.t('markda: The selected destination already exists.'));
      return;
    }
    if (action === 'move') await vscode.workspace.fs.rename(source, target, { overwrite: false });
    else await vscode.workspace.fs.copy(source, target, { overwrite: false });
    const newSource = this.imagePayload(view, target, '').path;
    this.post(view, { type: 'command', command: 'replaceImageSource', payload: { source: sourceValue, newSource, from } });
  }

  private async openLink(documentUri: vscode.Uri, href: string): Promise<void> {
    const link = parseDocumentLink(href);
    if (link.kind === 'unsupported') {
      void vscode.window.showWarningMessage(vscode.l10n.t('markda: This link type cannot be opened safely.'));
      return;
    }
    if (link.kind === 'external') {
      const policy = vscode.workspace.getConfiguration('markda', documentUri).get<string>('security.allowRemoteResources', 'prompt');
      if (policy === 'never') return;
      if (policy === 'prompt') {
        const open = vscode.l10n.t('Open');
        const choice = await vscode.window.showWarningMessage(vscode.l10n.t('Open external link?\n{0}', link.href), { modal: true }, open);
        if (choice !== open) return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(link.href));
      return;
    }
    if (link.kind === 'anchor') {
      const current = [...this.views].find((view) => view.document.uri.toString() === documentUri.toString());
      if (current) this.post(current, { type: 'command', command: 'focusAnchor', payload: { fragment: link.fragment } });
      return;
    }
    if (documentUri.scheme !== 'file') {
      void vscode.window.showWarningMessage(vscode.l10n.t('markda: Only local file links can be opened.'));
      return;
    }
    const target = vscode.Uri.file(path.resolve(path.dirname(documentUri.fsPath), link.path));
    const workspace = vscode.workspace.getWorkspaceFolder(documentUri);
    const allowedRoot = workspace?.uri.fsPath ?? path.dirname(documentUri.fsPath);
    if (!isInside(allowedRoot, target.fsPath)) {
      void vscode.window.showWarningMessage(vscode.l10n.t('markda: Links outside the workspace cannot be opened.'));
      return;
    }
    if (!isMarkdownDocumentPath(target.fsPath)) {
      await vscode.commands.executeCommand('vscode.open', target);
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', target, MarkdaEditorProvider.viewType);
    if (link.fragment) {
      const opened = [...this.views].find((view) => view.document.uri.fsPath === target.fsPath);
      if (opened) this.post(opened, { type: 'command', command: 'focusAnchor', payload: { fragment: link.fragment } });
    }
  }

  private async showCodeActions(view: EditorView, from: number, to: number): Promise<void> {
    const range = new vscode.Range(view.document.positionAt(from), view.document.positionAt(to));
    const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
      'vscode.executeCodeActionProvider', view.document.uri, range,
    ) ?? [];
    if (!actions.length) {
      void vscode.window.showInformationMessage(vscode.l10n.t('markda: No fixes are available for this problem.'));
      return;
    }
    const picked = await vscode.window.showQuickPick<(vscode.QuickPickItem & { action: vscode.CodeAction | vscode.Command })>(actions.map((action) => ({
      label: action.title,
      ...('kind' in action && action.kind ? { description: action.kind.value } : {}),
      action,
    })), { placeHolder: vscode.l10n.t('Choose a fix') });
    if (!picked) return;
    const action = picked.action;
    if ('edit' in action && action.edit) await vscode.workspace.applyEdit(action.edit);
    const command: vscode.Command | undefined = typeof action.command === 'string'
      ? action as vscode.Command
      : (action as vscode.CodeAction).command;
    if (command) await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
  }

  private postDiagnostics(view: EditorView): void {
    const languageApi = (vscode as typeof vscode & { languages?: typeof vscode.languages }).languages;
    const diagnostics: EditorDiagnostic[] = (languageApi?.getDiagnostics(view.document.uri) ?? [])
      .slice(0, 2_000)
      .map((diagnostic) => ({
        from: view.document.offsetAt(diagnostic.range.start),
        to: view.document.offsetAt(diagnostic.range.end),
        severity: diagnosticSeverity(diagnostic.severity),
        message: diagnostic.message.slice(0, 4_096),
        ...(diagnostic.source ? { source: diagnostic.source.slice(0, 128) } : {}),
      }));
    this.post(view, { type: 'diagnosticsChanged', diagnostics });
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
    this.status.text = `$(pencil) ${vscode.l10n.t('{0} words', words)}`;
    this.status.tooltip = vscode.l10n.t('{0} words · {1} characters', words, characters);
    this.status.show();
  }

  private getActiveView(): EditorView | undefined {
    return [...this.views].find((view) => view.panel.active) ?? this.activeView;
  }

  private post(view: EditorView, message: HostToEditorMessage): void {
    void view.panel.webview.postMessage(message);
  }

  private broadcastSettings(): void {
    for (const view of this.views) this.postSettings(view);
  }

  private postSettings(view: EditorView): void {
    this.post(view, { type: 'configurationChanged', settings: getEditorSettings(view.document.uri, this.themeMode) });
  }

  private resync(view: EditorView): void {
    this.post(view, { type: 'documentChanged', version: view.document.version, text: view.document.getText() });
  }

  private initializationMessage(view: EditorView): Extract<HostToEditorMessage, { type: 'initialize' }> {
    return {
      type: 'initialize', uri: view.document.uri.toString(),
      resourceBaseUri: `${view.panel.webview.asWebviewUri(vscode.Uri.joinPath(view.document.uri, '..')).toString()}/`,
      themeBaseUri: `${view.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.globalStorageUri, 'themes')).toString()}/`,
      assetBaseUri: `${view.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist')).toString()}/`,
      locale: vscode.env.language,
      direction: isRtlLocale(vscode.env.language) ? 'rtl' : 'ltr',
      version: view.document.version,
      text: view.document.getText(), settings: getEditorSettings(view.document.uri, this.themeMode),
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
    const initialData = escapeEmbeddedJson(JSON.stringify(initialization));
    return `<!doctype html>
<html lang="${escapeHtmlAttribute(initialization.locale)}" dir="${initialization.direction}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:${allowRemoteImages ? ' https:' : ''}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}';">
<link rel="stylesheet" href="${styles}"><title>markda</title></head>
<body><div id="app" role="application" aria-label="${escapeHtmlAttribute(vscode.l10n.t('markda Markdown editor'))}"></div><script nonce="${nonce}">globalThis.__markdaInitial=${initialData};</script><script type="module" nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}

function diagnosticSeverity(severity: vscode.DiagnosticSeverity): EditorDiagnostic['severity'] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error: return 'error';
    case vscode.DiagnosticSeverity.Warning: return 'warning';
    case vscode.DiagnosticSeverity.Information: return 'information';
    default: return 'hint';
  }
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

const embeddedJsonEscapes: Readonly<Record<string, string>> = {
  '&': '\\u0026',
  '<': '\\u003c',
  '>': '\\u003e',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

export function escapeEmbeddedJson(value: string): string {
  return value.replace(/[&<>\u2028\u2029]/gu, (character) => embeddedJsonEscapes[character] ?? character);
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
