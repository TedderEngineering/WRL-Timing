# Finding Grip

Tire pressure and damper tools for race and track cars, by Tedder Engineering.
Finding Grip is part of this app: it is served at
`https://findinggrip.tedderengineering.com` (and under `/grip` on RaceTrace,
which forwards there once `GRIP_PUBLIC_URL` is set). It shares RaceTrace's
accounts, login, Stripe account and support (coffee) code. It is free:
`GRIP_PRICING` is unset, so every account gets every tool.

## Confidential data never goes in this repository

Two things are proprietary to Tedder Engineering and are deliberately absent
from the code:

| What | Where it lives | How it gets there |
|---|---|---|
| The cold tire pressure calculation (which inputs, which weights) | `GRIP_CALC_MODEL` environment variable on the server | Set in the host's environment settings |
| The damper tuning table (96 scenarios) | `grip_damper_scenarios` database table | Uploaded once on `/grip/admin` from a private JSON file |

`server/src/services/grip/calc.ts` is a generic evaluator: base value plus
weighted differences between named inputs, with an optional wet blend. It
contains no coefficients. Tests use invented models. Do not add real numbers
to code, tests, fixtures, comments, commit messages or issues.

The damper table has row level security enabled with no policies, so it cannot
be read through Supabase's public API; only the server reads it.

## Layout

```
server/prisma/schema.prisma                     Grip* models (grip_* tables)
server/prisma/migrations/20261009000000_add_finding_grip/
server/prisma/migrations/20261015000000_grip_calculation_outcomes/   measured hot pressures
server/src/routes/grip.ts                       /api/grip/* (access gate, validation, limits)
server/src/services/grip/calc.ts                generic calculation engine
server/src/services/grip/damper.ts              damper lookup + import validation
server/src/services/grip/account.ts             plan rules, free allowance
server/src/services/grip/billing.ts             Stripe checkout/portal/webhook sync
server/src/services/grip/outcome.ts             on target, accuracy over time, season recap
client/src/features/grip/                       shell, API client, units, components
  outcome.tsx                                   verdict wording, "How did it come in?" items
  progress.tsx                                  dashboard "Your accuracy", result-page line
  season.tsx                                    season recap card and image
  engagement.tsx                                first-weekend checklist, install hint
  pressureCard.tsx                              share image of a result
client/src/pages/grip/                          pages
client/grip.html, client/public/grip.webmanifest   Finding Grip's page shell and app manifest
```

Shared with RaceTrace (change with care, tell the RaceTrace side):
`client/src/features/support/` and `server/src/support/` (coffee),
`client/src/features/share/` (share-card template, share-a-link helper),
`client/src/lib/install.ts` (add-to-home-screen), `client/src/lib/analytics.ts`,
and the account, terms and privacy pages.

Existing files touched: `server/src/app.ts` (mount router),
`server/src/config/env.ts` (four optional settings),
`server/src/services/billing.ts` (route Finding Grip webhooks),
`client/src/App.tsx` (routes), `client/src/lib/api.ts` (text responses, error
payload), `client/tailwind.config.ts` (accent colour), and the login /
onboarding / auth layout (return visitors to the tool they came from).

## Rules the server enforces

- Every query is scoped to the signed-in user.
- A saved calculation can be reopened (`/calculate?calc=<id>` on the client) and
  re-run in place with `PUT /api/grip/calculations/:id`. That is a fresh run of
  the model, so it is rate-limited and counted like a new calculation.
- Every Finding Grip route except `GET /status` needs a verified email address
  (admins excepted). The check is in `requireGripAccess`; an unverified account
  gets `403 EMAIL_NOT_VERIFIED` and the client shows a "verify your email"
  screen with a resend button in place of the app.
- Only when `GRIP_PRICING=paid`: free accounts get 3 calculations for life
  (`grip_accounts.calc_count`; deleting a calculation does not give one back),
  the next returns `403 { code: "UPGRADE_REQUIRED", upgrade_required: true }`,
  and the damper tool requires Finding Grip Pro (admins always have access).
  While free (the default) neither limit applies.
- A reference session needs all four hot pressures before it can be
  calculated from (`422 REFERENCE_INCOMPLETE`).
- Pressures are PSI and temperatures °F in the API and database. The client
  converts for display.
- A RaceTrace subscription does not unlock Finding Grip and the reverse.
  Finding Grip's plan is stored in `grip_accounts`; RaceTrace's stays in
  `subscriptions`. Stripe webhooks are routed by price / metadata, and
  Finding Grip state is always re-read from Stripe rather than taken from one
  event (`services/__tests__/grip.billing.test.ts`).

## After the run: outcomes, accuracy, season

The driver records the hot pressures measured after a run. The server compares
them with the calculation's hot targets; a run is **on target** when every
corner is within 0.5 PSI (`ON_TARGET_PSI` in `services/grip/outcome.ts`). All
of this is the driver's own data only: nothing is compared with other drivers.

