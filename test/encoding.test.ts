import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ pick: vi.fn(), warn: vi.fn(), error: vi.fn(), read: vi.fn(), open: vi.fn() }));
vi.mock('vscode', () => ({
  l10n: { t: (text: string) => text },
  window: { showQuickPick: api.pick, showWarningMessage: api.warn, showErrorMessage: api.error },
  workspace: { fs: { readFile: api.read }, openTextDocument: api.open },
}));
import { changeEncoding } from '../src/encoding.js';

beforeEach(() => vi.clearAllMocks());
describe('reopening with an encoding', () => {
  it('does not offer detection for an unsaved document', async () => {
    await changeEncoding({ isDirty: true, isUntitled: false } as never);
    expect(api.pick).not.toHaveBeenCalled();
    expect(api.open).not.toHaveBeenCalled();
  });
  it('reopens a clean document with the selected encoding', async () => {
    const uri = { path: '/test.txt' };
    api.pick.mockResolvedValue({ encoding: 'shiftjis' });
    await changeEncoding({ isDirty: false, isUntitled: false, uri } as never);
    expect(api.open).toHaveBeenCalledWith(uri, { encoding: 'shiftjis' });
  });
  it('detects Shift JIS and opens the original file with it', async () => {
    const uri = { path: '/test.txt' };
    const text = '日本語の文字コードを自動的に判別するためのテストです。'.repeat(10);
    const iconv = await import('iconv-lite');
    api.read.mockResolvedValue(iconv.encode(text, 'cp932'));
    api.pick.mockResolvedValue({ encoding: 'auto' });
    await changeEncoding({ isDirty: false, isUntitled: false, uri } as never);
    expect(api.open).toHaveBeenCalledWith(uri, { encoding: 'shiftjis' });
  });
  it('does not reopen when the document becomes dirty while selecting', async () => {
    const doc = { isDirty: false, isUntitled: false, uri: {} };
    api.pick.mockImplementation(async () => { doc.isDirty = true; return { encoding: 'utf8' }; });
    await changeEncoding(doc as never);
    expect(api.open).not.toHaveBeenCalled();
  });
});
