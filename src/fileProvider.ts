import * as path from 'node:path';
import * as vscode from 'vscode';

const markdownPattern = '**/*.{md,markdown,mdown,mkd,mkdn,mdwn,txt}';
type Node = FolderItem | FileItem;

export class FileProvider implements vscode.TreeDataProvider<Node> {
  private readonly changeEmitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private files: readonly vscode.Uri[] = [];
  private roots: Node[] = [];
  private filter = '';
  private recent: vscode.Uri[];
  private current = '';
  private hasFetched = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.recent = context.globalState.get<string[]>('markda.recentFiles', []).map((value) => vscode.Uri.parse(value));
  }

  async refresh(): Promise<void> {
    this.hasFetched = true;
    this.files = await vscode.workspace.findFiles(markdownPattern, '**/{node_modules,.git}/**', 5000);
    this.rebuild();
  }

  notifyFileChanges(): void {
    if (this.hasFetched) {
      void this.refresh();
    }
  }

  setFilter(value: string): void {
    this.filter = value.trim().toLocaleLowerCase();
    this.rebuild();
  }

  recordOpen(uri: vscode.Uri): void {
    this.current = uri.toString();
    this.recent = [uri, ...this.recent.filter((item) => item.toString() !== uri.toString())].slice(0, 10);
    void this.context.globalState.update('markda.recentFiles', this.recent.map((item) => item.toString()));
    this.rebuild();
  }

  getTreeItem(element: Node): vscode.TreeItem { return element; }
  async getChildren(element?: Node): Promise<Node[]> {
    if (!this.hasFetched) await this.refresh();
    return element instanceof FolderItem ? element.children : element ? [] : this.roots;
  }

  private rebuild(): void {
    const root = new FolderItem('', '');
    for (const uri of [...this.files].sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
      const workspace = vscode.workspace.getWorkspaceFolder(uri);
      const workspaceRelative = workspace ? path.relative(workspace.uri.fsPath, uri.fsPath) : uri.fsPath;
      const relative = workspace && (vscode.workspace.workspaceFolders?.length ?? 0) > 1 ? path.join(workspace.name, workspaceRelative) : workspaceRelative;
      if (this.filter && !relative.toLocaleLowerCase().includes(this.filter)) continue;
      const parts = relative.split(path.sep);
      let folder = root;
      for (const segment of parts.slice(0, -1)) {
        let child = folder.children.find((item): item is FolderItem => item instanceof FolderItem && item.label === segment);
        if (!child) {
          child = new FolderItem(segment, folder.relativePath ? path.join(folder.relativePath, segment) : segment);
          folder.children.push(child);
        }
        folder = child;
      }
      folder.children.push(new FileItem(uri, relative, uri.toString() === this.current));
    }
    sortNodes(root);
    const recent = new FolderItem('Recent', '');
    recent.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    recent.iconPath = new vscode.ThemeIcon('history');
    recent.children.push(...this.recent.filter((uri) => !this.filter || uri.fsPath.toLocaleLowerCase().includes(this.filter)).map((uri) => new FileItem(uri, 'Recent', uri.toString() === this.current)));
    this.roots = recent.children.length ? [recent, ...root.children] : root.children;
    this.changeEmitter.fire(undefined);
  }
}

class FolderItem extends vscode.TreeItem {
  readonly children: Node[] = [];
  constructor(readonly label: string, readonly relativePath: string) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'markdaFolder';
  }
}

class FileItem extends vscode.TreeItem {
  constructor(readonly uri: vscode.Uri, relative: string, active = false) {
    super(path.basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);
    this.resourceUri = uri;
    this.description = active ? 'current' : path.dirname(relative) === '.' ? '' : path.dirname(relative);
    this.command = { command: 'markda.open', title: 'Open with markda', arguments: [uri] };
    this.contextValue = 'markdaFile';
    if (active) this.iconPath = new vscode.ThemeIcon('arrow-right');
    this.accessibilityInformation = { label: `${path.basename(uri.fsPath)}, ${relative}` };
  }
}

function sortNodes(folder: FolderItem): void {
  folder.children.sort((a, b) => Number(a instanceof FileItem) - Number(b instanceof FileItem) || String(a.label).localeCompare(String(b.label)));
  for (const child of folder.children) if (child instanceof FolderItem) sortNodes(child);
}
