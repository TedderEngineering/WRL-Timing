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
  `subscriptions`. Stripe webhooks are routed by price / metadata
  (`services/__tests__/grip.billing.test.ts`).

## Settings

| Variable | Purpose | Default |
|---|---|---|
| `GRIP_ACCESS` | `off`, `admin`, `testers` or `public` | `admin` |
| `GRIP_TESTER_EMAILS` | Comma-separated emails for `testers` mode | empty |
| `GRIP_CALC_MODEL` | Calculation model JSON (confidential) | unset: calculator returns 503 |
| `STRIPE_GRIP_PRO_PRICE_ID` | Stripe price for Pro | unset: checkout returns 503 |

### Calculation model shape

```jsonc
{
  "version": "any label",          // shown on /grip/admin
  "base": "refCold",               // starting value
  "terms": [                       // each adds weight × (plus − minus)
    { "weight": 0, "plus": "targetHot", "minus": "refHot" }
  ],
  "durationCap": 60,               // optional: cap both durations (minutes)
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

1. Deploy this branch (server and client).
2. Apply the migration: `cd server && npx prisma migrate deploy`. It only adds
   new enums and `grip_*` tables and seeds a starter track list.
3. On the server host set `GRIP_CALC_MODEL`. Leave `GRIP_ACCESS` unset to
   keep it admin-only.
4. Sign in as an admin, open `/grip/admin`, and load the damper table file.
   The Setup panel shows what is still missing.
5. When ready to sell Pro: create the product and annual price in Stripe and
   set `STRIPE_GRIP_PRO_PRICE_ID`. The existing webhook endpoint handles it.
6. Open it up with `GRIP_ACCESS=testers` (plus `GRIP_TESTER_EMAILS`) and later
   `public`.

## Not done yet

- Terms of Service and Privacy Policy still describe RaceTrace only.
- The price label on `/grip/pricing` (`PRO_PRICE_PER_YEAR` in
  `client/src/pages/grip/GripPublicPages.tsx`).
- A `findinggrip.tedderengineering.com` domain pointing at `/grip`.
- Track logos (tracks show their short code until `logoUrl` is set).
