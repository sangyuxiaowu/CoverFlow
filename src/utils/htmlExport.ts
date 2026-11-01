import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChevronLeft, ChevronRight, Maximize, Pause, Play, Printer } from 'lucide-react';
import type { ProjectState } from '../types.ts';
import { projectFontEmbedCSS } from '../features/ai/services/fontLoading.ts';
import { buildProjectSvg } from './svgExport.ts';

interface HtmlPage {
  svg: string;
  name: string;
  width: number;
  height: number;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export async function buildHtmlSvg(project: ProjectState): Promise<string> {
  const document = new DOMParser().parseFromString(buildProjectSvg(project), 'image/svg+xml');
  if (document.querySelector('parsererror')) throw new Error('Unable to build page SVG.');
  const fontCss = await projectFontEmbedCSS(project);
  if (fontCss) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = fontCss;
    document.documentElement.prepend(style);
  }
  await Promise.all(Array.from(document.querySelectorAll('image, feImage'), async image => {
    const source = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (!source || source.startsWith('#') || source.startsWith('data:')) return;
    const response = await fetch(source, { credentials: 'omit', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Unable to embed image.'));
      reader.readAsDataURL(blob);
    });
    image.setAttribute('href', dataUrl);
    image.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
  }));
  return new XMLSerializer().serializeToString(document.documentElement);
}

