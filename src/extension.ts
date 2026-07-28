import * as vscode from 'vscode';
import * as path from 'node:path';
import type { ExportService } from './exportService.js';
import {
  applyMarkdaAssociations,
  defaultTextEditorViewType,
  markdaViewType,
  opensWithMarkda,
  supportedFileTypes,
} from './editorAssociations.js';
import { MarkdaEditorProvider } from './editorProvider.js';
import { FileProvider } from './fileProvider.js';
import { OutlineProvider } from './outlineProvider.js';
import type { Heading } from './protocol.js';
import { getStatistics } from './statistics.js';

export function activate(context: vscode.ExtensionContext): void {
  if (vscode.env.uiKind !== vscode.UIKind.Desktop || vscode.env.remoteName) {
    void vscode.window.showWarningMessage(vscode.l10n.t('markda supports local VS Code Desktop workspaces only.'));
    return;
  }

  const outline = new OutlineProvider();
  const files = new FileProvider(context);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  status.command = 'markda.showStatistics';
  const editor = new MarkdaEditorProvider(context, outline, status, (uri) => files.recordOpen(uri));
  let exporter: ExportService | undefined;
  async function getExporter(): Promise<ExportService> {
    if (!exporter) {
      const module = await import('./exportService.js');
      exporter = new module.ExportService(context.extensionUri);
    }
    return exporter;
  }

  context.subscriptions.push(
    editor,
    status,
    vscode.window.registerCustomEditorProvider(MarkdaEditorProvider.viewType, editor, {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.window.registerTreeDataProvider('markda.outline', outline),
    vscode.window.registerTreeDataProvider('markda.files', files),
    vscode.workspace.onDidCreateFiles((event) => files.addFiles(event.files)),
    vscode.workspace.onDidDeleteFiles((event) => files.deleteFiles(event.files)),
    vscode.workspace.onDidRenameFiles((event) => files.renameFiles(event.files)),
    register('markda.open', async (uri?: vscode.Uri) => openWithMarkda(uri)),
    register('markda.reopenWith', () => reopenWithAnotherEditor(editor.getActiveDocument())),
    register('markda.configureFileAssociations', () => configureFileAssociations()),
    register('markda.newFile', () => createMarkdownFile()),
    register('markda.duplicate', () => duplicateDocument(editor.getActiveDocument())),
    register('markda.toggleSourceMode', () => editor.sendCommand('toggleSourceMode')),
    register('markda.toggleFocusMode', () => editor.sendCommand('toggleFocusMode')),
    register('markda.toggleTypewriterMode', () => editor.sendCommand('toggleTypewriterMode')),
    register('markda.showOutline', () => vscode.commands.executeCommand('markda.outline.focus')),
    register('markda.showFiles', () => vscode.commands.executeCommand('markda.files.focus')),
    register('markda.filterOutline', async () => outline.setFilter(await vscode.window.showInputBox({ prompt: vscode.l10n.t('Filter headings'), placeHolder: vscode.l10n.t('Heading text') }) ?? '')),
    register('markda.clearOutlineFilter', () => outline.setFilter('')),
    register('markda.renameHeading', (item: { heading?: Heading } | Heading) => editHeading(editor.getActiveDocument(), itemHeading(item), 'rename')),
    register('markda.promoteHeading', (item: { heading?: Heading } | Heading) => editHeading(editor.getActiveDocument(), itemHeading(item), 'promote')),
    register('markda.demoteHeading', (item: { heading?: Heading } | Heading) => editHeading(editor.getActiveDocument(), itemHeading(item), 'demote')),
    register('markda.moveHeadingUp', (item: { heading?: Heading } | Heading) => moveHeadingSection(editor.getActiveDocument(), outline.getHeadings(), itemHeading(item), -1)),
    register('markda.moveHeadingDown', (item: { heading?: Heading } | Heading) => moveHeadingSection(editor.getActiveDocument(), outline.getHeadings(), itemHeading(item), 1)),
    register('markda.searchWorkspace', () => vscode.commands.executeCommand('workbench.action.findInFiles')),
    register('markda.quickOpen', () => vscode.commands.executeCommand('workbench.action.quickOpen')),
    register('markda.filterFiles', async () => files.setFilter(await vscode.window.showInputBox({ prompt: vscode.l10n.t('Filter Markdown files'), placeHolder: vscode.l10n.t('File or folder name') }) ?? '')),
    register('markda.clearFileFilter', () => files.setFilter('')),
    register('markda.auditImages', () => auditDocumentImages(editor.getActiveDocument())),
    register('markda.pinFile', (item: vscode.Uri | { uri?: vscode.Uri; resourceUri?: vscode.Uri }) => { const uri = itemUri(item); if (uri) files.togglePin(uri); }),
    register('markda.renameFile', (item: vscode.Uri | { uri?: vscode.Uri; resourceUri?: vscode.Uri }) => renameMarkdownFile(itemUri(item))),
    register('markda.deleteFile', (item: vscode.Uri | { uri?: vscode.Uri; resourceUri?: vscode.Uri }) => deleteMarkdownFile(itemUri(item))),
    register('markda.revealFile', (item: vscode.Uri | { uri?: vscode.Uri; resourceUri?: vscode.Uri }) => { const uri = itemUri(item); if (uri) void vscode.commands.executeCommand('revealFileInOS', uri); }),
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
    register('markda.toggleOrderedList', () => editor.sendCommand('toggleOrderedList')),
    register('markda.toggleTaskList', () => editor.sendCommand('toggleTaskList')),
    register('markda.toggleBlockquote', () => editor.sendCommand('toggleBlockquote')),
    register('markda.toggleStrikethrough', () => editor.sendCommand('toggleStrikethrough')),
    register('markda.insertCodeBlock', () => editor.sendCommand('insertCodeBlock')),
    register('markda.clearFormatting', () => editor.sendCommand('clearFormatting')),
    register('markda.focusHeading', (heading: Heading) => editor.sendCommand('focusHeading', heading)),
    register('markda.showStatistics', () => showStatistics(editor.getActiveDocument())),
    register('markda.exportHtml', async () => exportActive(editor, await getExporter(), true)),
    register('markda.exportHtmlBare', async () => exportActive(editor, await getExporter(), false)),
    register('markda.exportPdf', async () => {
      const document = editor.getActiveDocument();
      if (document) await (await getExporter()).exportPdf(document);
    }),
    register('markda.exportImage', async () => {
      const document = editor.getActiveDocument();
      if (document) await (await getExporter()).exportImage(document);
    }),
    register('markda.exportExternal', async () => {
      const document = editor.getActiveDocument();
      if (document) await (await getExporter()).exportExternal(document);
    }),
    register('markda.exportWithPrevious', async () => {
      const document = editor.getActiveDocument();
      if (document) await (await getExporter()).exportPrevious(document);
    }),
    register('markda.openThemeFolder', () => openThemeFolder(context)),
    register('markda.chooseTheme', () => chooseTheme(context)),
    register('markda.applyPreset', () => applyWritingPreset(editor.getActiveDocument()?.uri)),
  );
}

export function deactivate(): void {}

function register(command: string, callback: (...args: any[]) => unknown): vscode.Disposable {
  return vscode.commands.registerCommand(command, callback);
}

async function openWithMarkda(uri?: vscode.Uri): Promise<void> {
  const resource = uri ?? vscode.window.activeTextEditor?.document.uri ?? await pickMarkdownFile();
  if (resource) {
    await vscode.commands.executeCommand('vscode.openWith', resource, markdaViewType);
  }
}

async function reopenWithAnotherEditor(document?: vscode.TextDocument): Promise<void> {
  if (!document) {
    void vscode.window.showWarningMessage(vscode.l10n.t('markda: No active markda document.'));
    return;
  }

  const selected = await vscode.window.showQuickPick([
    {
      label: vscode.l10n.t('VS Code Text Editor'),
      description: vscode.l10n.t('Open this file once with the default text editor'),
      action: 'text',
    },
    {
      label: vscode.l10n.t('Choose Another Editor...'),
      description: vscode.l10n.t('Select from all editors available for this file'),
      action: 'picker',
    },
    {
      label: vscode.l10n.t('Configure File Associations...'),
      description: vscode.l10n.t('Choose which file types open with markda by default'),
      action: 'configure',
    },
  ], {
    placeHolder: vscode.l10n.t('Reopen with another editor'),
  });

  if (selected?.action === 'text') {
    await vscode.commands.executeCommand('vscode.openWith', document.uri, defaultTextEditorViewType);
  } else if (selected?.action === 'picker') {
    await vscode.commands.executeCommand('workbench.action.reopenWithEditor');
  } else if (selected?.action === 'configure') {
    await configureFileAssociations();
  }
}

interface AssociationQuickPickItem extends vscode.QuickPickItem {
  readonly pattern: string;
}

interface ConfigurationTargetQuickPickItem extends vscode.QuickPickItem {
  readonly target: vscode.ConfigurationTarget;
}

async function configureFileAssociations(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('workbench');
  const effective = configuration.get<Record<string, string>>('editorAssociations', {});
  const items: AssociationQuickPickItem[] = supportedFileTypes.map(({ pattern, description }) => ({
    label: pattern,
    description,
    pattern,
    picked: opensWithMarkda(effective, pattern),
  }));
  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: vscode.l10n.t('Select file types to open with markda by default'),
    title: vscode.l10n.t('markda File Associations'),
  });
  if (!selected) return;

  let target = vscode.ConfigurationTarget.Global;
  if (vscode.workspace.workspaceFolders?.length) {
    const targetItem = await vscode.window.showQuickPick<ConfigurationTargetQuickPickItem>([
      {
        label: vscode.l10n.t('User'),
        description: vscode.l10n.t('Use these associations in every workspace'),
        target: vscode.ConfigurationTarget.Global,
      },
      {
        label: vscode.l10n.t('Workspace'),
        description: vscode.l10n.t('Use these associations only in this workspace'),
        target: vscode.ConfigurationTarget.Workspace,
      },
    ], {
      placeHolder: vscode.l10n.t('Where should these file associations be saved?'),
    });
    if (!targetItem) return;
    target = targetItem.target;
  }

  const inspected = configuration.inspect<Record<string, string>>('editorAssociations');
  const scoped = target === vscode.ConfigurationTarget.Workspace
    ? inspected?.workspaceValue ?? {}
    : inspected?.globalValue ?? {};
  const selectedPatterns = new Set(selected.map((item) => item.pattern));
  await configuration.update(
    'editorAssociations',
    applyMarkdaAssociations(scoped, selectedPatterns),
    target,
  );

  const openSettings = vscode.l10n.t('Open Settings');
  const action = await vscode.window.showInformationMessage(
    vscode.l10n.t('markda file associations were saved in VS Code settings.'),
    openSettings,
  );
  if (action === openSettings) {
    await vscode.commands.executeCommand('workbench.action.openSettings', '@id:workbench.editorAssociations');
  }
}

