import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'package.json');
const englishPath = join(root, 'package.nls.json');
const requiredLocales = ['ar', 'de', 'es', 'fr', 'ja', 'ko', 'pt-br', 'ru', 'zh-cn', 'zh-tw'];
const checkOnly = process.argv.includes('--check');

// package.nls*.json files are canonical catalogs. Update them alongside English
// source messages; this script validates translations and localizes the manifest.

const english = JSON.parse(await readFile(englishPath, 'utf8'));
const keys = Object.keys(english);
const keySet = new Set(keys);
const englishValues = new Map();
for (const [key, value] of Object.entries(english)) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`English message ${key} must be a non-empty string`);
  }
  if (englishValues.has(value)) {
    throw new Error(`English message is duplicated by ${englishValues.get(value)} and ${key}`);
  }
  englishValues.set(value, key);
}

const files = await readdir(root);
const availableLocales = files
  .map((file) => /^package\.nls\.(.+)\.json$/.exec(file)?.[1])
  .filter(Boolean)
  .sort();
if (JSON.stringify(availableLocales) !== JSON.stringify([...requiredLocales].sort())) {
  throw new Error(`Expected locales ${requiredLocales.join(', ')}; found ${availableLocales.join(', ')}`);
}

const tokenPattern = /\$\{[^}]+\}|\{\{[^}]+\}\}|command:[\w.]+/g;
function preservedTokens(value) {
  return (value.match(tokenPattern) ?? []).sort();
}

for (const locale of availableLocales) {
  const localePath = join(root, `package.nls.${locale}.json`);
  const translated = JSON.parse(await readFile(localePath, 'utf8'));
  const translatedKeys = Object.keys(translated);
  const missing = keys.filter((key) => !Object.hasOwn(translated, key));
  const extra = translatedKeys.filter((key) => !keySet.has(key));
  if (missing.length || extra.length) {
    throw new Error(`${locale} catalog keys differ; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`);
  }
  for (const key of keys) {
    const value = translated[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${locale}:${key} must be a non-empty string`);
    }
    if (value === english[key]) {
      throw new Error(`${locale}:${key} is still English; add a translation before generating`);
    }
    if (JSON.stringify(preservedTokens(value)) !== JSON.stringify(preservedTokens(english[key]))) {
      throw new Error(`${locale}:${key} must preserve placeholders and command links`);
    }
  }
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
function localizeManifestValue(value) {
  if (typeof value === 'string') {
    const key = englishValues.get(value);
    return key ? `%${key}%` : value;
  }
  if (Array.isArray(value)) return value.map(localizeManifestValue);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      value[key] = localizeManifestValue(child);
    }
  }
  return value;
}

const localizedManifest = localizeManifestValue(manifest);
function assertNlsReference(value, location) {
  if (typeof value !== 'string' || !/^%[^%]+%$/.test(value)) {
    throw new Error(`${location} must use an NLS reference`);
  }
  const key = value.slice(1, -1);
  if (!keySet.has(key)) throw new Error(`${location} references unknown key ${key}`);
}

assertNlsReference(localizedManifest.description, 'description');
assertNlsReference(localizedManifest.capabilities.untrustedWorkspaces.description, 'untrustedWorkspaces.description');
for (const [index, command] of localizedManifest.contributes.commands.entries()) {
  assertNlsReference(command.title, `commands[${index}].title`);
}
for (const [container, views] of Object.entries(localizedManifest.contributes.views)) {
  for (const [index, view] of views.entries()) assertNlsReference(view.name, `views.${container}[${index}].name`);
}
function validateConfiguration(properties, prefix = 'configuration') {
  for (const [name, setting] of Object.entries(properties)) {
    const location = `${prefix}.${name}`;
    if (setting.description) assertNlsReference(setting.description, `${location}.description`);
    for (const [index, description] of (setting.enumDescriptions ?? []).entries()) {
      assertNlsReference(description, `${location}.enumDescriptions[${index}]`);
    }
    if (setting.items?.properties) validateConfiguration(setting.items.properties, `${location}.items`);
  }
}
validateConfiguration(localizedManifest.contributes.configuration.properties);
for (const [index, welcome] of localizedManifest.contributes.viewsWelcome.entries()) {
  assertNlsReference(welcome.contents, `viewsWelcome[${index}].contents`);
}

const references = JSON.stringify(localizedManifest).match(/%([^%]+)%/g) ?? [];
const unknownReferences = [...new Set(references.map((reference) => reference.slice(1, -1)).filter((key) => !keySet.has(key)))];
if (unknownReferences.length) {
  throw new Error(`Manifest references unknown localization keys: ${unknownReferences.join(', ')}`);
}
if (localizedManifest.keywords.length > 30) throw new Error('Marketplace keywords must not exceed 30 entries');
if (english['extension.description'].length > 120) throw new Error('extension.description must not exceed 120 characters');
if (checkOnly) {
  if (JSON.stringify(manifest) !== JSON.stringify(localizedManifest)) {
    throw new Error('package.json is not localized; run the generator to update it');
  }
} else {
  await writeFile(manifestPath, `${JSON.stringify(localizedManifest, null, 2)}\n`, 'utf8');
}
