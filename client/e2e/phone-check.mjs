#!/usr/bin/env node
/**
 * Phone-width layout checks for RaceTrace (mobile redesign, Step 3).
 *
 * Opens the landing page and every race tab at phone widths against the API stand-in
 * (mock-api.mjs), measures the layout, prints a table, and with --assert fails on the
 * rules that must hold today.
 *
 *   npm run check:phone             build, serve dist/ and check (what CI runs)
 *   node e2e/phone-check.mjs --url http://localhost:5173   check a running dev server
 *
 * Options: --assert (exit 1 on a failed rule), --widths 375,390 (default 320,360,375,390,430),
 * --json <file> (write the measurements),
 * --shots <dir> (save a screenshot of each page).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { mockApi, preparePitAnalysis, RACE_ID } from "./mock-api.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ASSERT = args.includes("--assert");
/** Phone sizes: upright widths (812 tall), and WxH for others; 844x390 and 932x430 are phones held sideways. */
const SIZES = (opt("--widths") ?? "320,360,375,390,430,844x390,932x430").split(",").map((w) => {
  const [width, height] = w.split("x").map(Number);
  return { width, height: height || 812 };
});
const TABS = ["position", "cards", "laptimes", "cycle", "gaps", "h2h", "pitanalysis", "strategy", "drivers"];
const PAGES = [
  { name: "home", path: "/", bar: true },
  { name: "me", path: "/me", bar: true },
  { name: "dashboard", path: "/dashboard", bar: true },
  { name: "events", path: "/races", bar: true },
  ...TABS.map((t) => ({ name: `race:${t}`, path: `/chart?race=${RACE_ID}&tab=${t}`, race: true, chart: t === "position" || t === "laptimes" })),
];

/**
 * Rules checked with --assert. Each later pull request adds the rules it makes true
 * (chart top, lap answer on screen, target sizes), so a regression fails the build.
 */
