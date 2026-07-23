import type { DocumentStatistics, Heading } from './protocol.js';

const syntaxPattern = /(?:^|\s)(?:#{1,6}|[-+*>]|\d+\.)\s|[*_~`=[\](){}\\]|!\[/gm;
const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const wordPattern = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function getStatistics(text: string, selection = ''): DocumentStatistics {
  const result = analyzeDocument(text).statistics;
  const selectedPlain = selection.replace(syntaxPattern, ' ');
  return {
    ...result,
    selectionWords: countWords(selectedPlain),
    selectionCharacters: [...selection].length,
  };
}

export function analyzeDocument(text: string): { statistics: DocumentStatistics; headings: Heading[] } {
  const headings: Heading[] = [];
  let characters = 0;
  let charactersWithoutSpaces = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    characters++;
    // A valid surrogate pair is one Unicode character. All ECMAScript
    // whitespace code points are in the BMP, so supplementary characters can
    // take the non-whitespace fast path without allocating a one-character
    // string and running a regular expression for every code point.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index++;
      charactersWithoutSpaces++;
    } else if (!isWhitespaceCodeUnit(code)) {
      charactersWithoutSpaces++;
    }
  }

  let lineStart = 0;
  let lines = 0;
  let fence: { marker: '`' | '~'; length: number } | undefined;
  let previousLine: { text: string; from: number; to: number } | undefined;
  while (lineStart <= text.length) {
    let lineEnd = lineStart;
    while (lineEnd < text.length && text[lineEnd] !== '\r' && text[lineEnd] !== '\n') lineEnd++;
    const line = text.slice(lineStart, lineEnd);
    const fenceMarker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/u)?.[1];
    if (fenceMarker) {
      const marker = fenceMarker[0] as '`' | '~';
      if (!fence) fence = { marker, length: fenceMarker.length };
      else if (fence.marker === marker && fenceMarker.length >= fence.length
        && /^[ \t]*(?:`+|~+)[ \t]*$/u.test(line)) fence = undefined;
      previousLine = undefined;
    } else if (!fence) {
      const heading = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u);
      if (heading) headings.push({
        level: heading[1]?.length ?? 1,
        text: heading[2] ?? '',
        from: lineStart,
        to: lineEnd,
      });
      const setext = line.match(/^[ \t]{0,3}(=+|-+)[ \t]*$/u);
      if (setext && previousLine?.text.trim() && !/^(?:#{1,6}|>|[-+*]|\d+[.)])[ \t]/u.test(previousLine.text)) {
        headings.push({
          level: setext[1]?.startsWith('=') ? 1 : 2,
          text: previousLine.text.trim(),
          from: previousLine.from,
          to: lineEnd,
        });
      }
      previousLine = line.trim() ? { text: line, from: lineStart, to: lineEnd } : undefined;
    }
    lines++;
    if (lineEnd >= text.length) break;
    lineStart = lineEnd + (text[lineEnd] === '\r' && text[lineEnd + 1] === '\n' ? 2 : 1);
  }

  // Strip Markdown and scan for words once for the complete document. Doing
  // both operations per line creates several short-lived strings and match
  // arrays for every line, which becomes the dominant cost on large files.
  const words = countWords(text.replace(syntaxPattern, ' '));

  return {
    headings,
    statistics: {
      words,
      characters,
      charactersWithoutSpaces,
      lines,
      readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / 240)),
      selectionWords: 0,
      selectionCharacters: 0,
    },
  };
}

function isWhitespaceCodeUnit(code: number): boolean {
  return (code >= 0x09 && code <= 0x0d) || code === 0x20 || code === 0xa0 || code === 0x1680
    || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029
    || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
}

function countWords(text: string): number {
  const cjk = text.match(cjkPattern)?.length ?? 0;
  const withoutCjk = text.replace(cjkPattern, ' ');
  return cjk + (withoutCjk.match(wordPattern)?.length ?? 0);
}
