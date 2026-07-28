export type DocumentLinkTarget =
  | { kind: 'anchor'; fragment: string }
  | { kind: 'external'; href: string }
  | { kind: 'local'; path: string; fragment?: string }
  | { kind: 'unsupported' };

const externalSchemes = new Set(['http', 'https', 'mailto']);

/**
 * Parses an href emitted by the Markdown renderer without treating URI syntax as
 * a filesystem path. Local link paths are decoded here so `%20` and non-ASCII
 * filenames work when the extension host resolves them.
 */
export function parseDocumentLink(href: string): DocumentLinkTarget {
  const value = href.trim();
  if (!value || value.includes('\0')) return { kind: 'unsupported' };

  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/iu)?.[1]?.toLocaleLowerCase();
  if (scheme) {
    return externalSchemes.has(scheme)
      ? { kind: 'external', href: value }
      : { kind: 'unsupported' };
  }

  const hash = value.indexOf('#');
  const pathAndQuery = hash < 0 ? value : value.slice(0, hash);
  const fragment = hash < 0 ? undefined : value.slice(hash + 1);
  if (!pathAndQuery) return fragment === undefined
    ? { kind: 'unsupported' }
    : { kind: 'anchor', fragment };

  const query = pathAndQuery.indexOf('?');
  const encodedPath = query < 0 ? pathAndQuery : pathAndQuery.slice(0, query);
  if (!encodedPath) return { kind: 'unsupported' };
  try {
    const decodedPath = decodeURIComponent(encodedPath);
    return decodedPath && !decodedPath.includes('\0')
      ? { kind: 'local', path: decodedPath, ...(fragment === undefined ? {} : { fragment }) }
      : { kind: 'unsupported' };
  } catch {
    return { kind: 'unsupported' };
  }
}

export function isMarkdownDocumentPath(value: string): boolean {
  return /\.(?:md|markdown|mdown|mkd|mkdn|mdwn|txt)$/iu.test(value);
}