async function pickMarkdownFile(): Promise<vscode.Uri | undefined> {
  return (await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Markdown: ['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'txt'] },
  }))?.[0];
}

async function createMarkdownFile(): Promise<void> {
  const target = await vscode.window.showSaveDialog({ filters: { Markdown: ['md', 'markdown'] }, saveLabel: vscode.l10n.t('Create') });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, new Uint8Array());
  await openWithMarkda(target);
}

async function duplicateDocument(document?: vscode.TextDocument): Promise<void> {
  if (!document) return;
  const parsed = path.parse(document.uri.fsPath);
  const target = await vscode.window.showSaveDialog({
    defaultUri: document.uri.with({ path: path.join(parsed.dir, `${parsed.name}-copy${parsed.ext || '.md'}`) }),
    filters: { Markdown: ['md', 'markdown', 'txt'] },
    saveLabel: vscode.l10n.t('Duplicate'),
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(document.getText(), 'utf8'));
  await openWithMarkda(target);
}

function itemUri(item: vscode.Uri | { uri?: vscode.Uri; resourceUri?: vscode.Uri } | undefined): vscode.Uri | undefined {
  if (!item) return undefined;
  if (item instanceof vscode.Uri) return item;
  return item.uri ?? item.resourceUri;
}

function itemHeading(item: { heading?: Heading } | Heading | undefined): Heading | undefined {
  if (!item) return undefined;
  return 'level' in item ? item as Heading : item.heading;
}

async function renameMarkdownFile(uri?: vscode.Uri): Promise<void> {
  if (!uri) return;
  const nextName = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Rename Markdown file'),
    value: path.basename(uri.fsPath),
    valueSelection: [0, path.basename(uri.fsPath, path.extname(uri.fsPath)).length],
  });
  if (!nextName || nextName === path.basename(uri.fsPath) || /[\\/:*?"<>|]/u.test(nextName)) return;
  await vscode.workspace.fs.rename(uri, vscode.Uri.file(path.join(path.dirname(uri.fsPath), nextName)), { overwrite: false });
}

async function deleteMarkdownFile(uri?: vscode.Uri): Promise<void> {
  if (!uri) return;
  const remove = vscode.l10n.t('Move to Trash');
  const picked = await vscode.window.showWarningMessage(
    vscode.l10n.t('Move {0} to trash?', path.basename(uri.fsPath)), { modal: true }, remove,
  );
  if (picked === remove) await vscode.workspace.fs.delete(uri, { useTrash: true });
}

async function auditDocumentImages(document?: vscode.TextDocument): Promise<void> {
  if (!document) return;
  const folder = path.dirname(document.uri.fsPath);
  const localSources = [...document.getText().matchAll(/!\[[^\]]*\]\((?:<)?([^)\s>]+)(?:>)?(?:\s+["'][^"']*["'])?\)/gu)]
    .map((match) => match[1]!)
    .filter((source) => !/^(?:https?:|data:|#)/iu.test(source))
    .map((source) => {
      try { return decodeURIComponent(source.replace(/\\([() ])/gu, '$1')); } catch { return source; }
    });
  const missing: string[] = [];
  for (const source of localSources) {
    try { await vscode.workspace.fs.stat(vscode.Uri.file(path.resolve(folder, source))); }
    catch { missing.push(source); }
  }
  const config = vscode.workspace.getConfiguration('markda', document.uri);
  const assetSetting = config.get<string>('image.folder', '${currentFileNameWithoutExt}.assets')
    .replaceAll('${currentFileNameWithoutExt}', path.parse(document.uri.fsPath).name);
  const assetFolder = path.resolve(folder, assetSetting || '.');
  let unused: vscode.Uri[] = [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(assetFolder));
    const used = new Set(localSources.map((source) => path.resolve(folder, source).toLocaleLowerCase()));
    unused = entries
      .filter(([name, type]) => type === vscode.FileType.File && /\.(?:png|jpe?g|gif|svg|webp)$/iu.test(name))
      .map(([name]) => vscode.Uri.file(path.join(assetFolder, name)))
      .filter((uri) => !used.has(uri.fsPath.toLocaleLowerCase()));
  } catch { /* An asset folder is optional. */ }
  const summary = vscode.l10n.t('{0} missing image references · {1} unused asset files', missing.length, unused.length);
  const review = unused.length ? vscode.l10n.t('Review Unused') : undefined;
  const selected = await vscode.window.showInformationMessage(summary, ...(review ? [review] : []));
  if (selected !== review || !review) return;
  const picked = await vscode.window.showQuickPick(unused.map((uri) => ({
    label: path.basename(uri.fsPath), description: path.dirname(uri.fsPath), uri, picked: true,
  })), { canPickMany: true, placeHolder: vscode.l10n.t('Select unused image files to move to trash') });
  if (!picked?.length) return;
  for (const item of picked) await vscode.workspace.fs.delete(item.uri, { useTrash: true });
}

