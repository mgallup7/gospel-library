// Draws the apps' icons and launch screens from web/icons/icon.svg into the iOS and Android projects.
// Run once, and again only if the icon changes:  node scripts/make-icons.mjs
// (needs Playwright with Chromium; the drawings it writes are kept in the repo, so a build does not need it)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT || "playwright");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = fs.readFileSync(path.resolve(root, "..", "web", "icons", "icon.svg"), "utf8");
const BLUE = "#1f4e79", PAPER = "#f3f2ef";
// the book alone, without the rounded tile behind it (each system cuts its own shape)
const mark = svg.replace(/<rect width="512" height="512"[^>]*\/>/, "");
const page = (w, h, body, bg) => `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;background:${bg};display:flex;align-items:center;justify-content:center;overflow:hidden">${body}</body></html>`;
const sized = (s, px) => s.replace("<svg ", `<svg width="${px}" height="${px}" `);

const browser = await chromium.launch();
const shot = async (file, w, h, html, transparent = false) => {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(html);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await p.screenshot({ path: file, omitBackground: transparent });
  await p.close();
};

// iOS: one square icon with no transparency (the system rounds it), and a launch image
const ios = path.join(root, "ios", "App", "App", "Assets.xcassets");
await shot(path.join(ios, "AppIcon.appiconset", "AppIcon-512@2x.png"), 1024, 1024, page(1024, 1024, sized(mark, 1024), BLUE));
for (const f of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) await shot(path.join(ios, "Splash.imageset", f), 2732, 2732, page(2732, 2732, sized(svg, 360), PAPER));

// Android: the old square and round icons, the layered icon's front (the book, inside the safe middle), and launch images
const res = path.join(root, "android", "app", "src", "main", "res");
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const s = Math.round(48 * k), f = Math.round(108 * k);
  await shot(path.join(res, `mipmap-${d}`, "ic_launcher.png"), s, s, page(s, s, sized(svg, s), "transparent"), true);
  await shot(path.join(res, `mipmap-${d}`, "ic_launcher_round.png"), s, s, page(s, s, `<div style="width:${s}px;height:${s}px;border-radius:50%;background:${BLUE};display:flex;align-items:center;justify-content:center">${sized(mark, Math.round(s * 0.82))}</div>`, "transparent"), true);
  await shot(path.join(res, `mipmap-${d}`, "ic_launcher_foreground.png"), f, f, page(f, f, sized(mark, Math.round(f * 0.6)), "transparent"), true);
  const [pw, ph] = [Math.round(320 * k), Math.round(480 * k)];
  await shot(path.join(res, `drawable-port-${d}`, "splash.png"), pw, ph, page(pw, ph, sized(svg, Math.round(96 * k)), PAPER));
  await shot(path.join(res, `drawable-land-${d}`, "splash.png"), ph, pw, page(ph, pw, sized(svg, Math.round(96 * k)), PAPER));
}
await shot(path.join(res, "drawable", "splash.png"), 480, 320, page(480, 320, sized(svg, 96), PAPER));
fs.writeFileSync(path.join(res, "values", "ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BLUE}</color>\n</resources>\n`);
await browser.close();
console.log("icons and launch screens written");
