import { ja } from './locales/ja.js';
import { zhcn } from './locales/zh-cn.js';
import { zhtw } from './locales/zh-tw.js';
import { ko } from './locales/ko.js';
import { es } from './locales/es.js';
import { fr } from './locales/fr.js';
import { de } from './locales/de.js';
import { ptbr } from './locales/pt-br.js';
import { ru } from './locales/ru.js';
import { ar } from './locales/ar.js';
import { enMessages, formatMessage } from './locales/core.js';
import type { MessageCatalog, MessageKey } from './locales/core.js';
export { messageKeys } from './locales/core.js';
export type { MessageCatalog, MessageKey } from './locales/core.js';

export const supportedLocales = ['en', 'ja', 'zh-cn', 'zh-tw', 'ko', 'es', 'fr', 'de', 'pt-br', 'ru', 'ar'] as const;
export type SupportedLocale = typeof supportedLocales[number];



const catalogs: Record<Exclude<SupportedLocale, 'en'>, MessageCatalog> = {
  ja, 'zh-cn': zhcn, 'zh-tw': zhtw, ko, es, fr, de, 'pt-br': ptbr, ru, ar,
};


export function resolveLocale(locale: string): SupportedLocale {
  const normalized = locale.trim().toLowerCase().replace(/_/gu, '-');
  if (normalized === 'zh-hans' || normalized.startsWith('zh-cn') || normalized.startsWith('zh-sg')) return 'zh-cn';
  if (normalized === 'zh-hant' || normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk') || normalized.startsWith('zh-mo')) return 'zh-tw';
  if (normalized.startsWith('pt')) return 'pt-br';
  const exact = supportedLocales.find((candidate) => candidate === normalized);
  if (exact) return exact;
  const language = normalized.split('-')[0];
  return supportedLocales.find((candidate) => candidate === language) ?? 'en';
}

export function getMessageCatalog(locale: string): MessageCatalog {
  const resolved = resolveLocale(locale);
  return resolved === 'en' ? enMessages : catalogs[resolved];
}

export function translate(locale: string, key: MessageKey, ...values: readonly (string | number)[]): string {
  const resolved = resolveLocale(locale);
  const template = resolved === 'en' ? enMessages[key] : catalogs[resolved][key];
  return formatMessage(template, ...values);
}

export function isRtlLocale(locale: string): boolean {
  return /^(?:ar|fa|he|ur)(?:-|$)/iu.test(locale.trim());
}