const RULES = [
  { id: "no-sideways-page", test: (m) => m.sideways === 0, say: (m) => `page scrolls sideways by ${m.sideways} px` },
  { id: "race-built-once", test: (m) => !m.race || m.raceViews === 1, say: (m) => `race views rendered ${m.raceViews} times` },
  { id: "no-page-errors", test: (m) => m.errors.length === 0, say: (m) => `page errors: ${m.errors.join(" | ")}` },
  // PR 2: the phone shell.
  { id: "chart-near-top", test: (m) => m.chartTop === null || m.chartTop <= chartTopMax(m), say: (m) => `chart starts at ${m.chartTop} px (limit ${chartTopMax(m)})` },
  { id: "shell-targets-44", test: (m) => m.shellSmall.length === 0, say: (m) => `phone shell controls under 44 px: ${m.shellSmall.join(", ")}` },
  { id: "app-bar-where-expected", test: (m) => m.appBar === !m.race, say: (m) => (m.race ? "bottom bar shown on a race screen" : "bottom bar missing") },
  // PR 3: the car pill and sheet.
  { id: "compare-rivals-by-default", test: (m) => !m.chart || (m.compareCount !== null && m.compareCount <= 4), say: (m) => `compares ${m.compareCount} cars by default (4 at most on a phone)` },
  // PR 4: the lap sheet.
  { id: "lap-answer-on-screen", test: (m) => !m.chart || (m.lapPanelTop !== null && m.lapPanelTop < m.height), say: (m) => `lap details start at ${m.lapPanelTop} px, below the ${m.height} px screen` },
  { id: "sheet-clear-of-chart", test: (m) => !m.chart || (m.chartBottom !== null && m.lapPanelTop !== null && m.chartBottom <= m.lapPanelTop + 2), say: (m) => `chart bottom ${m.chartBottom} px runs under the lap sheet at ${m.lapPanelTop} px` },
  // PR 4: chart gestures (pinch, double-tap, tap), done with real touch events.
  { id: "double-tap-zooms", test: (m) => !m.chart || (m.g?.dbl1 && m.g.dbl1.range < m.g.dbl1.full * 0.5), say: (m) => `double-tap showed ${JSON.stringify(m.g?.dbl1)}` },
  { id: "double-tap-again-shows-all", test: (m) => !m.chart || m.g?.dbl2 === null, say: (m) => `second double-tap left ${JSON.stringify(m.g?.dbl2)}` },
  { id: "double-tap-keeps-sheet-down", test: (m) => !m.chart || m.g?.levelAfterDbl === "peek", say: (m) => `lap sheet at ${m.g?.levelAfterDbl} after a double-tap` },
  { id: "pinch-zooms", test: (m) => !m.chart || (m.g?.pinch && m.g.pinch.range < m.g.pinch.full * 0.5), say: (m) => `pinch showed ${JSON.stringify(m.g?.pinch)}` },
  { id: "tap-raises-sheet", test: (m) => !m.chart || m.g?.levelAfterTap === "half", say: (m) => `lap sheet at ${m.g?.levelAfterTap} after a tap` },
  { id: "page-not-zoomed", test: (m) => !m.chart || m.g?.pageScale === 1, say: (m) => `the page itself zoomed to ${m.g?.pageScale}` },
  // Views: one sideways-scrolling row with every view, no More menu.
  { id: "every-view-in-the-row", test: (m) => !m.race || (m.viewNames.length >= 5 && !m.viewNames.includes("More")), say: (m) => `views row holds ${m.viewNames.join(", ")}` },
  // The peek is one line (‹ lap ›) and the chart carries no how-to text: help is in ⋯ → Chart gestures.
  { id: "peek-one-line", test: (m) => !m.chart || (m.peekHeight !== null && m.peekHeight <= 64), say: (m) => `lap sheet peek is ${m.peekHeight} px tall` },
  { id: "no-how-to-on-chart", test: (m) => !m.chart || (m.captionLines && !/pinch|tap a lap|swipe/i.test(m.captionLines.text) && m.captionLines.height <= 40), say: (m) => `chart caption: ${JSON.stringify(m.captionLines)}` },
  // The trace opens on race time on a phone, with Laps | Time in its caption line.
  { id: "trace-opens-on-time", test: (m) => m.page !== "race:position" || m.axisPressed === "Time", say: (m) => `trace caption axis shows ${m.axisPressed}` },
  // Step 5: tables are cards on a phone; nothing scrolls sideways but chip rows and the views row.
  { id: "no-sideways-tables", test: (m) => !m.race || m.widestScroller === 0, say: (m) => `something scrolls sideways, ${m.widestScroller} px wide` },
  { id: "cards-not-tables", test: (m) => !["race:pitanalysis", "race:strategy", "race:drivers"].includes(m.page) || m.cardLists > 0, say: () => "no phone card list on a table view" },
  { id: "card-controls-44", test: (m) => m.cardControlsSmall.length === 0, say: (m) => `sort or class controls under 44 px: ${m.cardControlsSmall.join(", ")}` },
  { id: "race-targets-44", test: (m) => !m.race || m.smallTargets === 0, say: (m) => `controls under 44 px on a race view: ${m.smallList.join(", ")}` },
  // Step 6: Home and Events.
  { id: "home-car-on-first-screen", test: (m) => m.page !== "dashboard" || m.width > m.height || (m.homeStoryBottom !== null && m.homeStoryBottom <= m.height - 64), say: (m) => `"Read the story" ends at ${m.homeStoryBottom} px, under the bottom bar` },
  { id: "home-swipe-next-car", test: (m) => m.page !== "dashboard" || /1 OF 2 → .*2 OF 2/i.test(m.swipe ?? ""), say: (m) => `swiping your car: ${m.swipe}` },
  { id: "race-cards-share-on-screen", test: (m) => m.page !== "race:cards" || (m.cards?.shareEnabled && m.cards.shareBottom <= m.height && m.cards.slides >= 2 && m.cards.imgHeight >= 150), say: (m) => `race cards: ${JSON.stringify(m.cards)}` },
  { id: "race-cards-swipe", test: (m) => m.page !== "race:cards" || (m.cards?.afterSwipe && !/race$/.test(m.cards.afterSwipe)), say: (m) => `after a swipe the chosen card is ${m.cards?.afterSwipe}` },
  { id: "events-opens-on-my-cars", test: (m) => m.page !== "events" || m.eventsScope === "My cars", say: (m) => `Events opens on ${m.eventsScope}` },
  { id: "app-targets-44", test: (m) => m.race || m.page === "home" || m.smallTargets === 0, say: (m) => `controls under 44 px: ${m.smallList.join(", ")}` },
  { id: "bars-slide-away-on-scroll", test: (m) => !m.hide || m.hide.error === "nothing to scroll" || (m.hide.down < 0 && m.hide.up >= 0), say: (m) => `header top before/down/up: ${JSON.stringify(m.hide)}` },
  { id: "race-header-one-line", test: (m) => !m.race || (m.raceHeader !== null && m.raceHeader <= 60), say: (m) => `race header is ${m.raceHeader} px tall` },
];
/** 30% of the 812 px design screen. */
const chartTopMax = (m) => (m.height < m.width ? 120 : Math.round(812 * 0.3));

