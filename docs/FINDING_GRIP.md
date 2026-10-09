# Finding Grip

Tire pressure and damper tools for race and track cars, by Tedder Engineering.
Finding Grip lives inside this app under `/grip` and shares RaceTrace's
accounts, login, Stripe customer and billing portal.

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
server/src/routes/grip.ts                       /api/grip/* (access gate, validation, limits)
server/src/services/grip/calc.ts                generic calculation engine
server/src/services/grip/damper.ts              damper lookup + import validation
server/src/services/grip/account.ts             plan rules, free allowance
server/src/services/grip/billing.ts             Stripe checkout/portal/webhook sync
client/src/features/grip/                       shell, API client, units, components
client/src/pages/grip/                          pages
```

Existing files touched: `server/src/app.ts` (mount router),
`server/src/config/env.ts` (four optional settings),
`server/src/services/billing.ts` (route Finding Grip webhooks),
`client/src/App.tsx` (routes), `client/src/lib/api.ts` (text responses, error
payload), `client/tailwind.config.ts` (accent colour), and the login /
onboarding / auth layout (return visitors to the tool they came from).

## Rules the server enforces

- Every query is scoped to the signed-in user.
- Calculations need a verified email address (admins excepted), and in
  `testers` mode so does access itself.
- Free accounts get 3 calculations for life (`grip_accounts.calc_count`;
  deleting a calculation does not give one back). The next returns
  `403 { code: "UPGRADE_REQUIRED", upgrade_required: true }`.
- The damper tool requires Finding Grip Pro (admins always have access).
- A reference session needs all four hot pressures before it can be
  calculated from (`422 REFERENCE_INCOMPLETE`).
- Pressures are PSI and temperatures °F in the API and database. The client
  converts for display.
- A RaceTrace subscription does not unlock Finding Grip and the reverse.
  Finding Grip's plan is stored in `grip_accounts`; RaceTrace's stays in
  `subscriptions`. Stripe webhooks are routed by price / metadata, and
  Finding Grip state is always re-read from Stripe rather than taken from one
  event (`services/__tests__/grip.billing.test.ts`).

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

- Terms of Service and Privacy Policy still describe RaceTrace only.
- The price label on `/grip/pricing` (`PRO_PRICE_PER_YEAR` in
  `client/src/pages/grip/GripPublicPages.tsx`).
- A `findinggrip.tedderengineering.com` domain pointing at `/grip`.
- Track logos (tracks show their short code until `logoUrl` is set).

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
