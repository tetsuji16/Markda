import { isRtlLocale } from './localization.js';

export function createHtmlDocument(
  title: string,
  body: string,
  locale = 'en',
  additionalCss = '',
  baseHref = '',
  contentSecurityPolicy = '',
  trailingBodyHtml = '',
): string {
  return `<!doctype html>
<html lang="${escapeHtml(locale)}" dir="${isRtlLocale(locale) ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
${contentSecurityPolicy ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy)}">\n` : ''}<meta name="viewport" content="width=device-width, initial-scale=1">
${baseHref ? `<base href="${escapeHtml(baseHref)}">` : ''}
<title>${escapeHtml(title)}</title>
<style>${exportCss}${additionalCss}</style>
</head>
<body><main class="markda-export">${body}</main>${trailingBodyHtml}</body>
</html>\n`;
}

/**
 * Policy for the page rendered by a headless browser during PDF and image
 * export. Raw HTML is passed through when the user allows unsafe HTML, but the
 * live editor still strips scripts; the export browser must not run them with
 * access to local files and the network. Remote images follow the same
 * `allowRemoteResources` rule as the editor: only `always` loads them.
 */
export function browserExportContentSecurityPolicy(allowRemoteImages: boolean, scriptNonce = ''): string {
  const scripts = scriptNonce ? `; script-src 'nonce-${scriptNonce}'` : '';
  return `default-src 'none'; img-src file: data:${allowRemoteImages ? ' https:' : ''}; style-src 'unsafe-inline'; font-src data:${scripts}`;
}

export const blockedRemoteImagePlaceholder = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="40" viewBox="0 0 240 40"><rect x=".5" y=".5" width="239" height="39" rx="4" fill="#f1f3f5" stroke="#8c959f"/><text x="12" y="25" fill="#57606a" font-family="sans-serif" font-size="13">Remote image blocked by Markda</text></svg>',
);

/** Runs the trusted, locally bundled diagram renderer and reports bounded completion. */
export function mermaidExportScript(bundle: string, nonce: string, allowRemoteImages = false): string {
  if (!/^[\w-]+$/u.test(nonce)) throw new Error('Invalid script nonce.');
  const safeBundle = bundle.replace(/<\/script/giu, '<\\/script');
  const prepareImages = blockedRemoteImagePreparation(allowRemoteImages);
  return `<script nonce="${nonce}">${safeBundle}\n;(()=>{${prepareImages}const root=document.documentElement;const diagrams=[...document.querySelectorAll('pre > code.language-mermaid')];`
    + `root.dataset.markdaExportState='${nonce}:pending';let failed=false;const finish=async()=>{try{await Promise.all([...document.images].map(i=>i.decode()));await document.fonts.ready;root.dataset.markdaExportState='${nonce}:'+(failed?'error':'ready');`
    + `dispatchEvent(new Event('markda-export-ready'))}catch(e){root.dataset.markdaExportState='${nonce}:error';root.dataset.markdaExportError=String(e);dispatchEvent(new Event('markda-export-ready'))}};`
    + `const render=async()=>{try{const exported=window.markdaMermaid,m=exported.default||exported; m.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,theme:'default'});`
    + `for(let i=0;i<diagrams.length;i++){const code=diagrams[i],host=code.parentElement;try{const result=await m.render('markda-export-'+i,code.textContent||'');host.innerHTML=result.svg}`
    + `catch(e){failed=true;host.dataset.markdaDiagramError='true';host.setAttribute('data-markda-export-error',String(e));host.style.color='#b00020';host.textContent='Mermaid render error: '+String(e)}}await finish()}`
    + `catch(e){failed=true;root.dataset.markdaExportState='${nonce}:error';root.dataset.markdaExportError=String(e);dispatchEvent(new Event('markda-export-ready'))}};if(window.markdaMermaid)void render();else{failed=true;root.dataset.markdaExportState='${nonce}:error';root.dataset.markdaExportError='Mermaid renderer did not load';void finish()}})()</script>`;
}

export function exportReadinessScript(nonce: string, allowRemoteImages = false): string {
  if (!/^[\w-]+$/u.test(nonce)) throw new Error('Invalid script nonce.');
  const prepareImages = blockedRemoteImagePreparation(allowRemoteImages);
  return `<script nonce="${nonce}">(()=>{${prepareImages}const r=document.documentElement;r.dataset.markdaExportState='${nonce}:pending';`
    + `Promise.all([...document.images].map(i=>i.decode())).then(()=>document.fonts.ready).then(()=>{r.dataset.markdaExportState='${nonce}:ready';dispatchEvent(new Event('markda-export-ready'))},()=>{r.dataset.markdaExportState='${nonce}:error';dispatchEvent(new Event('markda-export-ready'))})})()</script>`;
}

function blockedRemoteImagePreparation(allowRemoteImages: boolean): string {
  if (allowRemoteImages) return '';
  return `const placeholder=${JSON.stringify(blockedRemoteImagePlaceholder)};for(const image of document.images){const picture=image.closest('picture');const refs=[image.getAttribute('src')||'',image.getAttribute('srcset')||'',...(picture?[...picture.querySelectorAll('source')].map(source=>source.getAttribute('srcset')||''):[])].join(' ');if(!/(?:https?:)?\\/\\/[^\\s,]+/iu.test(refs))continue;if(picture)picture.querySelectorAll('source').forEach(source=>source.remove());image.removeAttribute('srcset');image.dataset.markdaRemoteBlocked='true';image.src=placeholder}`;
}

/**
 * Image export first loads the page with `--dump-dom` to learn how tall the
 * rendered document is, because images, tables and display math make any
 * estimate from the Markdown source unreliable. Only this nonce-tagged script
 * may run; document HTML stays blocked by the policy above. The value is
 * prefixed with the nonce because raw HTML such as `<html data-markda-height>`
 * inside the body is merged onto the root element by the HTML parser.
 */
export function heightProbeScript(nonce: string): string {
  if (!/^[\w-]+$/u.test(nonce)) throw new Error('Invalid script nonce.');
  return `<script nonce="${nonce}">const probe=()=>document.fonts.ready.then(()=>{`
    + `document.documentElement.setAttribute('data-markda-height','${nonce}:'+Math.ceil(document.documentElement.getBoundingClientRect().height))});`
    + `addEventListener('load',()=>{if(document.documentElement.dataset.markdaExportState==='${nonce}:pending')addEventListener('markda-export-ready',probe,{once:true});else probe()})</script>`;
}

/** Reads the height written by {@link heightProbeScript} from the root element of a dumped DOM. */
export function parseProbedHeight(dom: string, nonce: string): number | undefined {
  const root = /<html\b[^>]*>/iu.exec(dom)?.[0];
  const value = root ? /\sdata-markda-height="([^"]*)"/u.exec(root)?.[1] : undefined;
  if (!nonce || !value?.startsWith(`${nonce}:`)) return undefined;
  const digits = value.slice(nonce.length + 1);
  const height = /^\d{1,9}$/u.test(digits) ? Number(digits) : 0;
  return height > 0 ? height : undefined;
}

/** Protocol-relative and backslash references resolve to network shares from a file:// page. */
export function isNetworkPathReference(source: string): boolean {
  return /^\s*(?:[\\/]{2}|\\)/u.test(source);
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