async function editHeading(
  document: vscode.TextDocument | undefined,
  heading: Heading | undefined,
  operation: 'rename' | 'promote' | 'demote',
): Promise<void> {
  if (!document || !heading) return;
  const line = document.lineAt(document.positionAt(heading.from).line);
  const atx = line.text.match(/^(\s{0,3})(#{1,6})(\s+)(.*?)(\s+#*\s*)$/u);
  const level = atx?.[2]?.length ?? heading.level;
  let replacement = line.text;
  if (operation === 'rename') {
    const value = await vscode.window.showInputBox({ prompt: vscode.l10n.t('Rename heading'), value: heading.text });
    if (value === undefined || !value.trim()) return;
    replacement = atx
      ? `${atx[1]}${atx[2]}${atx[3]}${value.trim()}${atx[5]}`
      : value.trim();
  } else {
    const next = operation === 'promote' ? Math.max(1, level - 1) : Math.min(6, level + 1);
    if (next === level) return;
    replacement = atx
      ? `${atx[1]}${'#'.repeat(next)}${atx[3]}${atx[4]}${atx[5]}`
      : `${'#'.repeat(next)} ${line.text}`;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, line.range, replacement);
  await vscode.workspace.applyEdit(edit);
}

async function moveHeadingSection(
  document: vscode.TextDocument | undefined,
  headings: readonly Heading[],
  heading: Heading | undefined,
  direction: -1 | 1,
): Promise<void> {
  if (!document || !heading) return;
  const index = headings.findIndex((candidate) => candidate.from === heading.from);
  if (index < 0) return;
  const endIndex = headings.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.level <= heading.level);
  const sectionTo = endIndex < 0 ? document.getText().length : headings[endIndex]!.from;
  if (direction < 0) {
    let sibling = index - 1;
    while (sibling >= 0 && headings[sibling]!.level > heading.level) sibling--;
    if (sibling < 0 || headings[sibling]!.level !== heading.level) return;
    const previous = headings[sibling]!;
    const previousFrom = previous.from;
    const previousText = document.getText().slice(previousFrom, heading.from);
    const currentText = document.getText().slice(heading.from, sectionTo);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(document.positionAt(previousFrom), document.positionAt(sectionTo)), currentText + previousText);
    await vscode.workspace.applyEdit(edit);
    return;
  }
  const nextIndex = endIndex;
  if (nextIndex < 0 || !headings[nextIndex] || headings[nextIndex]!.level !== heading.level) return;
  const followingEndIndex = headings.findIndex((candidate, candidateIndex) => candidateIndex > nextIndex && candidate.level <= heading.level);
  const followingTo = followingEndIndex < 0 ? document.getText().length : headings[followingEndIndex]!.from;
  const currentText = document.getText().slice(heading.from, sectionTo);
  const nextText = document.getText().slice(sectionTo, followingTo);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(heading.from), document.positionAt(followingTo)), nextText + currentText);
  await vscode.workspace.applyEdit(edit);
}

