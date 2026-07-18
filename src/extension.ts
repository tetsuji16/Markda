import * as vscode from 'vscode';
import { ExportService } from './exportService.js';
import { MarkdaEditorProvider } from './editorProvider.js';
import { FileProvider } from './fileProvider.js';
import { OutlineProvider } from './outlineProvider.js';
import type { Heading } from './protocol.js';
import { getStatistics } from './statistics.js';

export function activate(context: vscode.ExtensionContext): void {
  if (vscode.env.uiKind !== vscode.UIKind.Desktop || vscode.env.remoteName) {
    void vscode.window.showWarningMessage('markda supports local VS Code Desktop workspaces only.');
    return;
  }

  const outline = new OutlineProvider();
  const files = new FileProvider(context);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  status.command = 'markda.showStatistics';
  const editor = new MarkdaEditorProvider(context, outline, status, (uri) => files.recordOpen(uri));
  const exporter = new ExportService();

  context.subscriptions.push(
    editor,
    status,
    vscode.window.registerCustomEditorProvider(MarkdaEditorProvider.viewType, editor, {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.window.registerTreeDataProvider('markda.outline', outline),
    vscode.window.registerTreeDataProvider('markda.files', files),
    vscode.workspace.onDidCreateFiles(() => void files.refresh()),
    vscode.workspace.onDidDeleteFiles(() => void files.refresh()),
    vscode.workspace.onDidRenameFiles(() => void files.refresh()),
    register('markda.open', async (uri?: vscode.Uri) => openWithMarkda(uri, files)),
    register('markda.newFile', () => createMarkdownFile(files)),
    register('markda.duplicate', () => duplicateDocument(editor.getActiveDocument(), files)),
    register('markda.toggleSourceMode', () => editor.sendCommand('toggleSourceMode')),
    register('markda.toggleFocusMode', () => editor.sendCommand('toggleFocusMode')),
    register('markda.toggleTypewriterMode', () => editor.sendCommand('toggleTypewriterMode')),
    register('markda.showOutline', () => vscode.commands.executeCommand('markda.outline.focus')),
    register('markda.showFiles', () => vscode.commands.executeCommand('markda.files.focus')),
    register('markda.filterOutline', async () => outline.setFilter(await vscode.window.showInputBox({ prompt: 'Filter headings', placeHolder: 'Heading text' }) ?? '')),
    register('markda.clearOutlineFilter', () => outline.setFilter('')),
    register('markda.searchWorkspace', () => vscode.commands.executeCommand('workbench.action.findInFiles')),
    register('markda.quickOpen', () => vscode.commands.executeCommand('workbench.action.quickOpen')),
    register('markda.filterFiles', async () => files.setFilter(await vscode.window.showInputBox({ prompt: 'Filter Markdown files', placeHolder: 'File or folder name' }) ?? '')),
    register('markda.clearFileFilter', () => files.setFilter('')),
    register('markda.showSearch', () => editor.sendCommand('showSearch')),
    register('markda.copyAsMarkdown', () => editor.sendCommand('copyAsMarkdown')),
    register('markda.pastePlainText', async () => editor.sendCommand('insertText', { text: await vscode.env.clipboard.readText() })),
    register('markda.insertTable', () => editor.sendCommand('insertTable')),
    register('markda.insertImage', () => editor.sendCommand('insertImage')),
    register('markda.insertMathBlock', () => editor.sendCommand('insertMathBlock')),
    register('markda.toggleBold', () => editor.sendCommand('toggleBold')),
    register('markda.toggleItalic', () => editor.sendCommand('toggleItalic')),
    register('markda.toggleInlineCode', () => editor.sendCommand('toggleInlineCode')),
    register('markda.insertLink', () => editor.sendCommand('insertLink')),
    register('markda.toggleBulletList', () => editor.sendCommand('toggleBulletList')),
    register('markda.toggleTaskList', () => editor.sendCommand('toggleTaskList')),
    register('markda.focusHeading', (heading: Heading) => editor.sendCommand('focusHeading', heading)),
    register('markda.showStatistics', () => showStatistics(editor.getActiveDocument())),
    register('markda.exportHtml', () => exportActive(editor, exporter, true)),
    register('markda.exportHtmlBare', () => exportActive(editor, exporter, false)),
    register('markda.exportWithPrevious', async () => {
      const document = editor.getActiveDocument();
      if (document) await exporter.exportPrevious(document);
    }),
    register('markda.openThemeFolder', () => openThemeFolder(context)),
  );
  void files.refresh();
}

export function deactivate(): void {}

function register(command: string, callback: (...args: any[]) => unknown): vscode.Disposable {
  return vscode.commands.registerCommand(command, callback);
}

async function openWithMarkda(uri: vscode.Uri | undefined, files: FileProvider): Promise<void> {
  const resource = uri ?? vscode.window.activeTextEditor?.document.uri ?? await pickMarkdownFile();
  if (resource) {
    await vscode.commands.executeCommand('vscode.openWith', resource, MarkdaEditorProvider.viewType);
    files.recordOpen(resource);
  }
}

async function pickMarkdownFile(): Promise<vscode.Uri | undefined> {
  return (await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Markdown: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'txt'] },
  }))?.[0];
}

