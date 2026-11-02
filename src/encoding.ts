import * as vscode from 'vscode';

const encodingChoices = [
  { label: 'UTF-8', encoding: 'utf8' },
  { label: 'UTF-8 with BOM', encoding: 'utf8bom' },
  { label: 'Shift JIS (CP932)', encoding: 'shiftjis' },
  { label: 'EUC-JP', encoding: 'eucjp' },
  { label: 'UTF-16 LE', encoding: 'utf16le' },
  { label: 'UTF-16 BE', encoding: 'utf16be' },
  { label: 'GB18030', encoding: 'gb18030' },
  { label: 'GBK', encoding: 'gbk' },
  { label: 'Big5', encoding: 'cp950' },
  { label: 'EUC-KR', encoding: 'euckr' },
  { label: 'Windows 1252', encoding: 'windows1252' },
];

export async function changeEncoding(document?: vscode.TextDocument): Promise<void> {
  if (!document || document.isUntitled) {
    void vscode.window.showWarningMessage(vscode.l10n.t('Open a saved file to change its encoding.'));
    return;
  }
  if (document.isDirty) {
    void vscode.window.showWarningMessage(vscode.l10n.t('Save or discard changes before reopening with another encoding.'));
    return;
  }
  const selected = await vscode.window.showQuickPick([
    { label: vscode.l10n.t('Auto Guess Encoding'), description: vscode.l10n.t('Detect encoding and reopen this file'), encoding: 'auto' },
    ...encodingChoices,
  ], { placeHolder: vscode.l10n.t('Select an encoding to reopen this file') });
  if (!selected) return;
  try {
    let encoding = selected.encoding;
    if (encoding === 'auto') {
      const bytes = await vscode.workspace.fs.readFile(document.uri);
      const { detect } = await import('./encodingDetector.js');
      const result = detect(bytes);
      const aliases: Record<string, string> = {
        'UTF-8': 'utf8', 'UTF-16LE': 'utf16le', 'UTF-16BE': 'utf16be',
        'CP932': 'shiftjis', 'SHIFT_JIS': 'shiftjis', 'EUC-JP': 'eucjp',
        'GB18030': 'gb18030', 'GB2312': 'gbk', 'GBK': 'gbk', 'BIG5': 'cp950',
        'EUC-KR': 'euckr', 'WINDOWS-1252': 'windows1252', 'ASCII': 'utf8',
      };
      const guessed = result.encoding && aliases[result.encoding.toUpperCase()];
      if (!guessed || result.confidence < 0.5) {
        void vscode.window.showWarningMessage(vscode.l10n.t('Could not reliably detect the encoding. Please select one manually.'));
        return;
      }
      encoding = guessed;
    }
    // The user may have edited the document while the picker or file read was open.
    if (document.isDirty) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Save or discard changes before reopening with another encoding.'));
      return;
    }
    await vscode.workspace.openTextDocument(document.uri, { encoding });
  } catch (error) {
    void vscode.window.showErrorMessage(vscode.l10n.t('Could not reopen the file with the selected encoding: {0}', String(error)));
  }
}

