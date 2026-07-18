import type { DocumentStatistics } from './protocol.js';

const syntaxPattern = /(?:^|\s)(?:#{1,6}|[-+*>]|\d+\.)\s|[*_~`=[\](){}\\]|!\[/gm;
const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const wordPattern = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

export function getStatistics(text: string, selection = ''): DocumentStatistics {
  const plain = text.replace(syntaxPattern, ' ');
  const selectedPlain = selection.replace(syntaxPattern, ' ');
  const words = countWords(plain);
  return {
    words,
    characters: [...text].length,
    charactersWithoutSpaces: [...text.replace(/\s/gu, '')].length,
    lines: text.length === 0 ? 1 : text.split(/\r\n|\r|\n/u).length,
    readingMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / 240)),
    selectionWords: countWords(selectedPlain),
    selectionCharacters: [...selection].length,
  };
}

function countWords(text: string): number {
  const cjk = text.match(cjkPattern)?.length ?? 0;
  const withoutCjk = text.replace(cjkPattern, ' ');
  return cjk + (withoutCjk.match(wordPattern)?.length ?? 0);
}
