export interface SelectionAnchor {
  anchor: number;
  head: number;
}

export interface EditorSettings {
  contentWidth: number;
  autoPairMarkdown: boolean;
  typewriterKeepCentered: boolean;
  previewUpdateDelay: number;
  liveTableMaxCells: number;
  themeMode: 'auto' | 'light' | 'dark';
  markdown: {
    math: boolean;
    diagrams: boolean;
    html: boolean;
    breaks: boolean;
  };
  security: {
    allowRemoteResources: 'never' | 'prompt' | 'always';
    allowUnsafeHtml: boolean;
  };
  theme: { light: string; dark: string };
}

export type HostToEditorMessage =
  | {
      type: 'initialize';
      uri: string;
      resourceBaseUri: string;
      themeBaseUri: string;
      assetBaseUri?: string;
      locale: string;
      direction: 'ltr' | 'rtl';
      version: number;
      text: string;
      settings: EditorSettings;
    }
  | { type: 'documentChanged'; version: number; sourceTransactionId: string }
  | { type: 'documentChanged'; version: number; text: string; sourceTransactionId?: undefined }
  | { type: 'command'; command: EditorCommand; payload?: unknown }
  | { type: 'configurationChanged'; settings: EditorSettings };

export type EditorCommand =
  | 'toggleSourceMode'
  | 'toggleFocusMode'
  | 'toggleTypewriterMode'
  | 'insertTable'
  | 'insertImage'
  | 'insertMathBlock'
  | 'showStatistics'
  | 'showSearch'
  | 'copyAsMarkdown'
  | 'insertText'
  | 'toggleBold'
  | 'toggleItalic'
  | 'toggleInlineCode'
  | 'insertLink'
  | 'setHeading'
  | 'toggleBulletList'
  | 'toggleOrderedList'
  | 'toggleTaskList'
  | 'toggleBlockquote'
  | 'toggleStrikethrough'
  | 'insertCodeBlock'
  | 'clearFormatting'
  | 'replaceImageSource'
  | 'removeImageSource'
  | 'focusHeading';

export type EditorToHostMessage =
  | {
      type: 'edit';
      uri: string;
      baseVersion: number;
      transactionId: string;
      changes: readonly TextChange[];
      selection: SelectionAnchor;
    }
  | { type: 'finalSync'; uri: string; expectedText: string; text: string }
  | { type: 'save'; uri: string; expectedText: string; text: string }
  | { type: 'ready' }
  | { type: 'state'; sourceMode: boolean; focusMode: boolean; typewriterMode: boolean; cursor?: number }
  | { type: 'statistics'; statistics: DocumentStatistics }
  | { type: 'outline'; headings: readonly Heading[] }
  | { type: 'openLink'; href: string }
  | { type: 'requestImage'; selection: SelectionAnchor }
  | { type: 'saveImages'; selection: SelectionAnchor; images: readonly { name: string; dataUrl: string }[] }
  | { type: 'manageImage'; source: string; from: number; action: 'move' | 'copy' | 'delete' }
  | { type: 'copyToClipboard'; text: string }
  | { type: 'updateThemeMode'; mode: 'auto' | 'light' | 'dark' };

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface Heading {
  level: number;
  text: string;
  from: number;
  to: number;
}

export interface DocumentStatistics {
  words: number;
  characters: number;
  charactersWithoutSpaces: number;
  lines: number;
  readingMinutes: number;
  selectionWords: number;
  selectionCharacters: number;
}