export function buildHtmlExport(title: string, pages: HtmlPage[], language = 'zh'): string {
  const english = language === 'en';
  const labels = english
    ? { previous: 'Previous page', next: 'Next page', play: 'Play', pause: 'Pause', interval: 'Interval', seconds: 'seconds', fullscreen: 'Fullscreen', print: 'Print / PDF', page: 'Page' }
    : { previous: '上一页', next: '下一页', play: '播放', pause: '暂停', interval: '播放间隔', seconds: '秒', fullscreen: '全屏', print: '打印 / PDF', page: '页面' };
  const icon = (component: typeof Play) => renderToStaticMarkup(createElement(component, { width: 18, height: 18, 'aria-hidden': true }));
  const button = (id: string, label: string, content: string) => `<button id="${id}" type="button" title="${label}" aria-label="${label}">${content}</button>`;
  const slides = pages.map((page, index) => `<section class="page" data-index="${index}" aria-label="${escapeHtml(page.name)}"${index ? ' hidden' : ''} style="--ratio:${page.width}/${page.height};page:sheet${index}"><img width="${page.width}" height="${page.height}" alt="${escapeHtml(page.name)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.svg)}"></section>`).join('\n');
  const printPages = pages.map((page, index) => `@page sheet${index}{size:${page.width}px ${page.height}px;margin:0}`).join('\n');
  return `<!doctype html>
<html lang="${english ? 'en' : 'zh-CN'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#202124;color:#f5f5f5;font-family:"Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:0}
main{height:100dvh;padding:16px;display:grid;place-items:center;overflow:hidden}
.page{width:100%;height:100%;min-height:0;display:grid;place-items:center}.page[hidden]{display:none}
.page img{display:block;width:100%;height:100%;object-fit:contain;min-height:0;min-width:0}
nav{position:fixed;z-index:10;bottom:max(12px,env(safe-area-inset-bottom));left:50%;transform:translate(-50%,6px);display:flex;align-items:center;justify-content:center;gap:8px;padding:6px;background:#14151699;backdrop-filter:blur(12px);border:1px solid #ffffff24;border-radius:6px;max-width:calc(100% - 16px);opacity:0;pointer-events:none;transition:opacity .18s,transform .18s}
body.controls-visible nav{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
button,select{height:30px;border:1px solid transparent;border-radius:4px;background:#ffffff08;color:inherit;cursor:pointer}
button{width:30px;display:grid;place-items:center;flex-shrink:0}button:hover,select:hover{background:#ffffff24}button:disabled{opacity:.3;cursor:default}
button:focus-visible,select:focus-visible{outline:2px solid #5cc8ed;outline-offset:2px}button[aria-pressed=true]{color:#5cc8ed}
output{min-width:52px;text-align:center;font-variant-numeric:tabular-nums;font-size:12px}select{max-width:78px;padding:0 4px;font-size:12px}select option{background:#292b2d;color:#f5f5f5}
@media(max-width:480px){main{padding:8px}nav{gap:4px}output{min-width:44px}select{max-width:58px}}
@media(prefers-reduced-motion:reduce){nav{transition:none}}
${printPages}
@media print{html,body{background:white;margin:0;padding:0}nav{display:none!important}main{display:block;height:auto;padding:0;overflow:visible}.page,.page[hidden]{display:block!important;width:100%;height:auto;break-after:page;break-inside:avoid;aspect-ratio:var(--ratio);overflow:hidden}.page:last-child{break-after:auto}.page img{width:100%;height:100%;object-fit:contain}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head>
<body><main>${slides}</main>
<nav aria-label="${labels.page}">
${button('previous', labels.previous, icon(ChevronLeft))}<output id="counter" aria-live="polite"></output>${button('next', labels.next, icon(ChevronRight))}
${button('play', labels.play, `<span id="play-icon">${icon(Play)}</span><span id="pause-icon" hidden>${icon(Pause)}</span>`)}
<select id="interval" title="${labels.interval}" aria-label="${labels.interval}">${[3, 5, 10, 15, 30].map(seconds => `<option value="${seconds * 1000}"${seconds === 5 ? ' selected' : ''}>${seconds} ${labels.seconds}</option>`).join('')}</select>
${button('fullscreen', labels.fullscreen, icon(Maximize))}${button('print', labels.print, icon(Printer))}
</nav>
<script>
(() => {
  const pages = Array.from(document.querySelectorAll('.page'));
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  const play = document.getElementById('play');
  const interval = document.getElementById('interval');
  const toolbar = document.querySelector('nav');
  let hideTimer = null;
  function concealControls() {
    clearTimeout(hideTimer);
    document.body.classList.remove('controls-visible');
  }
  function hideControls() {
    if (toolbar.matches(':hover') || toolbar.querySelector(':focus-visible')) return;
    concealControls();
  }
  function revealControls() {
    clearTimeout(hideTimer);
    document.body.classList.add('controls-visible');
    hideTimer = setTimeout(hideControls, 1600);
  }
  document.addEventListener('pointermove', revealControls);
  document.addEventListener('pointerdown', revealControls);
  toolbar.addEventListener('pointerenter', () => { clearTimeout(hideTimer); });
  toolbar.addEventListener('pointerleave', revealControls);
  toolbar.addEventListener('focusin', revealControls);
  toolbar.addEventListener('focusout', revealControls);
  document.documentElement.addEventListener('pointerleave', () => {
    clearTimeout(hideTimer);
    hideControls();
  });
  let index = 0;
  let timer = null;
  function show(target) {
    index = (target + pages.length) % pages.length;
    pages.forEach((page, position) => { page.hidden = position !== index; });
    document.getElementById('counter').textContent = (index + 1) + ' / ' + pages.length;
    previous.disabled = index === 0;
    next.disabled = index === pages.length - 1;
  }
  function stop() {
    clearInterval(timer);
    timer = null;
    play.setAttribute('aria-pressed', 'false');
    play.title = play.ariaLabel = '${labels.play}';
    document.getElementById('play-icon').hidden = false;
    document.getElementById('pause-icon').hidden = true;
  }
  function start() {
    stop();
    if (pages.length < 2) return;
    timer = setInterval(() => show(index + 1), Number(interval.value));
    play.setAttribute('aria-pressed', 'true');
    play.title = play.ariaLabel = '${labels.pause}';
    document.getElementById('play-icon').hidden = true;
    document.getElementById('pause-icon').hidden = false;
  }
  previous.onclick = () => { stop(); show(index - 1); concealControls(); };
  next.onclick = () => { stop(); show(index + 1); concealControls(); };
  play.onclick = () => timer === null ? start() : stop();
  interval.onchange = () => { if (timer !== null) start(); };
  play.disabled = interval.disabled = pages.length < 2;
  const fullscreen = document.getElementById('fullscreen');
  fullscreen.disabled = !document.fullscreenEnabled;
  fullscreen.onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch {}
  };
  document.getElementById('print').onclick = async () => {
    stop();
    await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
    window.print();
  };
  window.addEventListener('beforeprint', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLElement && event.target.matches('select,input,textarea')) return;
    if (event.key === 'Tab') revealControls();
    if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(event.key)) { event.preventDefault(); if (!next.disabled) next.click(); concealControls(); }
    if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); if (!previous.disabled) previous.click(); concealControls(); }
    if (event.target instanceof HTMLElement && event.target.matches('button')) return;
    if (event.key === ' ') { event.preventDefault(); play.click(); }
    if (event.key === 'Home') { event.preventDefault(); stop(); show(0); concealControls(); }
    if (event.key === 'End') { event.preventDefault(); stop(); show(pages.length - 1); concealControls(); }
  });
  stop();
  show(0);
})();
</script></body></html>`;
}