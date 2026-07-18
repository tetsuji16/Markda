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
  let words = 0;
  let characters = 0;
  let charactersWithoutSpaces = 0;
  for (const character of text) {
    characters++;
    if (!/\s/u.test(character)) charactersWithoutSpaces++;
  }

  let lineStart = 0;
  let lines = 0;
  while (lineStart <= text.length) {
    let lineEnd = lineStart;
    while (lineEnd < text.length && text[lineEnd] !== '\r' && text[lineEnd] !== '\n') lineEnd++;
    const line = text.slice(lineStart, lineEnd);
    const heading = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u);
    if (heading) headings.push({
      level: heading[1]?.length ?? 1,
      text: heading[2] ?? '',
      from: lineStart,
      to: lineEnd,
    });
    words += countWords(line.replace(syntaxPattern, ' '));
    lines++;
    if (lineEnd >= text.length) break;
    lineStart = lineEnd + (text[lineEnd] === '\r' && text[lineEnd + 1] === '\n' ? 2 : 1);
  }

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

function countWords(text: string): number {
  const cjk = text.match(cjkPattern)?.length ?? 0;
  const withoutCjk = text.replace(cjkPattern, ' ');
  return cjk + (withoutCjk.match(wordPattern)?.length ?? 0);
}
