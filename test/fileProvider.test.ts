import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFiles } = vi.hoisted(() => ({ findFiles: vi.fn() }));
const workspaceRoot = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';

function uri(value: string): { fsPath: string; toString(): string } {
  const fsPath = path.resolve(value);
  return { fsPath, toString: () => `file:///${fsPath.replaceAll('\\', '/')}` };
}

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
  Uri: class {
    private constructor(readonly fsPath: string) {}
    static file(value: string) { return new this(value); }
    static parse(value: string) {
      const pathValue = decodeURIComponent(value.replace(/^file:\/\/\/?/u, ''));
      return new this(process.platform === 'win32'
        ? pathValue.replace(/^\/([A-Za-z]:\/)/u, '$1').replaceAll('/', '\\')
        : pathValue);
    }
    toString(): string { return `file:///${this.fsPath.replaceAll('\\', '/')}`; }
  },
  workspace: {
    findFiles,
    workspaceFolders: [{ name: 'workspace', uri: { fsPath: process.platform === 'win32' ? 'C:\\workspace' : '/workspace' } }],
    getWorkspaceFolder: () => ({ name: 'workspace', uri: { fsPath: process.platform === 'win32' ? 'C:\\workspace' : '/workspace' } }),
  },
  TreeItem: class {
    description?: string;
    constructor(readonly label: string, public collapsibleState: number) {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(readonly id: string) {} },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
}));

import { FileProvider } from '../src/fileProvider.js';

describe('FileProvider', () => {
  beforeEach(() => findFiles.mockReset());

  it('coalesces initial scans and applies later file changes incrementally', async () => {
    let finishScan: ((value: ReturnType<typeof uri>[]) => void) | undefined;
    findFiles.mockReturnValue(new Promise<ReturnType<typeof uri>[]>((resolve) => { finishScan = resolve; }));
    const context = {
      globalState: {
        get: vi.fn((_key: string, fallback: string[]) => fallback),
        update: vi.fn(async () => undefined),
      },
    };
    const provider = new FileProvider(context as never);

    const first = provider.getChildren();
    const second = provider.getChildren();
    finishScan?.([uri(path.join(workspaceRoot, 'docs', 'a.md'))]);
    await Promise.all([first, second]);

    expect(findFiles).toHaveBeenCalledTimes(1);

    provider.addFiles([
      uri(path.join(workspaceRoot, 'docs', 'b.md')) as never,
      uri(path.join(workspaceRoot, 'docs', 'ignored.ts')) as never,
    ]);
    expect(findFiles).toHaveBeenCalledTimes(1);

    const roots = await provider.getChildren();
    const docs = roots.find((item) => item.label === 'docs');
    const files = docs ? await provider.getChildren(docs) : [];
    expect(files.map((item) => item.label)).toEqual(['a.md', 'b.md']);
  });

  it('updates descendants when a folder is renamed or deleted', async () => {
    findFiles.mockResolvedValue([
      uri(path.join(workspaceRoot, 'old', 'a.md')),
      uri(path.join(workspaceRoot, 'old', 'nested', 'b.md')),
    ]);
    const provider = new FileProvider({
      globalState: { get: () => [], update: vi.fn(async () => undefined) },
    } as never);
    await provider.getChildren();

    provider.renameFiles([{
      oldUri: uri(path.join(workspaceRoot, 'old')) as never,
      newUri: uri(path.join(workspaceRoot, 'new')) as never,
    }]);
    let roots = await provider.getChildren();
    expect(roots.map((item) => item.label)).toEqual(['new']);

    provider.deleteFiles([uri(path.join(workspaceRoot, 'new')) as never]);
    roots = await provider.getChildren();
    expect(roots).toHaveLength(0);
  });

  it('renames and deletes recent and pinned entries and persists both lists', async () => {
    const oldFile = uri(path.join(workspaceRoot, 'old', 'a.md'));
    const newFile = uri(path.join(workspaceRoot, 'new', 'a.md'));
    const updates = vi.fn(async () => undefined);
    const provider = new FileProvider({
      globalState: {
        get: (key: string) => key.endsWith('recentFiles') ? [oldFile.toString()] : [oldFile.toString()],
        update: updates,
      },
    } as never);
    findFiles.mockResolvedValue([oldFile]);
    await provider.getChildren();

    provider.renameFiles([{ oldUri: uri(path.join(workspaceRoot, 'old')) as never, newUri: uri(path.join(workspaceRoot, 'new')) as never }]);
    let roots = await provider.getChildren();
    const recent = roots.find((item) => item.label === 'Recent');
    const pinned = roots.find((item) => item.label === 'Pinned');
    expect(recent && (await provider.getChildren(recent)).map((item) => (item as { uri: { fsPath: string } }).uri.fsPath)).toEqual([newFile.fsPath]);
    expect(pinned && (await provider.getChildren(pinned)).map((item) => (item as { uri: { fsPath: string } }).uri.fsPath)).toEqual([newFile.fsPath]);
    expect(updates).toHaveBeenCalledWith('markda.recentFiles', [newFile.toString()]);

    provider.deleteFiles([uri(path.join(workspaceRoot, 'new')) as never]);
    roots = await provider.getChildren();
    expect(roots.some((item) => item.label === 'Recent' || item.label === 'Pinned')).toBe(false);
    expect(updates).toHaveBeenCalledWith('markda.recentFiles', []);
    expect(updates).toHaveBeenCalledWith('markda.pinnedFiles', []);
  });

  it('applies rename and delete events received before the initial scan completes', async () => {
    let finishScan: ((value: ReturnType<typeof uri>[]) => void) | undefined;
    findFiles.mockReturnValue(new Promise<ReturnType<typeof uri>[]>((resolve) => { finishScan = resolve; }));
    const provider = new FileProvider({
      globalState: { get: () => [], update: vi.fn(async () => undefined) },
    } as never);
    const pending = provider.getChildren();
    provider.renameFiles([{ oldUri: uri(path.join(workspaceRoot, 'old')) as never, newUri: uri(path.join(workspaceRoot, 'new')) as never }]);
    provider.deleteFiles([uri(path.join(workspaceRoot, 'gone')) as never]);
    finishScan?.([
      uri(path.join(workspaceRoot, 'old', 'a.md')),
      uri(path.join(workspaceRoot, 'gone', 'b.md')),
      uri(path.join(workspaceRoot, 'keep.md')),
    ]);
    await pending;
    const roots = await provider.getChildren();
    expect(roots.map((item) => item.label)).toEqual(['new', 'keep.md']);
  });

  it('does not rebuild the complete tree when the active file is reported twice', async () => {
    findFiles.mockResolvedValue([uri(path.join(workspaceRoot, 'docs', 'a.md'))]);
    const context = {
      globalState: {
        get: () => [],
        update: vi.fn(async () => undefined),
      },
    };
    const provider = new FileProvider(context as never);
    await provider.getChildren();
    const active = uri(path.join(workspaceRoot, 'docs', 'a.md')) as never;

    provider.recordOpen(active);
    provider.recordOpen(active);

    expect(context.globalState.update).toHaveBeenCalledTimes(1);
  });
});
