# Phone redesign: where the work lives

The phone redesign is built away from production and rolled over once it is tested on real phones.

- **Plan:** "RaceTrace mobile redesign — Step 1 plan" (Claude doc), summarised in `claude/MOBILE_REDESIGN_PLAN.md` in the WRL Data Analysis Site project.
- **Integration branch:** `mobile/redesign`, cut from `main` at `b70a63c`. Every step is a pull request from
  `mobile/<step>` into `mobile/redesign`, never into `main`.
- **Checks:** CI runs lint, tests, build and the phone-width checks (`npm run check:phone` in `client/`) on
  every pull request into `mobile/redesign`.
- **Trying it on a phone:** Vercel builds a preview of `mobile/redesign` at its own address. The preview
  uses the production API and database through the same `/api` rewrite as the live site, so it shows real
  races; anything done there while signed in (following a car, starring a race) is real too. The redesign
  changes only the website, so no server or data changes ride on this branch.
- **Rollover:** one pull request from `mobile/redesign` into `main`, after the phone sign-off. Production
  changes only then.

## Phone-width checks

`client/e2e/phone-check.mjs` opens the landing page and every race tab at 320, 360, 375, 390 and 430 px
against a stand-in API (`client/e2e/mock-api.mjs`): the seeded WRL race from `server/prisma`, a signed-in
Team test user, and the Pit Stops analysis built by the app's own code. Nothing reaches a server or a
database. It prints what it measured (sideways scroll, chart top, lap panel top, small targets, widest
sideways scroller) and, with `--assert`, fails on the rules that must already hold. Each step adds the
rules it makes true.

```bash
cd client
npm run check:phone                                   # build, serve and check, as CI does
node e2e/phone-check.mjs --url http://localhost:5173  # check a running dev server
node e2e/phone-check.mjs --widths 375 --shots /tmp/s  # one width, with screenshots
```

## Chart gestures

The Position Trace and Lap Times charts take the gestures phones already teach in Photos and Maps
(`client/src/features/chart/chart-gestures.ts`). Only the laps zoom; positions stay put.

| Gesture | What it does |
| --- | --- |
| Pinch | Zoom the laps in or out, keeping the laps under your fingers in place (5 laps at most zoomed in, the whole race at most zoomed out) |
| Two-finger drag | Move along the race while pinching |
| Double-tap | Zoom in 3× on the tapped lap; double-tap again to see the whole race |
| Two-finger tap | Zoom out a step (2×) |
| Drag | Move along the race when zoomed in, reading each lap you pass; let go while moving and it glides to a stop |
| Tap | Pick a lap; the lap sheet rises once the tap is known not to be a double-tap (300 ms) |
| ‹ › | Step one lap (either end of the lap sheet's one-line peek; the old lap strip is gone on phones) |

The browser's own page zoom is off over the chart (`touch-action: none`), so a pinch zooms the chart, not
the page. No how-to text sits on the chart: the first chart a phone shows carries a one-time bubble
("Pinch or double-tap to zoom"), and the full list is in the race menu (⋯ → Chart gestures,
`ChartGestureHelp.tsx`). Zoom animations and the glide are skipped when the phone asks for reduced motion. The mouse
(wheel zoom, drag, double-click and drag to zoom to a stretch) is unchanged. The phone check runs
double-tap, pinch and tap with real touch events at every width.

## Race views row

On a phone the race views (Trace · Story · Pits · Laps · Gaps · Head-to-head · Strategy · Drivers) sit in one row that scrolls
sideways (`client/src/components/PhoneViewTabs.tsx`); there is no More menu. The edge with more views
fades out, the open view is kept in sight, and on a first visit, when the row is wider than the screen,
it glides to the end and back once (remembered in `localStorage`, skipped with reduced motion).

Gaps and Head-to-head are views of their own on a phone only (`PhoneAnalysisTab.tsx`): the car pill,
one line `‹ At lap 124 of 249 ›` (the race page's selected lap, shared with the charts; with none picked,
the last lap another car in the class also ran), and the panel filling the screen. A lap's "Gap
evolution" and "Head-to-head" links and a pass card's head-to-head open these views. Wider than a
phone they stay beside the chart, and `?tab=gaps|h2h` falls back to the trace.

## X axis on a phone

The Position Trace opens on race time on a phone (`phone-axis.ts`), with a small **Laps | Time** switch at
the right of the chart's caption line; a change is remembered on that phone (`localStorage`). Both axes
together stay in the car sheet. Laptops keep the Settings → Preferences chart default (laps unless changed).

## Phones held sideways

A phone held sideways (short and touch-only: under 500 px tall with a coarse pointer) is a phone, in
CSS and JS alike: `COMPACT_QUERY` in `client/src/lib/breakpoint.ts`, and every Tailwind screen in
`tailwind.config.js` needs the width and either a tablet's height or a mouse. So everything built for
phones (time axis, one-line lap sheet, views row, gestures, Pit cycle / Gaps / Head-to-head views)
applies both ways up. Sideways, the race page puts back, the views, the car pill and ⋯ in one 48 px row,
so the chart starts at 65 px on an 844×390 screen. The phone check runs 844×390 and 932×430 too.

## Pit cycle view

On a phone, Pit cycle is a view of its own (Trace · Story · Pits · Pit cycle · Laps · …), like Gaps and
Head-to-head: the line steps stop to stop (`‹ Stop 12 of 12 · lap 220 ›`), and the stops are cards,
the focus car's first, with a sort picker. "Open the pit cycle" in a lap's details opens it.

## Tables as cards (step 5)

On a phone, Pit Stops, Strategy and the Driver Report are lists of cards, never tables that scroll
sideways (`phone-cards.tsx`): class chips, a sort picker (the phone's own) with a direction button,
your car's cards pinned first, then the class in order. A card shows its row's numbers in a 3- or
4-across grid with the row's graphic full width (stint map, lap spread, time on track, each stop).
Tap a Pit Stops or Strategy card for its stops or stints as a list, with "View on the trace". Strategy
and the Driver Report follow the focus car's class. Every control on a race view is 44 px on a phone
(laptop sizes from `sm:` up), and search fields use 16 px text so iPhones don't zoom on focus.
