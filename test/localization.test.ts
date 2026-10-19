import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRtlLocale, messageKeys, resolveLocale, supportedLocales, translate } from '../src/localization.js';
import { createHtmlDocument } from '../src/htmlExport.js';

describe('localization', () => {
  it('resolves supported locales and common VS Code variants', () => {
    expect(resolveLocale('ja-JP')).toBe('ja');
    expect(resolveLocale('zh-Hans')).toBe('zh-cn');
    expect(resolveLocale('zh-HK')).toBe('zh-tw');
    expect(resolveLocale('pt-PT')).toBe('pt-br');
    expect(resolveLocale('unknown')).toBe('en');
  });

  it('translates messages and falls back to English for unknown locales', () => {
    expect(translate('ja', 'insertTable')).toBe('表を挿入');
    expect(translate('ja', 'syncSaved')).toBe('同期済み');
    expect(translate('en', 'syncSaved')).toBe('Synced');
    expect(translate('de-DE', 'largeTable', 4, 3)).toBe('Große Tabelle (4 Zeilen × 3 Spalten)');
    expect(translate('unknown', 'cancel')).toBe('Cancel');
  });

  it('preserves the English placeholder set in every supported locale', () => {
    const placeholders = (message: string) => [...message.matchAll(/\{(\d+)\}/gu)].map((match) => match[1]).sort();
    for (const locale of supportedLocales) {
      if (locale !== 'en') {
        expect(translate(locale, 'insertTable'), locale).not.toBe('Insert table');
        expect(translate(locale, 'saveFailed'), locale).not.toBe('markda: The document could not be saved.');
      }
      for (const key of messageKeys) {
        expect(placeholders(translate(locale, key)), `${locale}:${key}`).toEqual(placeholders(translate('en', key)));
      }
    }
  });

  it('marks RTL locales and exports valid language metadata', () => {
    expect(isRtlLocale('ar-SA')).toBe(true);
    expect(isRtlLocale('ja-JP')).toBe(false);
    expect(createHtmlDocument('عنوان', '<p>نص</p>', 'ar-SA')).toContain('<html lang="ar-SA">');
    expect(createHtmlDocument('عنوان', '<p>نص</p>', 'ar-SA')).toContain('<body dir="auto">');
  });

  it('ships a complete package localization file for every supported non-English locale', async () => {
    const root = resolve(process.cwd());
    const manifest = await readFile(resolve(root, 'package.json'), 'utf8');
    expect(JSON.parse(manifest)).toMatchObject({ l10n: './l10n' });
    const keys = [...manifest.matchAll(/%([^%]+)%/gu)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(20);
    for (const locale of supportedLocales.filter((value) => value !== 'en')) {
      const messages = JSON.parse(await readFile(resolve(root, `package.nls.${locale}.json`), 'utf8')) as Record<string, string>;
      for (const key of keys) expect(messages[key!], `${locale}:${key}`).toBeTruthy();
      await expect(readFile(resolve(root, 'l10n', `bundle.l10n.${locale}.json`), 'utf8')).resolves.toContain('markda Markdown editor');
    }
  });
});
