import * as path from 'node:path';
import * as vscode from 'vscode';

const markdownPattern = '**/*.{md,markdown,mdown,mkd,mkdn,mdwn,txt}';
type Node = FolderItem | FileItem;

export class FileProvider implements vscode.TreeDataProvider<Node> {
  private readonly changeEmitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private files: readonly vscode.Uri[] = [];
  private roots: Node[] = [];
  private contentRoots: Node[] = [];
  private fileItems = new Map<string, FileItem>();
  private filter = '';
  private recent: vscode.Uri[];
  private current = '';
  private hasFetched = false;
  private refreshPromise: Promise<void> | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.recent = context.globalState.get<string[]>('markda.recentFiles', []).map((value) => vscode.Uri.parse(value));
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchFiles();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  addFiles(uris: readonly vscode.Uri[]): void {
    if (!this.hasFetched) return;
    const files = new Map(this.files.map((uri) => [uri.toString(), uri]));
    for (const uri of uris) if (isMarkdownUri(uri)) files.set(uri.toString(), uri);
    this.files = sortUris(files.values());
    this.rebuild();
  }

  deleteFiles(uris: readonly vscode.Uri[]): void {
    if (!this.hasFetched) return;
    this.files = this.files.filter((file) => !uris.some((uri) => isSameOrDescendant(uri.fsPath, file.fsPath)));
    this.rebuild();
  }

  renameFiles(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): void {
    if (!this.hasFetched) return;
    const next = new Map<string, vscode.Uri>();
    for (const uri of this.files) {
      const rename = files.find((file) => isSameOrDescendant(file.oldUri.fsPath, uri.fsPath));
      if (!rename) {
        next.set(uri.toString(), uri);
        continue;
      }
      const relative = path.relative(rename.oldUri.fsPath, uri.fsPath);
      const replacement = vscode.Uri.file(path.join(rename.newUri.fsPath, relative));
      if (isMarkdownUri(replacement)) next.set(replacement.toString(), replacement);
    }
    this.files = sortUris(next.values());
    this.rebuild();
  }

  setFilter(value: string): void {
    this.filter = value.trim().toLowerCase();
    this.rebuild();
  }

  recordOpen(uri: vscode.Uri): void {
    const key = uri.toString();
    if (this.current === key && this.recent[0]?.toString() === key) return;
    const previous = this.current;
    this.current = key;
    this.recent = [uri, ...this.recent.filter((item) => item.toString() !== key)].slice(0, 10);
    void this.context.globalState.update('markda.recentFiles', this.recent.map((item) => item.toString()));
    this.fileItems.get(previous)?.setActive(false);
    this.fileItems.get(key)?.setActive(true);
    this.rebuildRecent();
  }

  getTreeItem(element: Node): vscode.TreeItem { return element; }
  async getChildren(element?: Node): Promise<Node[]> {
    if (!this.hasFetched) await this.refresh();
    return element instanceof FolderItem ? element.children : element ? [] : this.roots;
  }

  private rebuild(): void {
    const root = new FolderItem('', '');
    const fileItems = new Map<string, FileItem>();
    for (const uri of this.files) {
      const workspace = vscode.workspace.getWorkspaceFolder(uri);
      const workspaceRelative = workspace ? path.relative(workspace.uri.fsPath, uri.fsPath) : uri.fsPath;
      const relative = workspace && (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? path.join(workspace.name, workspaceRelative) : workspaceRelative;
      if (this.filter && !relative.toLowerCase().includes(this.filter)) continue;
      const parts = relative.split(path.sep);
      let folder = root;
      for (const segment of parts.slice(0, -1)) {
        let child = folder.folder(segment);
        if (!child) {
          child = new FolderItem(segment, folder.relativePath ? path.join(folder.relativePath, segment) : segment);
          folder.addFolder(segment, child);
        }
        folder = child;
      }
      const item = new FileItem(uri, relative, uri.toString() === this.current);
      folder.children.push(item);
      fileItems.set(uri.toString(), item);
    }
    sortNodes(root);
    this.fileItems = fileItems;
    this.contentRoots = root.children;
    this.rebuildRecent();
  }

  private rebuildRecent(): void {
    const recent = new FolderItem(vscode.l10n.t('Recent'), '');
    recent.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    recent.iconPath = new vscode.ThemeIcon('history');
    recent.children.push(...this.recent.filter((uri) => !this.filter || uri.fsPath.toLowerCase().includes(this.filter)).map((uri) => new FileItem(uri, vscode.l10n.t('Recent'), uri.toString() === this.current)));
    this.roots = recent.children.length ? [recent, ...this.contentRoots] : this.contentRoots;
    this.changeEmitter.fire(undefined);
  }

  private async fetchFiles(): Promise<void> {
    const files = await vscode.workspace.findFiles(markdownPattern, '**/{node_modules,.git}/**', 5000);
    this.files = sortUris(files);
    this.hasFetched = true;
    this.rebuild();
  }
}

class FolderItem extends vscode.TreeItem {
  readonly children: Node[] = [];
  private readonly folders = new Map<string, FolderItem>();
  constructor(readonly label: string, readonly relativePath: string) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'markdaFolder';
  }
  folder(label: string): FolderItem | undefined { return this.folders.get(label); }
  addFolder(label: string, folder: FolderItem): void {
    this.folders.set(label, folder);
    this.children.push(folder);
  }
}

class FileItem extends vscode.TreeItem {
  private readonly defaultDescription: string;
  constructor(readonly uri: vscode.Uri, relative: string, active = false) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);
    this.resourceUri = uri;
    this.defaultDescription = path.dirname(relative) === '.' ? '' : path.dirname(relative);
    this.command = { command: 'markda.open', title: vscode.l10n.t('Open with markda'), arguments: [uri] };
    this.contextValue = 'markdaFile';
    this.accessibilityInformation = { label: `${path.basename(uri.fsPath)}, ${relative}` };
    this.setActive(active);
  }
  setActive(active: boolean): void {
    this.description = active ? vscode.l10n.t('current') : this.defaultDescription;
    if (active) this.iconPath = new vscode.ThemeIcon('arrow-right');
    else Reflect.deleteProperty(this, 'iconPath');
  }
}

function sortNodes(folder: FolderItem): void {
  folder.children.sort((a, b) => Number(a instanceof FileItem) - Number(b instanceof FileItem) || String(a.label).localeCompare(String(b.label)));
  for (const child of folder.children) if (child instanceof FolderItem) sortNodes(child);
}

function sortUris(uris: Iterable<vscode.Uri>): vscode.Uri[] {
  return [...uris].sort((a, b) => a.fsPath.localeCompare(b.fsPath));
}

function isMarkdownUri(uri: vscode.Uri): boolean {
  return /\.(?:md|markdown|mdown|mkd|mkdn|mdwn|txt)$/iu.test(uri.fsPath);
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