| Route | What it does |
|---|---|
| `POST /calculations/:id/outcome` | `{ hot, saveAsReference?, referenceName?, notes? }`. Stores the measured hot pressures (`actual_hot_*`, `outcome_at`), returns the comparison; optionally saves the run as a reference session (cold = what was set, hot = what was measured). Recording again corrects it and never makes a second reference. |
| `POST /calculations/:id/skip-outcome` | "Didn't run it": `outcome_skipped`, so the dashboard stops asking. |
| `POST /calculations/:id/convert` | Older convert route; also records the outcome. |
| `GET /progress` | Last 10 recorded runs (on target, average worst-corner miss, one entry per run oldest first), the latest 5 against the 5 before once there are 6, and each track. |
| `GET /season?year=` | One calendar year: calculations, reference sessions, track days, tracks, recorded and on-target runs, the closest run, first and last day. |
| `GET /export` | CSV, now including measured hot pressures. |

Where it shows:

- Dashboard: "How did it come in?" for calculations from the last 14 days
  without an outcome; "Your accuracy" once a run is recorded; the season
  recap card from 20 November to 31 January (January shows the year before;
  `?season=YYYY` shows it any time for checking).
- Result page: the verdict as a fact ("Came in 0.8 PSI high on the right
  front"), and "On target in 6 of your last 10 recorded runs. At VIR: 4 of 7."
  from the second recorded run.
- Share: a result or the season as a 1080×1350 image (shared template).

Wording rules (shared with RaceTrace): state facts the data supports; no
praise, no streaks, no ranking against other drivers, no guilt wording.

The coffee ask (shared support code, usual caps: one ask per 30 days, none for
365 days after a payment, "Not now" counts) appears only right after a run is
recorded on target, and at the end of the opened season recap.

Analytics events (anonymous, `client/src/lib/analytics.ts`, off unless
`VITE_POSTHOG_KEY` is set): `record_hot`, `on_target`, `checklist_step`,
`share_card`, `share_app`, `share_arrival`, `coffee_open`, `coffee_paid`.

"Share Finding Grip" (menu, footer, Settings, under the dashboard's free card;
never a pop-up) sends the site's link through the phone's share sheet, or copies
it on a computer (`features/grip/shareApp.tsx`, using the shared
`features/share/shareLink.ts`). The link carries `?from=share`, the same for
everyone; a visit with it sends `share_arrival { landing }` and the tag is
removed from the address bar. Link previews use `client/public/grip-og.png`
(1200×630) through the `og:` and `twitter:` tags in `client/grip.html`. Per-browser memory (hidden cards,
install hint) is the `findinggrip.ui.v1` localStorage key.

## Cars (the shared My cars list)

Finding Grip uses RaceTrace's car list (`user_cars`, `/api/me/cars`, rules in
`server/src/services/my-cars.ts`): one list per account on every site. A car is
a race car (`imsa`, `sro`, `wrl`) or a track-day / club car (`other`, never
matched to a race).

- A reference session can have a car (`user_car_id`, optional; migration
  `20261016020000_grip_user_cars`). The server checks it is the user's own
  (`400 INVALID_CAR`). An edit that leaves `userCarId` out keeps the car.
- A calculation takes its reference session's car. Changing a session's car
  moves the calculations made from it. A run saved as a reference keeps it.
- Removing a car clears the link (`ON DELETE SET NULL`); sessions and
  calculations stay.
- `GET /progress` adds `cars` (on target, average worst-corner miss, last
  date per car); the dashboard shows "By car" from two cars. The CSV export
  has a `car` column.
- UI: `client/src/features/grip/cars.tsx`: the optional Car picker on the
  session form with "+ Add a car", and My cars in Settings. Adding a car sends
  `follow_car { series, source }` with `grip_session_form` or `grip_settings`.

## Settings

| Variable | Purpose | Default |
|---|---|---|
| `GRIP_ACCESS` | `off`, `admin`, `testers` or `public` | `admin` |
| `GRIP_TESTER_EMAILS` | Comma-separated emails for `testers` mode | empty |
| `GRIP_PUBLIC_URL` | Finding Grip's own address, e.g. `https://findinggrip.tedderengineering.com`. When set, `/grip` on RaceTrace forwards there and account emails sent from that site carry the Finding Grip name and links. A mistyped value is ignored and reported on `/grip/admin`, never fatal | unset: served under `/grip` on RaceTrace |
| `GRIP_PRICING` | `free`: every account gets every tool with no limits, and the pricing and upgrade screens are hidden. `paid`: Free and Pro plans with Stripe checkout | `free` |
| `GRIP_CALC_MODEL` | Calculation model (confidential): the JSON itself, or base64 of it if the host mangles quotes | unset: calculator returns 503 |
| `STRIPE_GRIP_PRO_PRICE_ID` | Stripe price id(s) for Pro (only used when `GRIP_PRICING=paid`), comma-separated; the first is sold | unset: checkout returns 503 |