async function createMarkdownFile(files: FileProvider): Promise<void> {
  const target = await vscode.window.showSaveDialog({ filters: { Markdown: ['md', 'markdown'] }, saveLabel: 'Create' });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, new Uint8Array());
  await openWithMarkda(target, files);
}

async function duplicateDocument(document: vscode.TextDocument | undefined, files: FileProvider): Promise<void> {
  if (!document) return;
  const parsed = document.uri.path.match(/^(.*?)(\.[^./]+)?$/u);
  const target = await vscode.window.showSaveDialog({
    defaultUri: document.uri.with({ path: `${parsed?.[1] ?? document.uri.path}-copy${parsed?.[2] ?? '.md'}` }),
    filters: { Markdown: ['md', 'markdown', 'txt'] },
    saveLabel: 'Duplicate',
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(document.getText(), 'utf8'));
  await openWithMarkda(target, files);
}

async function showStatistics(document?: vscode.TextDocument): Promise<void> {
  if (!document) return;
  const stat = getStatistics(document.getText());
  await vscode.window.showInformationMessage(
    `${stat.words} words · ${stat.characters} characters · ${stat.lines} lines · ${stat.readingMinutes} min read`,
    { modal: false },
  );
}

async function exportActive(editor: MarkdaEditorProvider, exporter: ExportService, styled: boolean): Promise<void> {
  const document = editor.getActiveDocument();
  if (!document) {
    void vscode.window.showWarningMessage('markda: No active markda document.');
    return;
  }
  await exporter.exportHtml(document, styled);
}

async function openThemeFolder(context: vscode.ExtensionContext): Promise<void> {
  const themeFolder = vscode.Uri.joinPath(context.globalStorageUri, 'themes');
  await vscode.workspace.fs.createDirectory(themeFolder);
  await writeIfMissing(vscode.Uri.joinPath(themeFolder, 'README.md'), Buffer.from('# markda themes\n\nCreate `<theme-name>.css` here, then set `markda.theme.light` or `markda.theme.dark` to the file name without `.css`.\n', 'utf8'));
  await writeIfMissing(vscode.Uri.joinPath(themeFolder, 'custom-example.css'), Buffer.from('/* Example: uncomment and customize. */\n/* .cm-content { font-family: Georgia, serif; } */\n', 'utf8'));
  await vscode.commands.executeCommand('revealFileInOS', themeFolder);
}

async function writeIfMissing(uri: vscode.Uri, value: Uint8Array): Promise<void> {
  try { await vscode.workspace.fs.stat(uri); }
  catch { await vscode.workspace.fs.writeFile(uri, value); }
}
