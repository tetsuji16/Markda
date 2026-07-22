import { describe, expect, it } from 'vitest';
import { decodeImageSource } from '../src/protocol.js';

describe('decodeImageSource', () => {
  it('accepts a plain relative path', () => {
    expect(decodeImageSource('images/photo.png')).toBe('images/photo.png');
  });

  it('accepts a decoded percent-encoded path', () => {
    expect(decodeImageSource('images/%E7%94%BB%E5%83%8F.png')).toBe('images/\u753b\u50cf.png');
  });

  it('strips a leading angle bracket wrapper', () => {
    expect(decodeImageSource('<images/photo.png>')).toBe('images/photo.png');
  });

  it('rejects remote http(s) sources', () => {
    expect(decodeImageSource('https://example.com/photo.png')).toBeUndefined();
  });

  it('rejects data: URIs', () => {
    expect(decodeImageSource('data:image/png;base64,AAAA')).toBeUndefined();
  });

  it('rejects vscode-webview: sources', () => {
    expect(decodeImageSource('vscode-webview://abc/photo.png')).toBeUndefined();
  });

  it('rejects file: scheme', () => {
    expect(decodeImageSource('file:///etc/passwd')).toBeUndefined();
  });

  it('rejects POSIX absolute paths', () => {
    expect(decodeImageSource('/etc/passwd')).toBeUndefined();
  });

  it('rejects Windows absolute paths', () => {
    expect(decodeImageSource('C:\\Users\\me\\photo.png')).toBeUndefined();
  });

  it('rejects UNC shares', () => {
    expect(decodeImageSource('\\\\server\\share\\photo.png')).toBeUndefined();
  });

  it('rejects traversal that escapes via encoded segments', () => {
    expect(decodeImageSource('..%2F..%2Fetc%2Fpasswd')).toBe('../../etc/passwd');
  });

  it('rejects non-string input', () => {
    expect(decodeImageSource(undefined)).toBeUndefined();
    expect(decodeImageSource(42)).toBeUndefined();
    expect(decodeImageSource({})).toBeUndefined();
  });

  it('rejects over-long input', () => {
    expect(decodeImageSource('a'.repeat(8193))).toBeUndefined();
  });
});