async function serve() {
  const dist = path.resolve(here, "../dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error("dist/index.html is missing: run vite build first");
  // Vite's own entry, not npx, so stopping it stops the server rather than a wrapper.
  const vite = path.resolve(here, "../node_modules/vite/bin/vite.js");
  const proc = spawn(process.execPath, [vite, "preview", "--port", "4173", "--strictPort"], { cwd: path.resolve(here, ".."), stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("vite preview did not start")), 30_000);
    proc.stdout.on("data", (d) => String(d).includes("4173") && (clearTimeout(t), resolve()));
    proc.on("exit", (c) => reject(new Error(`vite preview exited ${c}`)));
  });
  proc.stdout.resume();
  return { url: "http://localhost:4173", stop: () => proc.kill() };
}

/** Everything measured on one page at one width, in CSS px. */
function measure() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const doc = document.scrollingElement;
  const canvas = [...document.querySelectorAll("canvas")].find(vis);
  const aside = [...document.querySelectorAll("[data-lap-sheet]")].find(vis) ?? [...document.querySelectorAll("aside")].find(vis);
  const targets = [...document.querySelectorAll("button, a[href], select, input, [role=button], [role=tab]")].filter(vis);
  // data-touch-44: drawn small, with a 44 px touch area reaching past it (::before).
  const small = targets.filter((el) => {
    if (el.hasAttribute("data-touch-44")) return false;
    const r = el.getBoundingClientRect();
    return r.height < 44 || r.width < 24;
  });
  const sidewaysScrollers = [...document.querySelectorAll("*")].filter((el) => {
    if (!vis(el) || el === doc) return false;
    const s = getComputedStyle(el);
    // Rows of chips and the views row scroll sideways by design; a table or page must not.
    if (el.tagName === "NAV" || el.getAttribute("role") === "tablist" || el.closest("[data-phone-cards='chips']") || el.hasAttribute("data-carousel")) return false;
    return (s.overflowX === "auto" || s.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 4;
  });
  const shell = [...document.querySelectorAll("[data-phone-shell]")].filter(vis);
  const shellSmall = shell
    .flatMap((el) => [...el.querySelectorAll("button, a[href]")])
    .filter(vis)
    .filter((el) => el.getBoundingClientRect().height < 44)
    .map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 24));
  const raceHeader = document.querySelector('[data-phone-shell="race-header"]');
  return {
    compareCount: document.querySelector("[data-compare-count]") ? Number(document.querySelector("[data-compare-count]").getAttribute("data-compare-count")) : null,
    appBar: shell.some((el) => el.getAttribute("data-phone-shell") === "app-bar"),
    raceHeader: raceHeader && vis(raceHeader) ? Math.round(raceHeader.getBoundingClientRect().height) : null,
    shellSmall,
    sideways: Math.max(0, doc.scrollWidth - innerWidth),
    raceViews: document.querySelectorAll('nav[aria-label="Race views"]').length,
    viewNames: [...document.querySelectorAll('nav[aria-label="Race views"] button')].map((b) => b.textContent.trim()),
    canvases: document.querySelectorAll("canvas").length,
    chartTop: canvas ? Math.round(canvas.getBoundingClientRect().top) : null,
    chartBottom: canvas ? Math.round(canvas.getBoundingClientRect().bottom) : null,
    lapPanelTop: aside ? Math.round(aside.getBoundingClientRect().top) : null,
    peekHeight: (() => {
      const sh = [...document.querySelectorAll("[data-lap-sheet]")].find((e) => e.offsetParent !== null || e.getClientRects().length);
      return sh ? Math.round(sh.getBoundingClientRect().height) : null;
    })(),
    captionLines: (() => {
      const fc = [...document.querySelectorAll("figure figcaption")].find((e) => e.getClientRects().length);
      return fc ? { text: fc.innerText, height: Math.round(fc.getBoundingClientRect().height) } : null;
    })(),
    axisPressed: (() => {
      const fc = [...document.querySelectorAll("figure figcaption")].find((e) => e.getClientRects().length);
      return fc?.querySelector('[aria-label="X axis"] [aria-pressed="true"]')?.textContent ?? null;
    })(),
    targets: targets.length,
    smallTargets: small.length,
    smallList: small.map((el) => `${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 24)} ${Math.round(el.getBoundingClientRect().height)}`),
    pageHeight: doc.scrollHeight,
    homeStoryBottom: (() => {
      const b = [...document.querySelectorAll("[data-phone-home='primary']")].find(vis);
      return b ? Math.round(b.getBoundingClientRect().bottom) : null;
    })(),
    eventsScope: document.querySelector("[data-phone-events='scope'] [aria-selected='true']")?.textContent ?? null,
    widestScroller: sidewaysScrollers.reduce((w, el) => Math.max(w, el.scrollWidth), 0),
    cardControlsSmall: [...document.querySelectorAll("[data-phone-cards='sort'] button, [data-phone-cards='sort'] label, [data-phone-cards='chips'] button")]
      .filter(vis)
      .filter((el) => !el.hasAttribute("data-touch-44") && el.getBoundingClientRect().height < 44)
      .map((el) => el.textContent.trim().slice(0, 20)),
    cardLists: document.querySelectorAll("[data-phone-cards]:not([data-phone-cards='sort']):not([data-phone-cards='chips'])").length,
  };
}

