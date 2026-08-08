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
    static parse(value: string) { return new this(value.replace(/^file:\/+/u, '')); }
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
