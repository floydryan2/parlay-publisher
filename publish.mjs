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
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());
page.on("pageerror", (e) => console.log("[page error]", String(e).slice(0, 300)));

console.log(`Starting ${mode} publish at ${new Date().toISOString()}`);
await page.goto(`${site}/?bot=${mode}`, { waitUntil: "load" });

let last = "";
const t0 = Date.now();
for (;;) {
  const st = await page.evaluate(() => ({ bot: window.__bot || null, log: (document.querySelector("#log") || {}).textContent || "", sheet: ((document.querySelector("#sheetBody") || {}).innerText || "").replace(/\s+/g, " ").slice(0, 160) })).catch(() => null);
  if (st) {
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
