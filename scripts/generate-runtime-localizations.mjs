import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const locales = ['ar', 'de', 'es', 'fr', 'ja', 'ko', 'pt-br', 'ru', 'zh-cn', 'zh-tw'];
const arguments_ = process.argv.slice(2);
if (arguments_.some((argument) => argument !== '--check') || arguments_.length > 1) {
  throw new Error('Usage: node scripts/generate-runtime-localizations.mjs [--check]');
}
const checkOnly = arguments_.includes('--check');

async function typescriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await typescriptFiles(path));
    else if (entry.isFile() && path.endsWith('.ts')) files.push(path);
  }
  return files;
}

function parseSource(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) {
    throw new Error(`Could not parse ${relative(root, path)}: ${source.parseDiagnostics[0].messageText}`);
  }
  return source;
}

const messages = new Set();
for (const path of await typescriptFiles(join(root, 'src'))) {
  const source = parseSource(path, await readFile(path, 'utf8'));
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'vscode.l10n.t') {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) {
        messages.add(argument.text);
      } else if (!argument || !['template.name', 'template.description'].includes(argument.getText(source))) {
        throw new Error(`Add an explicit localization key for ${relative(root, path)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

// Built-in template labels are translated dynamically through template.name/description.
const templatesPath = join(root, 'src', 'templates.ts');
const templates = parseSource(templatesPath, await readFile(templatesPath, 'utf8'));
function collectTemplateStrings(node) {
  if (ts.isObjectLiteralExpression(node)) {
    const fields = new Map(node.properties
      .filter(ts.isPropertyAssignment)
      .filter((property) => ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      .map((property) => [property.name.text, property.initializer]));
    if (ts.isStringLiteralLike(fields.get('name')) && ts.isStringLiteralLike(fields.get('description'))) {
      messages.add(fields.get('name').text);
      messages.add(fields.get('description').text);
    }
  }
  ts.forEachChild(node, collectTemplateStrings);
}
collectTemplateStrings(templates);

function placeholderSignature(value) {
  return [...value.matchAll(/\{(\d+)\}/gu)]
    .map((match) => Number(match[1]))
    .sort((left, right) => left - right)
    .join(',');
}

function preservedTerms(value) {
  return [...value.matchAll(/`[^`]*`|\bmarkda\.[\w.]+\b|\b(?:VS Code|Markdown|markda|Typora|Pandoc|KaTeX|Mermaid|PDF|HTML)\b/gu)]
    .map((match) => match[0])
    .sort()
    .join('|');
}

const orderedMessages = [...messages].sort();
const expectedKeys = new Set(orderedMessages);
const changedBundles = [];
for (const locale of locales) {
  const path = join(root, 'l10n', `bundle.l10n.${locale}.json`);
  let bundle;
  try {
    bundle = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${relative(root, path)}: ${error.message}`);
  }

  const missing = orderedMessages.filter((key) => !(key in bundle));
  const stale = Object.keys(bundle).filter((key) => !expectedKeys.has(key));
  const empty = orderedMessages.filter((key) => typeof bundle[key] !== 'string' || !bundle[key].trim());
  const untranslated = orderedMessages.filter((key) => bundle[key] === key);
  const placeholderMismatch = orderedMessages.filter((key) => typeof bundle[key] === 'string'
    && placeholderSignature(bundle[key]) !== placeholderSignature(key));
  const termMismatch = orderedMessages.filter((key) => typeof bundle[key] === 'string'
    && preservedTerms(bundle[key]) !== preservedTerms(key));
  if (missing.length || stale.length || empty.length || untranslated.length || placeholderMismatch.length || termMismatch.length) {
    const details = [
      missing.length && `missing: ${missing.join(' | ')}`,
      stale.length && `stale: ${stale.join(' | ')}`,
      empty.length && `empty: ${empty.join(' | ')}`,
      untranslated.length && `untranslated: ${untranslated.join(' | ')}`,
      placeholderMismatch.length && `placeholder mismatch: ${placeholderMismatch.join(' | ')}`,
      termMismatch.length && `protected term mismatch: ${termMismatch.join(' | ')}`,
    ].filter(Boolean).join('\n');
    throw new Error(`${locale} localization is incomplete or invalid:\n${details}`);
  }

  // Keep existing human translations intact and make regenerated bundle ordering stable.
  const orderedBundle = Object.fromEntries(orderedMessages.map((key) => [key, bundle[key]]));
  const output = `${JSON.stringify(orderedBundle, null, 2)}\n`;
  if (output !== await readFile(path, 'utf8')) {
    if (checkOnly) changedBundles.push(relative(root, path));
    else await writeFile(path, output, 'utf8');
  }
}

if (changedBundles.length) {
  throw new Error(`Localization bundles need regeneration:\n${changedBundles.join('\n')}`);
}

console.log(`Validated ${orderedMessages.length} runtime messages in ${locales.length} locales.`);