/** The zoom the caption shows ("Laps 41–81 of 121 · show all"), or null when the whole race shows. */
async function zoomShown(page) {
  const text = await page.locator("figure:visible figcaption").first().innerText();
  const m = text.match(/Laps (\d+)–(\d+) of (\d+)/);
  return m ? { range: +m[2] - +m[1], full: +m[3] - 1 } : null;
}

/** Scrolling a view down slides the bars away; scrolling back up brings them back. */
async function hideOnScroll(page) {
  const scroller = async (by) =>
    page.evaluate((by) => {
      const el = [...document.querySelectorAll("*")].find((e) => {
        const s = getComputedStyle(e);
        return (s.overflowY === "auto" || s.overflowY === "scroll") && e.scrollHeight - e.clientHeight > 300 && e.getClientRects().length && !e.closest("[data-lap-sheet]");
      });
      if (!el) return false;
      el.scrollBy({ top: by });
      return true;
    }, by);
  const header = async () => Math.round((await page.locator("[data-phone-shell='race-header']").first().boundingBox())?.y ?? 999);
  const before = await header();
  if (!(await scroller(200))) return { error: "nothing to scroll" };
  await page.waitForTimeout(150);
  await scroller(200);
  await page.waitForTimeout(400);
  const down = await header();
  await scroller(-60);
  await page.waitForTimeout(400);
  const up = await header();
  return { before, down, up };
}

/** Race cards: the first card drawn, its Share button on screen and live, and a swipe to the next card. */
async function raceCards(page) {
  await page.locator("[data-race-card] img").first().waitFor({ timeout: 15_000 });
  const share = page.locator("[data-race-cards='share']");
  const box = await share.boundingBox();
  const out = {
    slides: await page.locator("[data-race-card]").count(),
    shareBottom: box ? Math.round(box.y + box.height) : null,
    shareEnabled: await share.isEnabled(),
    imgHeight: Math.round((await page.locator("[data-race-card] img").first().boundingBox())?.height ?? 0),
  };
  await page.locator("[data-race-cards='strip']").evaluate((el) => el.scrollTo({ left: el.clientWidth }));
  await page.waitForTimeout(500);
  out.afterSwipe = await page.locator("[role=tablist][aria-label=Cards] [aria-selected=true]").innerText();
  return out;
}

/** Home: a sideways swipe on your car moves to your next car. Returns the heading before and after. */
async function swipeCars(page) {
  const heading = () => page.locator("[data-phone-home='car'] h2").first().innerText();
  const before = await heading();
  await page.locator("[data-phone-home='car'] article").first().scrollIntoViewIfNeeded();
  const box = await page.locator("[data-phone-home='car'] article").first().boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + 60;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width - 30, y }] });
  for (let i = 1; i <= 5; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + box.width - 30 - i * 40, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(600);
  return `${before} → ${await heading()}`;
}

