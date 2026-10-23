// Opens The Parlay Plug in a headless browser as the owner and runs the same publish the Publish button runs.
//   node publish.mjs full   -> pull every line, research every player, publish
//   node publish.mjs odds   -> pull fresh lines, keep the published research, publish
import { chromium } from "playwright";

const mode = process.argv[2] === "odds" ? "odds" : "full";
const site = (process.env.SITE_URL || "").replace(/\/+$/, "");
const code = process.env.ADMIN_CODE || "";
if (!site || !code) { console.error("Set SITE_URL and ADMIN_CODE (GitHub repo secrets)."); process.exit(2); }

const maxMin = mode === "full" ? 100 : 25;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
await ctx.addInitScript((c) => {
  try {
    localStorage.setItem("srvcfg", JSON.stringify({ token: "", admin: c }));
    localStorage.setItem("plugtour", "done"); localStorage.setItem("plugseen", "v999"); localStorage.setItem("plugdisc", "1");
    sessionStorage.setItem("nflsplash", "1");
  } catch {}
}, code);
// ESPN and the weather service refuse a GitHub machine, so those requests go through your site's owner-only relay (/api/ext) instead.
const RELAY = /^https:\/\/(site\.api\.espn\.com|site\.web\.api\.espn\.com|sports\.core\.api\.espn\.com|lm-api-reads\.fantasy\.espn\.com|cdn\.espn\.com|api\.weather\.gov|geocoding-api\.open-meteo\.com|api\.open-meteo\.com)\//;
await ctx.route((u) => RELAY.test(u.toString()), async (route) => {
  const req = route.request();
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
  try {
    const r = await fetch(`${site}/api/ext?u=${encodeURIComponent(req.url())}`, { headers: { "x-admin": code } });
    const body = Buffer.from(await r.arrayBuffer());
    if (r.status >= 400) console.log(`[relay ${r.status}] ${req.url().slice(0, 90)} :: ${body.toString().slice(0, 220)}`);
    return route.fulfill({ status: r.status, body, headers: { "content-type": r.headers.get("content-type") || "application/json", "access-control-allow-origin": "*" } });
  } catch (e) { return route.abort(); }
});
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
page.on("pageerror", (e) => console.log("[page error]", String(e).slice(0, 300)));
const seenBad = new Set();
const shortUrl = (u) => u.replace(/([?&](apiKey|key|token)=)[^&]+/gi, "$1***").slice(0, 160);
page.on("requestfailed", (r) => { const k = "F" + r.url(); if (seenBad.has(k)) return; seenBad.add(k); console.log(`[request failed] ${r.method()} ${shortUrl(r.url())} :: ${r.failure() && r.failure().errorText}`); });
page.on("response", (r) => { if (r.status() >= 400) { const k = "S" + r.status() + r.url(); if (seenBad.has(k)) return; seenBad.add(k); console.log(`[http ${r.status()}] ${r.request().method()} ${shortUrl(r.url())}`); } });
page.on("console", (m) => { if (m.type() === "error") console.log("[console error]", m.text().slice(0, 240)); });

console.log(`Starting ${mode} publish at ${new Date().toISOString()}`);
await page.goto(`${site}/?bot=${mode}`, { waitUntil: "load" });

let last = "";
let seenLog = 0;
const t0 = Date.now();
for (;;) {
  const st = await page.evaluate(() => {
    const b = (typeof vet !== "undefined" && vet && vet.best) ? vet.best : null;
    const q = (typeof vet !== "undefined" && vet && vet.q) ? ` · web ${vet.q.i || 0}/${vet.q.n || 0}` : "";
    const prog = b && b.done !== true && !document.querySelector("#pubTxt") ? `${b.stage || ""} — ${b.text || ""}${q}` : "";
    const pl = (window.__plog || []).slice();
    return { pl, bot: window.__bot || null, log: (document.querySelector("#log") || {}).textContent || "", sheet: prog || ((document.querySelector("#sheetBody") || {}).innerText || "").replace(/\s+/g, " ").slice(0, 160) };
  }).catch(() => null);
  if (st) {
    for (; seenLog < (st.pl || []).length; seenLog++) console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${st.pl[seenLog]}`);
    const line = (st.sheet || st.log).trim();
    if (line && line !== last) { last = line; console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${line}`); }
    if (st.bot && (st.bot.state === "done" || st.bot.state === "error")) {
      console.log(`Result: ${st.bot.state}. ${st.bot.msg || ""}`);
      await browser.close();
      process.exit(st.bot.state === "done" ? 0 : 1);
    }
  }
  if (Date.now() - t0 > maxMin * 60000) { console.log("Timed out."); await browser.close(); process.exit(1); }
  await page.waitForTimeout(5000);
}
