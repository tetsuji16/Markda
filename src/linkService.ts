import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseDocumentLink, isMarkdownDocumentPath } from './documentLink.js';
import { headingAnchors } from './markdownFeatures.js';
import { isPathInside } from './pathSecurity.js';

const pattern = '**/*.{md,markdown,mdown,mkd,mkdn,mdwn,txt}';
const exclude = '**/{node_modules,.git,dist,build}/**';

export class LinkService implements vscode.Disposable, vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('markda-links');
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private current: vscode.TextDocument | undefined;
  private backlinks: vscode.TreeItem[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private backlinkGeneration = 0;

  dispose(): void { clearTimeout(this.timer); this.generation++; this.backlinkGeneration++; this.diagnostics.dispose(); this.changed.dispose(); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  getChildren(): vscode.TreeItem[] { return this.backlinks; }

  setDocument(document: vscode.TextDocument): void {
    if (this.current?.uri.toString() !== document.uri.toString()) {
      this.backlinkGeneration++;
      this.backlinks = [];
      this.changed.fire();
    }
    this.current = document;
    this.scheduleCheck();
  }

  closeDocument(document: vscode.TextDocument): void {
    this.diagnostics.delete(document.uri);
    if (this.current?.uri.toString() === document.uri.toString()) {
      this.current = undefined;
      clearTimeout(this.timer);
      this.generation++;
      this.backlinkGeneration++;
      this.backlinks = [];
      this.changed.fire();
    }
  }

  invalidate(): void {
    this.diagnostics.clear();
    this.scheduleCheck();
  }

  documentChanged(document: vscode.TextDocument): void {
    if (this.current && isMarkdownDocumentPath(document.uri.fsPath)) this.scheduleCheck();
  }

  private scheduleCheck(): void {
    clearTimeout(this.timer);
    this.generation++;
    if (!vscode.workspace.getConfiguration('markda', this.current?.uri).get('links.checkOnEdit', true)) return;
    this.timer = setTimeout(() => {
      const document = this.current;
      if (document) void this.check(document).catch(() => this.diagnostics.delete(document.uri));
    }, 750);
  }

  async check(document: vscode.TextDocument): Promise<void> {
    if (document.uri.scheme !== 'file') return;
    const generation = ++this.generation;
    const { extractLocalLinks } = await import('./workspaceLinks.js');
    const version = document.version;
    const text = document.getText();
    const results: vscode.Diagnostic[] = [];
    const targets = new Map<string, Promise<string | undefined>>();
    // This check runs automatically when a document is opened, so the document
    // content controls which paths are touched. Apply the same boundary as link
    // navigation: never stat or read outside the workspace (or, for a standalone
    // file, its folder). This also keeps `//host/share` links, which resolve to
    // UNC paths on Windows, from opening network connections.
    const allowedRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ?? path.dirname(document.uri.fsPath);
    for (const link of extractLocalLinks(text)) {
      const target = parseDocumentLink(link.href);
      if (target.kind !== 'local' && target.kind !== 'anchor') continue;
      if (target.kind === 'local' && !isPathInside(allowedRoot, path.resolve(path.dirname(document.uri.fsPath), target.path))) continue;
      const uri = target.kind === 'anchor' ? document.uri : vscode.Uri.file(path.resolve(path.dirname(document.uri.fsPath), target.path));
      const fragment: string | undefined = target.fragment;
      let message: string | undefined;
      if (uri.toString() !== document.uri.toString()) {
        const key = `${uri.toString()}|${Boolean(fragment)}`;
        if (!targets.has(key)) targets.set(key, this.readTarget(uri, Boolean(fragment)));
        const source = await targets.get(key);
        if (source === undefined) message = vscode.l10n.t('Link target does not exist or cannot be read: {0}', link.href);
        else if (fragment && isMarkdownDocumentPath(uri.fsPath)) message = missingAnchor(source, fragment);
      } else if (fragment) message = missingAnchor(text, fragment);
      if (message) {
        const diagnostic = new vscode.Diagnostic(new vscode.Range(document.positionAt(link.from), document.positionAt(link.to)), message, vscode.DiagnosticSeverity.Warning);
        diagnostic.source = 'Markda links';
        results.push(diagnostic);
      }
    }
    if (generation === this.generation && version === document.version) this.diagnostics.set(document.uri, results);
  }

  private async readTarget(uri: vscode.Uri, withContent: boolean): Promise<string | undefined> {
    try {
      await vscode.workspace.fs.stat(uri);
      if (!withContent || !isMarkdownDocumentPath(uri.fsPath)) return '';
      const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
      if (open) return open.getText();
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch { return undefined; }
  }

  private async documents(): Promise<vscode.TextDocument[]> {
    const uris = await vscode.workspace.findFiles(pattern, exclude, 5001);
    if (uris.length > 5000) throw new Error(vscode.l10n.t('This workspace has more than 5,000 Markdown files. Open a smaller workspace to review links.'));
    const result: vscode.TextDocument[] = [];
    for (const uri of uris) {
      try { result.push(await vscode.workspace.openTextDocument(uri)); }
      catch { throw new Error(vscode.l10n.t('Cannot read {0}. Link review was cancelled to avoid incomplete updates.', uri.fsPath)); }
    }
    return result;
  }

  async refreshBacklinks(document = this.current): Promise<void> {
    if (!document) return;
    const generation = ++this.backlinkGeneration;
    const { extractLocalLinks } = await import('./workspaceLinks.js');
    const items: vscode.TreeItem[] = [];
    for (const source of await this.documents()) {
      if (source.uri.toString() === document.uri.toString()) continue;
      const link = extractLocalLinks(source.getText()).find((link) => {
        const target = parseDocumentLink(link.href);
        return target.kind === 'local' && path.resolve(path.dirname(source.uri.fsPath), target.path) === document.uri.fsPath;
      });
      if (!link) continue;
      const item = new vscode.TreeItem(path.basename(source.uri.fsPath));
      item.description = vscode.workspace.asRelativePath(source.uri);
      item.resourceUri = source.uri;
      item.iconPath = new vscode.ThemeIcon('references');
      item.command = { command: 'markda.open', title: vscode.l10n.t('Open referring document'), arguments: [source.uri] };
      items.push(item);
    }
    if (generation !== this.backlinkGeneration) return;
    this.backlinks = items;
    this.changed.fire();
  }

  async prepareRename(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): Promise<vscode.WorkspaceEdit> {
    const edit = new vscode.WorkspaceEdit();
    if (!vscode.workspace.isTrusted || !vscode.workspace.getConfiguration('markda').get('links.updateOnRename', true)) return edit;
    const renames = files.filter((file) => file.oldUri.scheme === 'file' && file.newUri.scheme === 'file').map((file) => ({ oldPath: file.oldUri.fsPath, newPath: file.newUri.fsPath }));
    if (!renames.length) return edit;
    const { renameLinkEdits } = await import('./workspaceLinks.js');
    const candidates: Array<vscode.QuickPickItem & { document: vscode.TextDocument; version: number; from: number; to: number; insert: string }> = [];
    for (const document of await this.documents()) {
      const text = document.getText();
      for (const change of renameLinkEdits(text, document.uri.fsPath, renames)) candidates.push({
        label: vscode.workspace.asRelativePath(document.uri),
        description: `${text.slice(change.from, change.to)} → ${change.insert}`,
        detail: vscode.l10n.t('Line {0}', document.positionAt(change.from).line + 1),
        picked: true, document, version: document.version, ...change,
      });
    }
    if (!candidates.length) return edit;
    const selected = await vscode.window.showQuickPick(candidates, {
      canPickMany: true, title: vscode.l10n.t('Review link updates'),
      placeHolder: vscode.l10n.t('Select links to update with this rename. Escape renames without changing links.'),
    });
    for (const candidate of selected ?? []) {
      if (candidate.document.version !== candidate.version) throw new Error(vscode.l10n.t('A document changed during review. Retry the rename.'));
      edit.replace(candidate.document.uri, new vscode.Range(candidate.document.positionAt(candidate.from), candidate.document.positionAt(candidate.to)), candidate.insert);
    }
    return edit;
  }
}

function missingAnchor(text: string, fragment: string): string | undefined {
  let decoded: string;
  try { decoded = decodeURIComponent(fragment); } catch { return vscode.l10n.t('Invalid heading anchor: {0}', fragment); }
  return headingAnchors(text).some((heading) => heading.slug === decoded) ? undefined : vscode.l10n.t('Heading anchor not found: {0}', decoded);
}