/** Real touch events through the DevTools protocol, which Playwright's tap cannot do with two fingers. */
async function gestures(page) {
  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator("canvas:visible").first().boundingBox();
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const tap = async (x, y) => {
    await touch("touchStart", [[x, y]]);
    await touch("touchEnd", []);
  };
  const doubleTap = async () => {
    await tap(cx, cy);
    await page.waitForTimeout(90);
    await tap(cx + 3, cy + 2);
    await page.waitForTimeout(500);
  };
  const level = () => page.locator("[data-lap-sheet]:visible").getAttribute("data-level");
  const g = {};
  await doubleTap();
  g.dbl1 = await zoomShown(page);
  g.levelAfterDbl = await level();
  await doubleTap();
  g.dbl2 = await zoomShown(page);
  // Pinch apart from 60 px to 240 px.
  await touch("touchStart", [[cx - 30, cy], [cx + 30, cy]]);
  for (let i = 1; i <= 6; i++) await touch("touchMove", [[cx - 30 - i * 15, cy], [cx + 30 + i * 15, cy]]);
  await touch("touchEnd", []);
  await page.waitForTimeout(150);
  g.pinch = await zoomShown(page);
  g.pageScale = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  await tap(cx, cy);
  await page.waitForTimeout(600);
  g.levelAfterTap = await level();
  await cdp.detach();
  return g;
}

async function main() {
  await preparePitAnalysis();
  const server = opt("--url") ? { url: opt("--url"), stop: () => {} } : await serve();
  const browser = await chromium.launch();
  const rows = [];
  const unknownRoutes = new Set();
  try {
    for (const { width, height } of SIZES) {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      for (const pg of PAGES) {
        const t0 = Date.now();
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
        const unknown = await mockApi(page);
        await page.goto(server.url + pg.path, { waitUntil: "load" });
        if (pg.race) await page.waitForSelector('nav[aria-label="Race views"]', { timeout: 15_000 }).catch(() => {});
        if (pg.chart) await page.locator("canvas:visible").first().waitFor({ timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(1200);
        const m = await page.evaluate(measure);
        if (pg.name === "race:strategy" || pg.name === "race:gaps") m.hide = await hideOnScroll(page).catch((e) => ({ error: String(e.message).slice(0, 120) }));
        if (pg.name === "race:cards") m.cards = await raceCards(page).catch((e) => ({ error: String(e.message).slice(0, 120) }));
        if (pg.name === "dashboard") m.swipe = await swipeCars(page).catch((e) => String(e.message).slice(0, 120));
        if (pg.chart) m.g = await gestures(page).catch((e) => ({ error: String(e.message).slice(0, 120) }));
        unknown.forEach((u) => unknownRoutes.add(u));
        if (opt("--shots")) {
          fs.mkdirSync(opt("--shots"), { recursive: true });
          await page.screenshot({ path: path.join(opt("--shots"), `${pg.name.replace(":", "-")}-${height === 812 ? width : `${width}x${height}`}.png`) });
        }
        rows.push({ width, height, page: pg.name, race: !!pg.race, chart: !!pg.chart, errors, ...m, ms: Date.now() - t0 });
        await page.close();
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }

  const cols = ["width", "page", "sideways", "raceViews", "chartTop", "lapPanelTop", "raceHeader", "appBar", "compareCount", "smallTargets", "targets", "widestScroller", "ms"];
  console.log(cols.join("\t"));
  for (const r of rows) console.log(cols.map((c) => r[c] ?? "-").join("\t"));
  if (unknownRoutes.size) console.log(`\nRoutes the stand-in answered 404: ${[...unknownRoutes].sort().join(", ")}`);
  if (opt("--json")) fs.writeFileSync(opt("--json"), JSON.stringify(rows, null, 2));

  const failures = [];
  for (const r of rows) for (const rule of RULES) if (!rule.test(r)) failures.push(`${rule.id} @ ${r.height === 812 ? `${r.width}px` : `${r.width}x${r.height}`} ${r.page}: ${rule.say(r)}`);
  if (failures.length) {
    console.log(`\n${failures.length} rule failure(s):\n  ${failures.join("\n  ")}`);
    if (ASSERT) process.exit(1);
  } else console.log("\nAll phone rules pass.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
