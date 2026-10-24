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
const WIDTHS = (opt("--widths") ?? "320,360,375,390,430").split(",").map(Number);
const HEIGHT = 812;
const TABS = ["position", "laptimes", "pitanalysis", "strategy", "drivers"];
const PAGES = [
  { name: "home", path: "/", bar: true },
  { name: "me", path: "/me", bar: true },
  { name: "dashboard", path: "/dashboard", bar: true },
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
  { id: "chart-near-top", test: (m) => m.chartTop === null || m.chartTop <= CHART_TOP_MAX, say: (m) => `chart starts at ${m.chartTop} px (limit ${CHART_TOP_MAX})` },
  { id: "shell-targets-44", test: (m) => m.shellSmall.length === 0, say: (m) => `phone shell controls under 44 px: ${m.shellSmall.join(", ")}` },
  { id: "app-bar-where-expected", test: (m) => m.appBar === !m.race, say: (m) => (m.race ? "bottom bar shown on a race screen" : "bottom bar missing") },
  { id: "race-header-one-line", test: (m) => !m.race || (m.raceHeader !== null && m.raceHeader <= 60), say: (m) => `race header is ${m.raceHeader} px tall` },
];
/** 30% of the 812 px design screen. */
const CHART_TOP_MAX = Math.round(812 * 0.3);

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
  const aside = [...document.querySelectorAll("aside")].find(vis);
  const targets = [...document.querySelectorAll("button, a[href], select, input, [role=button], [role=tab]")].filter(vis);
  const small = targets.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.height < 44 || r.width < 24;
  });
  const sidewaysScrollers = [...document.querySelectorAll("*")].filter((el) => {
    if (!vis(el) || el === doc) return false;
    const s = getComputedStyle(el);
    return (s.overflowX === "auto" || s.overflowX === "scroll") && el.scrollWidth > el.clientWidth + 4 && el.tagName !== "NAV";
  });
  const shell = [...document.querySelectorAll("[data-phone-shell]")].filter(vis);
  const shellSmall = shell
    .flatMap((el) => [...el.querySelectorAll("button, a[href]")])
    .filter(vis)
    .filter((el) => el.getBoundingClientRect().height < 44)
    .map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 24));
  const raceHeader = document.querySelector('[data-phone-shell="race-header"]');
  return {
    appBar: shell.some((el) => el.getAttribute("data-phone-shell") === "app-bar"),
    raceHeader: raceHeader && vis(raceHeader) ? Math.round(raceHeader.getBoundingClientRect().height) : null,
    shellSmall,
    sideways: Math.max(0, doc.scrollWidth - innerWidth),
    raceViews: document.querySelectorAll('nav[aria-label="Race views"]').length,
    canvases: document.querySelectorAll("canvas").length,
    chartTop: canvas ? Math.round(canvas.getBoundingClientRect().top) : null,
    lapPanelTop: aside ? Math.round(aside.getBoundingClientRect().top) : null,
    targets: targets.length,
    smallTargets: small.length,
    widestScroller: sidewaysScrollers.reduce((w, el) => Math.max(w, el.scrollWidth), 0),
  };
}

async function main() {
  await preparePitAnalysis();
  const server = opt("--url") ? { url: opt("--url"), stop: () => {} } : await serve();
  const browser = await chromium.launch();
  const rows = [];
  const unknownRoutes = new Set();
  try {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: HEIGHT }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
        unknown.forEach((u) => unknownRoutes.add(u));
        if (opt("--shots")) {
          fs.mkdirSync(opt("--shots"), { recursive: true });
          await page.screenshot({ path: path.join(opt("--shots"), `${pg.name.replace(":", "-")}-${width}.png`) });
        }
        rows.push({ width, page: pg.name, race: !!pg.race, errors, ...m, ms: Date.now() - t0 });
        await page.close();
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }

  const cols = ["width", "page", "sideways", "raceViews", "chartTop", "lapPanelTop", "raceHeader", "appBar", "smallTargets", "targets", "widestScroller", "ms"];
  console.log(cols.join("\t"));
  for (const r of rows) console.log(cols.map((c) => r[c] ?? "-").join("\t"));
  if (unknownRoutes.size) console.log(`\nRoutes the stand-in answered 404: ${[...unknownRoutes].sort().join(", ")}`);
  if (opt("--json")) fs.writeFileSync(opt("--json"), JSON.stringify(rows, null, 2));

  const failures = [];
  for (const r of rows) for (const rule of RULES) if (!rule.test(r)) failures.push(`${rule.id} @ ${r.width}px ${r.page}: ${rule.say(r)}`);
  if (failures.length) {
    console.log(`\n${failures.length} rule failure(s):\n  ${failures.join("\n  ")}`);
    if (ASSERT) process.exit(1);
  } else console.log("\nAll phone rules pass.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
