import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ set: vi.fn(), delete: vi.fn(), clear: vi.fn(), stat: vi.fn(), readFile: vi.fn(), findFiles: vi.fn(), openTextDocument: vi.fn(), showQuickPick: vi.fn() }));
vi.mock('vscode', () => ({
  l10n: { t: (value: string, ...args: unknown[]) => value.replace(/\{(\d+)\}/gu, (_, index) => String(args[Number(index)])) },
  Uri: { file: (fsPath: string) => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` }) },
  languages: { createDiagnosticCollection: () => ({ ...mocks, dispose: vi.fn() }) },
  EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
  Range: class { constructor(public start: unknown, public end: unknown) {} },
  Diagnostic: class { constructor(public range: unknown, public message: string, public severity: number) {} },
  DiagnosticSeverity: { Warning: 1 },
  TreeItem: class { constructor(public label: string) {} },
  ThemeIcon: class { constructor(public id: string) {} },
  WorkspaceEdit: class { entries: unknown[] = []; replace(...args: unknown[]) { this.entries.push(args); } },
  workspace: { isTrusted: true, textDocuments: [], fs: { stat: mocks.stat, readFile: mocks.readFile }, findFiles: mocks.findFiles, openTextDocument: mocks.openTextDocument, asRelativePath: (uri: {fsPath: string}) => uri.fsPath, getWorkspaceFolder: () => undefined, getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  window: { showQuickPick: mocks.showQuickPick },
}));
import { LinkService } from '../src/linkService.js';
function document(text: string, fsPath = '/workspace/a.md') {
  return { uri: { fsPath, scheme: 'file', toString: () => `file://${fsPath}` }, version: 1, getText: () => text, positionAt: (offset: number) => ({ line: text.slice(0, offset).split('\n').length - 1, character: offset }) };
}
describe('workspace link integration', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.stat.mockResolvedValue({}); mocks.readFile.mockResolvedValue(Buffer.from('# Present')); mocks.findFiles.mockResolvedValue([]); });
  it('reports missing files and anchors but ignores code and remote links', async () => {
    mocks.stat.mockImplementation(async (uri) => { if (uri.fsPath.endsWith('missing.png')) throw new Error('missing'); return {}; });
    const service = new LinkService();
    await service.check(document('# Present\n[good](#present) [bad](#absent) ![image](missing.png)\n`[code](missing.md)` [remote](https://example.com)') as never);
    expect(mocks.set.mock.calls[0]?.[1].map((diagnostic: {message: string}) => diagnostic.message)).toEqual(['Heading anchor not found: absent', 'Link target does not exist or cannot be read: missing.png']);
    service.dispose();
  });
  it('checks target anchors even when a file-only link appears first', async () => {
    const service = new LinkService();
    await service.check(document('[file](b.md) [heading](b.md#absent)') as never);
    expect(mocks.set.mock.calls[0]?.[1]).toHaveLength(1);
    service.dispose();
  });
  it('never touches link targets outside the document boundary, including UNC hosts', async () => {
    const service = new LinkService();
    await service.check(document('[unc](//attacker.example/share/x.md#h) [up](../outside.md) [abs](/etc/notes.md) [ok](b.md)') as never);
    const touched = [...mocks.stat.mock.calls, ...mocks.readFile.mock.calls].map(([uri]) => (uri as { fsPath: string }).fsPath);
    expect(touched).toHaveLength(1);
    expect(touched[0]).toMatch(/[\\/]workspace[\\/]b\.md$/u);
    expect(mocks.set.mock.calls[0]?.[1]).toEqual([]);
    service.dispose();
  });
  it('offers before/after link review and returns a single workspace edit', async () => {
    const doc = document('[target](b.md#present)\n```\n[x](b.md)\n```');
    mocks.findFiles.mockResolvedValue([doc.uri]); mocks.openTextDocument.mockResolvedValue(doc);
    mocks.showQuickPick.mockImplementation(async (items) => items);
    const service = new LinkService();
    const edit = await service.prepareRename([{ oldUri: document('', '/workspace/b.md').uri, newUri: document('', '/workspace/c.md').uri }] as never);
    expect(mocks.showQuickPick.mock.calls[0]?.[0][0].description).toBe('b.md#present → c.md#present');
    expect((edit as unknown as {entries: unknown[]}).entries).toHaveLength(1);
    service.dispose();
  });
  it('does not overwrite documents changed during rename review', async () => {
    const doc = document('[target](b.md)');
    mocks.findFiles.mockResolvedValue([doc.uri]); mocks.openTextDocument.mockResolvedValue(doc);
    mocks.showQuickPick.mockImplementation(async (items) => { doc.version++; return items; });
    const service = new LinkService();
    await expect(service.prepareRename([{ oldUri: document('', '/workspace/b.md').uri, newUri: document('', '/workspace/c.md').uri }] as never)).rejects.toThrow('changed during review');
    service.dispose();
  });
});