export function parseEditorToHostMessage(value: unknown): EditorToHostMessage | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return undefined;
  switch (value.type) {
    case 'ready':
      return { type: 'ready' };
    case 'edit':
      if (typeof value.uri !== 'string'
        || !isNonNegativeInteger(value.baseVersion)
        || typeof value.transactionId !== 'string'
        || value.transactionId.length < 1
        || value.transactionId.length > 128
        || !Array.isArray(value.changes)
        || value.changes.length < 1
        || value.changes.length > 10_000
        || !value.changes.every(isTextChange)
        || !isSelection(value.selection)) return undefined;
      return {
        type: 'edit', uri: value.uri, baseVersion: value.baseVersion,
        transactionId: value.transactionId, changes: value.changes, selection: value.selection,
      };
    case 'finalSync':
      if (typeof value.uri !== 'string' || typeof value.expectedText !== 'string' || typeof value.text !== 'string'
        || value.expectedText.length > 25_000_000 || value.text.length > 25_000_000) return undefined;
      return { type: 'finalSync', uri: value.uri, expectedText: value.expectedText, text: value.text };
    case 'save':
      if (typeof value.uri !== 'string' || typeof value.expectedText !== 'string' || typeof value.text !== 'string'
        || value.expectedText.length > 25_000_000 || value.text.length > 25_000_000) return undefined;
      return { type: 'save', uri: value.uri, expectedText: value.expectedText, text: value.text };
    case 'state':
      if (typeof value.sourceMode !== 'boolean' || typeof value.focusMode !== 'boolean' || typeof value.typewriterMode !== 'boolean') return undefined;
      if (value.cursor !== undefined && !isNonNegativeInteger(value.cursor)) return undefined;
      return { type: 'state', sourceMode: value.sourceMode, focusMode: value.focusMode, typewriterMode: value.typewriterMode, ...(value.cursor === undefined ? {} : { cursor: value.cursor }) };
    case 'statistics':
      return isStatistics(value.statistics) ? { type: 'statistics', statistics: value.statistics } : undefined;
    case 'outline':
      if (!Array.isArray(value.headings) || value.headings.length > 10_000 || !value.headings.every(isHeading)) return undefined;
      return { type: 'outline', headings: value.headings };
    case 'openLink':
      return typeof value.href === 'string' && value.href.length <= 8192 ? { type: 'openLink', href: value.href } : undefined;
    case 'requestImage':
      return isSelection(value.selection) ? { type: 'requestImage', selection: value.selection } : undefined;
    case 'saveImages':
      if (!isSelection(value.selection) || !Array.isArray(value.images) || value.images.length < 1 || value.images.length > 32
        || !value.images.every((image) => isRecord(image) && typeof image.name === 'string' && image.name.length <= 255
          && typeof image.dataUrl === 'string' && image.dataUrl.length <= 25_000_000)) return undefined;
      return { type: 'saveImages', selection: value.selection, images: value.images as { name: string; dataUrl: string }[] };
    case 'manageImage':
      if (typeof value.source !== 'string' || value.source.length < 1 || value.source.length > 8192 || !isNonNegativeInteger(value.from)
        || !['move', 'copy', 'delete'].includes(String(value.action))) return undefined;
      return { type: 'manageImage', source: value.source, from: value.from, action: value.action as 'move' | 'copy' | 'delete' };
    case 'copyToClipboard':
      return typeof value.text === 'string' ? { type: 'copyToClipboard', text: value.text } : undefined;
    case 'updateThemeMode':
      return value.mode === 'auto' || value.mode === 'light' || value.mode === 'dark'
        ? { type: 'updateThemeMode', mode: value.mode }
        : undefined;
    default:
      return undefined;
  }
}

export function areValidTextChanges(changes: readonly TextChange[], documentLength: number): boolean {
  const ordered = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  let previousTo = -1;
  let previousFrom = -1;
  for (const change of ordered) {
    if (change.to > documentLength || change.from < previousTo || change.from === previousFrom) return false;
    previousFrom = change.from;
    previousTo = change.to;
  }
  return true;
}

/**
 * Decodes an image source received from the webview into a plain, relative-or-workspace
 * path fragment suitable for `path.resolve`. Returns `undefined` for values that are not
 * local image references or that cannot be safely decoded. Absolute paths, UNC shares
 * (`\\host\share`), POSIX roots (`/abs`), and remote/data schemes are rejected rather than
 * skipped, so callers must never trust a raw webview image path.
 */
export function decodeImageSource(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length < 1 || value.length > 8192) return undefined;
  if (/^(?:https?:|data:|vscode-webview:|file:|\\\\|\/)/iu.test(value)) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(value.split(/[?#]/u)[0] ?? value).replace(/^<|>$/gu, ''); }
  catch { return undefined; }
  if (decoded.length === 0 || pathIsAbsolute(decoded)) return undefined;
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function pathIsAbsolute(value: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isSelection(value: unknown): value is SelectionAnchor {
  return isRecord(value) && isNonNegativeInteger(value.anchor) && isNonNegativeInteger(value.head);
}

function isTextChange(value: unknown): value is TextChange {
  return isRecord(value) && isNonNegativeInteger(value.from) && isNonNegativeInteger(value.to)
    && value.from <= value.to && typeof value.insert === 'string';
}

function isHeading(value: unknown): value is Heading {
  return isRecord(value) && Number.isInteger(value.level) && (value.level as number) >= 1 && (value.level as number) <= 6
    && typeof value.text === 'string' && isNonNegativeInteger(value.from) && isNonNegativeInteger(value.to) && value.from <= value.to;
}

function isStatistics(value: unknown): value is DocumentStatistics {
  if (!isRecord(value)) return false;
  return ['words', 'characters', 'charactersWithoutSpaces', 'lines', 'readingMinutes', 'selectionWords', 'selectionCharacters']
    .every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]) && (value[key] as number) >= 0);
}
