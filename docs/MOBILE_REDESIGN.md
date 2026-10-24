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
