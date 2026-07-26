import { isRtlLocale } from './localization.js';

export function createHtmlDocument(title: string, body: string, locale = 'en', additionalCss = '', baseHref = ''): string {
  return `<!doctype html>
<html lang="${escapeHtml(locale)}" dir="${isRtlLocale(locale) ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${baseHref ? `<base href="${escapeHtml(baseHref)}">` : ''}
<title>${escapeHtml(title)}</title>
<style>${exportCss}${additionalCss}</style>
</head>
<body><main class="markda-export">${body}</main></body>
</html>\n`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

const exportCss = `
:root{color-scheme:light dark}body{margin:0;background:#fff;color:#24292f;font:16px/1.65 system-ui,sans-serif}
.markda-export{max-width:860px;margin:0 auto;padding:48px 32px}h1,h2,h3{line-height:1.25;margin-top:1.6em}
pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}pre{padding:16px;overflow:auto;background:#f6f8fa;border-radius:6px}
blockquote{margin-left:0;padding-left:1em;color:#59636e;border-left:4px solid #d0d7de}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #d0d7de;padding:6px 12px}img{max-width:100%}@media print{.markda-export{max-width:none;padding:0}}
`;