async function chooseTheme(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.Uri.joinPath(context.globalStorageUri, 'themes');
  await vscode.workspace.fs.createDirectory(folder);
  const custom = (await vscode.workspace.fs.readDirectory(folder))
    .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.css'))
    .map(([name]) => name.slice(0, -4));
  const selected = await vscode.window.showQuickPick([...new Set(['paper', 'midnight', ...custom])], {
    placeHolder: vscode.l10n.t('Choose a markda theme'),
  });
  if (!selected) return;
  const mode = await vscode.window.showQuickPick([
    { label: vscode.l10n.t('Light'), key: 'theme.light' },
    { label: vscode.l10n.t('Dark'), key: 'theme.dark' },
  ], { placeHolder: vscode.l10n.t('Use theme for') });
  if (mode) await vscode.workspace.getConfiguration('markda').update(mode.key, selected, vscode.ConfigurationTarget.Global);
}

async function applyWritingPreset(uri?: vscode.Uri): Promise<void> {
  const preset = await vscode.window.showQuickPick([
    { label: vscode.l10n.t('Typora-like'), description: vscode.l10n.t('Centered writing, automatic theme, full live features'), width: 860, focus: false, typewriter: false },
    { label: vscode.l10n.t('Distraction-free writing'), description: vscode.l10n.t('Narrow measure with typewriter behavior'), width: 720, focus: true, typewriter: true },
    { label: vscode.l10n.t('Technical document'), description: vscode.l10n.t('Wide measure for tables, code, math, and diagrams'), width: 1100, focus: false, typewriter: false },
    { label: vscode.l10n.t('Fill VS Code editor'), description: vscode.l10n.t('Use all available editor width'), width: 0, focus: false, typewriter: false },
  ], { placeHolder: vscode.l10n.t('Choose a writing preset') });
  if (!preset) return;
  const configuration = vscode.workspace.getConfiguration('markda', uri);
  await Promise.all([
    configuration.update('editor.contentWidth', preset.width, vscode.ConfigurationTarget.Workspace),
    configuration.update('editor.typewriterKeepCentered', preset.typewriter, vscode.ConfigurationTarget.Workspace),
    configuration.update('markdown.math', true, vscode.ConfigurationTarget.Workspace),
    configuration.update('markdown.diagrams', true, vscode.ConfigurationTarget.Workspace),
  ]);
}

async function showStatistics(document?: vscode.TextDocument): Promise<void> {
  if (!document) return;
  const stat = getStatistics(document.getText());
  await vscode.window.showInformationMessage(
    vscode.l10n.t('{0} words · {1} characters · {2} lines · {3} min read', stat.words, stat.characters, stat.lines, stat.readingMinutes),
    { modal: false },
  );
}

async function exportActive(editor: MarkdaEditorProvider, exporter: ExportService, styled: boolean): Promise<void> {
  const document = editor.getActiveDocument();
  if (!document) {
    void vscode.window.showWarningMessage(vscode.l10n.t('markda: No active markda document.'));
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
