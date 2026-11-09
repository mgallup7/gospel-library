/* My studies: pages of your own, kept on this device and read inside the app.

   A study you built (an HTML page), a lesson, notes in Markdown or plain text: add
   the file from Files and it opens here, offline, with its own look, and every link to
   the scriptures or to a talk opens the local copy. The files live in the browser's own
   database (IndexedDB), apart from the library, so a library update leaves them alone.

   The page is shown in a sandboxed frame (from a blob address of its own, so its #links
   work): its own styles and scripts run, but it cannot see the app or the library key.
   A small script added to the page hands its links to the web over to the app, which
   resolves them against the library (app.js followLink). */
import { markdown as renderMarkdown } from "./lib/markdown.js";
import { esc, mb } from "./lib/format.js";
import { findReferences } from "./lib/refs.js";

(() => {
  "use strict";
  const DB = "gospel-studies", STORE = "studies", MAX_BYTES = 12 * 1024 * 1024;

  function openDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error("the studies database did not open"));
    });
  }
  async function tx(mode, work) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = work(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
      t.onerror = () => { db.close(); reject(t.error || new Error("the studies database failed")); };
      t.onabort = () => { db.close(); reject(t.error || new Error("the studies database failed")); };
    });
  }
  const list = async () => { try { return ((await tx("readonly", (s) => s.getAll())) || []).sort((a, b) => b.added - a.added).map(meta); } catch (_) { return []; } };
  const get = (id) => tx("readonly", (s) => s.get(id));
  // the app keeps what it read from the studies (their words for search, the chapters they link to)
  // until this says they changed
  const changed = () => window.dispatchEvent(new Event("studies:change"));
  const put = async (rec) => { const r = await tx("readwrite", (s) => s.put(rec)); changed(); return r; };
  const remove = async (id) => { const r = await tx("readwrite", (s) => s.delete(id)); changed(); return r; };
  const meta = ({ id, title, kind, added, size, source }) => ({ id, title, kind, added, size, source });

  // ---- taking a file in -------------------------------------------------
  async function add(file) {
    if (!file) throw new Error("No file was chosen.");
    if (file.size > MAX_BYTES) throw new Error(`That file is ${mb(file.size)}; pages up to ${mb(MAX_BYTES)} can be added.`);
    const text = await file.text();
    if (!text.trim()) throw new Error(`“${file.name || "That file"}” is empty; there is nothing in it to add.`);
    const name = file.name || "page";
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [, ""])[1].toLowerCase();
    const looksHtml = /^\s*(<!doctype html|<html|<head|<body|<div|<article|<section|<p|<h1)/i.test(text) || ext === "html" || ext === "htm";
    const kind = looksHtml ? "html" : (ext === "md" || ext === "markdown") ? "md" : "txt";
    const title = titleOf(text, kind, name);
    const rec = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title, kind, html: kind === "html" ? text : null, text: kind === "html" ? null : text,
      added: Date.now(), size: file.size, source: name };
    await put(rec);
    return meta(rec);
  }
  function titleOf(text, kind, name) {
    const fallback = name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled page";
    if (kind === "html") {
      const t = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const plain = t ? decode(t[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : "";
      return plain || fallback;
    }
    const h = text.match(/^\s*#\s+(.+)$/m);
    if (h) return h[1].trim();
    const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    return first && first.length <= 80 ? first : fallback;
  }
  function decode(s) { const d = document.createElement("textarea"); d.innerHTML = s; return d.value; }

  // ---- the page, ready for the frame -------------------------------------
  // The hand-off script: any link to the web goes to the app, which opens the local copy
  // when the library holds it; the page's own #links scroll within the page.
  const HANDOFF = `<script>(function(){
document.addEventListener("click",function(e){
  var a=e.target&&e.target.closest?e.target.closest("a[href]"):null; if(!a) return;
  var h=a.getAttribute("href")||"";
  if(h.charAt(0)==="#"){ // the page's own anchors: the frame has no address of its own, so scroll by hand
    e.preventDefault(); e.stopPropagation();
    var id=decodeURIComponent(h.slice(1)); var t=id?(document.getElementById(id)||document.getElementsByName(id)[0]):document.documentElement; if(!t) return;
    var d=t.tagName==="DETAILS"?t:t.querySelector("details"); if(d) d.open=true;
    t.scrollIntoView({block:"start"}); return;
  }
  if(/^(https?:)?\\/\\//i.test(h)||h.indexOf("/study/")===0||h.indexOf("/scriptures/")===0||h.indexOf("/")===0){ e.preventDefault(); e.stopPropagation(); parent.postMessage({type:"gospel:link",href:h},"*"); }
},true);
var t=null; addEventListener("scroll",function(){clearTimeout(t);t=setTimeout(function(){parent.postMessage({type:"gospel:scroll",y:scrollY},"*");},150);},{passive:true});
addEventListener("message",function(e){if(e.data&&e.data.type==="gospel:scrollTo")scrollTo(0,e.data.y||0);
  if(e.data&&e.data.type==="gospel:anchor"){var t=document.getElementById(String(e.data.id||""));if(t){var d=t.closest("details");if(d)d.open=true;t.scrollIntoView({block:"start"});}}});
})();</script>`;
  function frameHtml(rec) {
    if (rec.kind === "html") {
      const html = rec.html || "";
      if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + HANDOFF);
      if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + "<head>" + HANDOFF + "</head>");
      return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${HANDOFF}</head><body>${html}</body></html>`;
    }
    const body = bodyOf(rec);
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark">${HANDOFF}
<style>
:root{color-scheme:light dark;--bg:#fbfaf7;--ink:#1d1f22;--ink2:#5b6068;--accent:#2e5aac;--rule:#e2e0d9}
@media (prefers-color-scheme:dark){:root{--bg:#15171a;--ink:#e8e6e1;--ink2:#a0a5ad;--accent:#8fb4ff;--rule:#2c3036}}
body{margin:0;padding:20px max(18px,env(safe-area-inset-right)) 60px max(18px,env(safe-area-inset-left));background:var(--bg);color:var(--ink);font:17px/1.6 Charter,Georgia,"Times New Roman",serif;max-width:68ch;margin-inline:auto}
h1,h2,h3{line-height:1.25;font-weight:600}h1{font-size:28px;margin:.2em 0 .6em}h2{font-size:22px;margin:1.4em 0 .4em}h3{font-size:18px;margin:1.2em 0 .3em}
p,li{margin:0 0 .8em}ul,ol{padding-left:1.4em}blockquote{margin:0 0 .8em;padding:.2em 0 .2em 1em;border-left:3px solid var(--rule);color:var(--ink2)}
a{color:var(--accent)}code{font:14px ui-monospace,Menlo,monospace;background:rgba(127,127,127,.12);padding:1px 4px;border-radius:4px}
pre.plain{white-space:pre-wrap;font:inherit;margin:0}hr{border:0;border-top:1px solid var(--rule);margin:1.6em 0}
</style></head><body>${body}</body></html>`;
  }
  // Enough Markdown for notes and lessons: headings, paragraphs, lists, quotes, emphasis, links.
  // The renderer is Ask's (lib/markdown.js) in its page mode: no citation buttons and no
  // quotation check, since the frame has neither the passages nor the app.
  function markdown(src) { return renderMarkdown(src, { page: true }); }
  // The words of the page, for Think it through
  function plainText(rec) {
    if (rec.kind !== "html") return rec.text || "";
    const doc = new DOMParser().parseFromString(rec.html || "", "text/html");
    for (const junk of doc.querySelectorAll("script, style, noscript, template")) junk.remove();
    return (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ").trim();
  }

  // A Markdown or text page as HTML, with its plain references and web addresses made links: a
  // .txt keeps its lines (pre-wrap) but is no longer a dead block of text.
  function bodyOf(rec) {
    const html = rec.kind === "md" ? markdown(rec.text || "") : `<pre class="plain">${esc(rec.text || "")}</pre>`;
    return linkify(html);
  }
  const URL_RE = /\bhttps?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g;
  // Every reference ("Alma 32:21") and web address in the words of the page becomes a link, the
  // way a link written by hand would be; nothing inside a link already, or in code, is touched.
  function linkify(html) {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement.closest("a, code, script, style") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue;
      const spans = [];
      for (const m of text.matchAll(URL_RE)) spans.push({ start: m.index, end: m.index + m[0].length, href: m[0] });
      for (const r of findReferences(text)) if (!spans.some((s) => r.start < s.end && s.start < r.end)) spans.push(r);
      if (!spans.length) continue;
      spans.sort((a, b) => a.start - b.start);
      const frag = doc.createDocumentFragment();
      let last = 0;
      for (const s of spans) {
        frag.append(text.slice(last, s.start));
        const a = doc.createElement("a");
        a.href = s.href;
        a.textContent = text.slice(s.start, s.end);
        frag.append(a);
        last = s.end;
      }
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
    return doc.body.innerHTML;
  }
  // What the app keeps of a study to search it and to know which chapters it links to: its words,
  // its headings (where each begins in the words, and its id, so a match opens at the nearest one)
  // and its links (each with where it sits in the words).
  function index(rec) {
    const html = rec.kind === "html" ? rec.html || "" : bodyOf(rec);
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const junk of doc.querySelectorAll("script, style, noscript, template")) junk.remove();
    let text = "";
    const anchors = [], links = [];
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.nodeType === 3) {
        const t = n.nodeValue.replace(/\s+/g, " ");
        if (t.trim()) text += !text ? t.trimStart() : (!text.endsWith(" ") && !t.startsWith(" ") ? " " : "") + t;
        continue;
      }
      if (/^H[1-6]$/.test(n.tagName)) {
        const holder = n.id ? n : n.closest("[id]");
        if (holder && holder.id) anchors.push({ at: text.length, id: holder.id, label: n.textContent.replace(/\s+/g, " ").trim().slice(0, 80) });
      } else if (n.tagName === "A" && n.getAttribute("href")) links.push({ href: n.getAttribute("href"), at: text.length });
    }
    return { id: rec.id, title: rec.title, kind: rec.kind, text, anchors, links };
  }

  window.Studies = { list, get, add, remove, frameHtml, plainText, mb, index };
})();