### Calculation model shape

```jsonc
{
  "version": "any label",          // shown on /grip/admin
  "base": "refCold",               // starting value
  "terms": [                       // each adds weight × (plus − minus)
    { "weight": 0, "plus": "targetHot", "minus": "refHot" }
  ],
  "durationCap": 45,               // optional: cap both durations (minutes)
  "wetBlend": 0,                   // optional: wet = dry + wetBlend × (wetToward − dry)
  "wetToward": "targetHot",
  "decimals": 1
}
```

Available inputs, per corner: `refCold`, `refHot`, `targetHot`, `refTrackTemp`,
`trackTemp`, `refAmbientTemp`, `ambientTemp`, `refWheelTemp`, `wheelTemp`,
`refDuration`, `duration`.

### Damper table file shape

```jsonc
{ "scenarios": [
  { "scenarioNumber": 1, "adjustmentType": "rebound_only", "turnDirection": "left",
    "overUnder": "oversteer", "cornerSegment": "braking", "cornerSpeed": "low",
    "option1": "…", "option2": null, "option3": null }
  // … 96 rows, every input combination exactly once
] }
```

## Turning it on

1. Apply the migration **first**: `cd server && npx prisma migrate deploy`.
   It only adds new enums and `grip_*` tables and seeds a starter track list,
   so it is safe to run while the current version is live. Deploying the code
   before the tables exist would make Stripe invoice webhooks fail until the
   migration runs (they now look in `grip_accounts`).
2. Deploy this branch (server and client).
3. On the server host set `GRIP_CALC_MODEL`. Leave `GRIP_ACCESS` unset to
   keep it admin-only.
4. Sign in as an admin, open `/grip/admin`, and load the damper table file.
   The Setup panel shows what is still missing.
5. When ready to sell Pro: create the product and annual price in Stripe and
   set `STRIPE_GRIP_PRO_PRICE_ID` **before anyone can buy at that price**. A
   subscription at a price the server does not recognise is treated as
   RaceTrace Pro by the existing RaceTrace code. For the same reason:
   - sell Finding Grip only through the app's checkout (it tags the
     subscription with `product: FINDING_GRIP`), not Payment Links;
   - if a second price is added later, list both ids, comma-separated;
   - in the Stripe customer portal settings, do not allow switching between
     RaceTrace and Finding Grip products.
   The existing webhook endpoint handles the events. Keep its API version at
   or below the SDK's pinned version (`server/src/lib/stripe.ts`).
6. Open it up with `GRIP_ACCESS=testers` (plus `GRIP_TESTER_EMAILS`) and later
   `public`.

## Not done yet

- Terms of Service and Privacy Policy: Finding Grip wording drafted, awaiting
  decisions and a legal read; the Terms still carry RaceTrace's
  subscription section.
- Cars: once the shared `user_cars` list exists, reference sessions and
  calculations get a nullable `carId` (on delete SET NULL) and accuracy is
  split by car.
- Opt-in email reminder to record hot pressures, through the shared alerts
  preferences.
- Track logos (tracks show their short code until `logoUrl` is set).
- Only if Pro is ever sold: the price label on `/pricing`
  (`PRO_PRICE_PER_YEAR` in `client/src/pages/grip/GripPublicPages.tsx`).

## Its own address

The same build serves both sites. `client/src/lib/site.ts` decides which one
from the hostname: anything starting with `findinggrip.` is the Finding Grip
site (use `http://findinggrip.localhost:5173` in development).

- On the Finding Grip site the app mounts only Finding Grip, at clean paths
  (`/dashboard`, `/sessions`, ...), plus the shared account pages (`/login`,
  `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/account`,
  `/terms`, `/privacy`) inside the Finding Grip shell. RaceTrace pages do not
  exist there. Links inside Finding Grip are written with `gp("/dashboard")`
  so they work on either site.
- The accent colour (`brand-*` in Tailwind) is a set of CSS variables in
  `styles/globals.css`; `html.grip-site` swaps RaceTrace blue for Finding Grip
  orange, so the shared forms match the site they are on.
- `client/grip.html` is a second HTML shell with Finding Grip's title, icon and
  link-preview tags. `vercel.json` serves it for the Finding Grip hostname and
  `racetrace.html` (the built `index.html`, renamed by the build command so the
  host rule can apply to `/`) for everything else.
- Sessions are per address: the refresh cookie is host-only, so someone signed
  in on RaceTrace signs in once more on the Finding Grip site with the same
  account.

To put it on a new address: add the domain to the Vercel project, point DNS at
Vercel, confirm the site loads there, then set `GRIP_PUBLIC_URL` on the server.
