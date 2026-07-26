export const markdaViewType = 'markda.editor';
export const defaultTextEditorViewType = 'default';

export interface SupportedFileType {
  readonly extension: string;
  readonly pattern: string;
  readonly description: string;
}

export const supportedFileTypes: readonly SupportedFileType[] = [
  { extension: 'md', pattern: '*.md', description: 'Markdown (.md)' },
  { extension: 'markdown', pattern: '*.markdown', description: 'Markdown (.markdown)' },
  { extension: 'mdown', pattern: '*.mdown', description: 'Markdown (.mdown)' },
  { extension: 'mkd', pattern: '*.mkd', description: 'Markdown (.mkd)' },
  { extension: 'mkdn', pattern: '*.mkdn', description: 'Markdown (.mkdn)' },
  { extension: 'mdwn', pattern: '*.mdwn', description: 'Markdown (.mdwn)' },
  { extension: 'txt', pattern: '*.txt', description: 'Plain text (.txt)' },
];

export type EditorAssociations = Readonly<Record<string, string>>;

/**
 * Markda is declared as a default-priority custom editor, so a missing explicit
 * association means that VS Code will also choose Markda.
 */
export function opensWithMarkda(associations: EditorAssociations, pattern: string): boolean {
  const editor = associations[pattern];
  return editor === undefined || editor === markdaViewType;
}

/**
 * Apply the user's Markda selections without replacing associations that point
 * at another installed custom editor.
 */
export function applyMarkdaAssociations(
  associations: EditorAssociations,
  selectedPatterns: ReadonlySet<string>,
): Record<string, string> {
  const updated = { ...associations };
  for (const { pattern } of supportedFileTypes) {
    const current = updated[pattern];
    if (selectedPatterns.has(pattern)) {
      updated[pattern] = markdaViewType;
    } else if (current === undefined || current === markdaViewType || current === defaultTextEditorViewType) {
      updated[pattern] = defaultTextEditorViewType;
    }
  }
  return updated;
}
