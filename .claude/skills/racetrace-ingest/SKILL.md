---
name: racetrace-ingest
description: Pull new or changed race sessions from the timing sites (IMSA results site, SRO America results page, RedMist for WRL from 2026, Speedhive for 2025 WRL), import each raw race into RaceTrace as a draft through the intake API, then build the fact package, run rule checks, write the stories class by class, validate, and upload the analysis package as a draft. Use when the owner asks to ingest, pull, import or update races (e.g. "/racetrace-ingest imsa-mpc 2026", "pull this weekend's GT4 races", "official results are out for Road Atlanta"). Never publishes.
argument-hint: "[--series imsa-mpc,sro-gt4,sro-grcup,wrl,wrl-speedhive] [--season 2026] [--since YYYY-MM-DD] [--yes] [--raw-only] [<sourceKey>…]"
---

# /racetrace-ingest (G4, draft 1.0)

You run the race intake on the owner's machine. **Code fetches, parses and computes; you choose, check and write words.** Every race you touch ends as a **draft**. You never publish, never set `status: published`, and never pass `--force` unless the owner asked for it in this conversation.

All commands run from the repo's `server/` folder. `intake` below means `npx tsx scripts/intake.ts`.

## 0. Scripts this skill calls

| Step | Command | Comes from | If missing |
|---|---|---|---|
| Preflight, discover, pull, push, status | `intake preflight`, `intake discover`, `intake pull`, `intake push`, `intake status` | **G4** (this branch) | — (required) |
| Which steps exist | `intake steps` (`--json`) | G4 | — |
| Facts | `intake facts <dir>` → wraps `scripts/build-facts.ts` | **G2** (fact engine) | exit 3 "SKIPPED": stop after step 5 for that race |
| Rule checks | `npx tsx scripts/run-rule-checks.ts …` (read its `--help` first) | **G3** | continue without `ruleChecks`; say so in the report |
| Digest, merge | `scripts/build-analysis-input.ts`, `scripts/merge-analysis.ts` | Stage 3 (analysis tooling) | stop after facts; the raw race stays a draft |
| Validate | `intake validate <draft.json> --base <facts.base.json> [--scope-class <id>]` → wraps `src/analysis/validate-package.ts` | **G2** | do not upload any package |
| Package upload | `scripts/upload-package.ts` or the endpoint its `--help` names, **as draft** | **G5** (package ingest) | stop after validate; keep `draft.json` locally |

**Graceful degradation.** Steps 1–5 alone are a complete, useful run: the raw files are archived and the race appears as a draft with the legacy charts. A missing later step never undoes them. Exit code 3 from `intake` means "this step is not on this branch": record it and move on.

If `.claude/skills/analyze-race/SKILL.md` exists in this checkout, follow it for steps 8–9; it takes precedence over §3 below.

## 1. Procedure

1. **Preflight.** Run `intake preflight`. It checks `RACETRACE_API_URL` and `RACETRACE_API_TOKEN` (set, never printed), that `/api/health` answers, and that the token is valid with the `intake` scope (`GET /api/admin/intake/whoami`). Then run `intake steps`. If `src/analysis` exists, run `npx vitest run src/analysis src/intake`; otherwise run `npx vitest run src/intake`. Stop on any failure and show the owner the failing line. Never echo, log or paste the token.
2. **Discover.** Run `intake discover --series <ids> --season <year> [--since <date>]`. Default series: `imsa-mpc,sro-gt4,sro-grcup,wrl`; the current year; `--since` = 14 days ago. The command compares the sites with `GET /api/admin/intake/races` and saves `intake-work/discover-latest.json`. States:
   - `new`: not on RaceTrace yet;
   - `changed`: files on the site changed since the last intake;
   - `results-upgrade`: the site now has better results (official over provisional);
   - `unchanged`: skip.

   **WRL** (`wrl`) comes from RedMist (redmist.racing): every WRL event RedMist lists, or one event with `--redmist <event id>` (`--redmist 405/3` for one session). Only sessions that have ended and have lap data are listed; RedMist paces itself to one request per 1.6 s, so a full WRL season takes a few minutes. RedMist has no lap history for 2025: for 2025 races use `wrl-speedhive`, which needs `SPEEDHIVE_WRL_ORG_ID` or `--speedhive <event or session URL>`.

   **Races already on the site.** Races imported by hand before the intake have no source key, so discovery lists their sessions as `new`. When the site has a race of the same series within a day, the last column (`ON SITE WITHOUT KEY?`) names it. Do not push such a session on your own: a plain push would create a second race. Show the owner the pair and ask, per race, whether to **attach** (replace the old race's chart with this import, keeping its id, URL, name and status, and give it the source key) or to skip. Attach only on the owner's answer, with `intake push <dir> --attach <raceId>`. The server refuses an attach when the race already has a source key (`ATTACH_KEYED`), or when its series or date do not match (`ATTACH_MISMATCH`; only the owner may say to add `--force`).
3. **Confirm.** Show the owner the `new`, `changed` and `results-upgrade` rows (date, series, event, session, results status). Ask which to process. With `--yes`, take all of them. With explicit source keys as arguments, take exactly those.
4. **Pull.** Run `intake pull --from ../intake-work/discover-latest.json` (or `intake pull '<sourceKey>' …`). For each folder, read the printed `missing:` and `warning:` lines:
   - **Provisional results**: fine. Note them; a later run picks up the official results (`results-upgrade`).
   - **No results file at all**: tell the owner. Finishing order comes only from results (D-FINISH).
   - **WRL from RedMist without a pit report** (`missing: No Flagtronics pit report…`): normal before Road Atlanta 2026. Pit stops then come from RedMist's pit-lane lap flags, without pit-in / pit-out times. Say so in the report.
   - **WRL from Speedhive (2025) without Redmist flags or control log**: optional. Ask once whether the owner has Redmist exports to drop into the folder; if not, continue (FCY is reconstructed from lap status).
   - **A failed file**: rerun pull once; if it still fails, report it and continue with the others.
5. **Push the raw race.** Run `intake push <dir> …`. The server archives every file before any database write, runs the legacy parser so the current charts work, and creates the race as a **draft**, or updates the existing race with the same source key (same id and URL; the owner's name, status and premium flag are kept). Results:
   - `created`, `updated`, `unchanged`, `attached`: continue;
   - `409 RESULTS_DOWNGRADE`: the site has better results than this pull. Skip the race and report it. Never add `--force` on your own;
   - `502 ARCHIVE_FAILED`: nothing was saved. Report it and stop for that race;
   - `400 PARSE_FAILED` / `INVALID_RACE_DATA`: report the message; do not edit the files.
6. **Facts.** Run `intake facts <dir>`. It writes `analysis-runs/<packageId>/facts.json`. If the engine reports a `blocker` in `dataQuality`, stop that race and report the blocker codes. Do not write stories over a blocked import.
7. **Rule checks.** If G3's script exists, run it on `facts.json` with the rulebooks in `rules/`. Note every check that is `fail` or `unknown`.
8. **Stories, class by class** (§3). Run build-analysis-input to make the digest. For each class, write `patches/<class>[.<part>].json` (≤ 12 cars per part), then `patches/race.json`. If subagents are available, give each class to one subagent (at most 3 at a time) with its class digest, `race-context.json` and this skill.
9. **Validate, fixing until clean.** Merge the patches (merge-analysis), then run `intake validate analysis-runs/<packageId>/draft.json --base analysis-runs/<packageId>/facts.base.json`. Read every error, fix the **patch** (never the facts), merge and validate again. After 3 failing rounds, stop that race and report the remaining errors with their story ids.
10. **Upload the package as a draft** (G5). Never publish.
11. **Report** (§4).

`--raw-only`: stop after step 5 for every race.

## 2. Rules for the whole run

- One race at a time through steps 4–10; a failure in one race never stops the others.
- Never edit downloaded files, `manifest.json`, `facts.json`, `facts.base.json`, rulebooks, schemas or scripts to get past an error. Report it.
- Never invent a race date, result, class or rule value. Unknown stays unknown.
- Source keys contain spaces: quote them (`'imsa:26_2026/21_Road Atlanta/…'` in PowerShell).
- The timing sites are third-party. `intake` already paces requests (one at a time, 500 ms apart, retries with backoff). Do not run several pulls in parallel.

## 3. Writing the analysis (from /analyze-race draft 0.1.0)

The validator (`validate-package`, rules V1–V8 and A1–A20; banned phrases in `server/src/analysis/schema/prose-rules.json`) rejects any package whose words disagree with its numbers. Write so it passes the first time.

**Patch format** `analysis-patch/1`: keys `patchFormat`, `packageId`, `basedOn` (`engineVersion`, `generatedAt` of the facts), `scope` (`{kind: "class", class}` or `{kind: "race"}`), `carStories`, `ruleFindings`, `raceSummary` (race scope only), `factJudgements`, `notes`. Nothing else.

**Evidence rule.**
- Every number is a placeholder `{n}` with `refs[n] = {value, factId, field, unit}`: positions, laps, times, counts, gaps. Copy `factId` from the digest row and `field` from the column header.
- Cars `{car:<id>}`, classes `{class:<id>}`, drivers `{driver:<car>:<n>}`. Car ids are strings: `007` ≠ `7`.
- No digit may remain in the text after removing tokens and lexicon terms. No number words ("two", "second", "half", "twice"); allowed: one, first, last, both, once, a lap.
- Seconds at full precision as in the fact (`110.554`, never `110.6`). No unit after a time placeholder ("{3} in the pit lane", not "{3} s"). Positions as "{0} in class", never "P{0}".
- A sentence citing a class position says "class" or has a `{class:…}` token; one citing an overall position says "overall".
- Race-control reasons and statuses are quoted refs with `unit: "text"`, verbatim.
- If `resultsStatus` is `provisional`, any story or summary citing a finishing position says "provisional".
- Signed values (`netClass`, `deltaToCycleMeanS`): `transform: "abs"` and the direction in words.

**Banned** (A10): counterfactuals (would, could have, but for, otherwise, potential); blame (fault, mistake, error, took out); intent (chose to, decided to, strategy, undercut, to avoid); cause speculation (mechanical, engine, damage, contact, incident, problem, due to, because of); rule strength above "possible" (violated, breach, illegal, clearly, likely, proves); tone (unfortunately, lucky, dominant, costly, "!"); terminology (pit loss, pit time, pit road, settled, avg, unofficial, preliminary; "fastest lap" only in the summary).

**Car stories**: one per entry, DNS and retirements included. `id` = `story:<car>`; the headline contains `{car:<car>}`. Order: start and first stint → each stop and class pit cycle (before → after in class, time lost, rank or delta in the cycle) → penalties → on-track changes worth naming → finish (class, overall, laps, provisional) or retirement. Limits: headline ≤ 35 words; sprint (≤ 2 h) 1–4 paragraphs, ≤ 260 words; endurance 1–6 paragraphs, ≤ 420 words; DNS exactly one paragraph ≤ 60 words. `keyFactIds` include `result:<car>`, `ret:<car>`, every `pen:<car>:*` and every non-`stop` passage; the story cites `result:<car>`. Retirements: last completed lap, class position at retirement, results classification, and no reason the facts do not contain. Comparisons only through facts (rank of `nMembers`, delta to the cycle mean); never add or subtract numbers yourself.

**Rule findings**: one per check with status `fail` or `unknown`. Assessment: `pass` → `compliant`; `fail` with official action → `penalised_consistent` or `data_insufficient`; `fail` without → `possible_unpenalised` (the statement says "possible") or `data_insufficient`; `unknown` → `data_insufficient` or `not_assessable`. ≤ 60 words; name "race control" when it acted. Never state a rulebook value that is `TBD` or an inferred threshold.

**Race summary** (`patches/race.json`): headline ≤ 30 words citing the overall winner's `result`; 1–2 paragraphs, 2–4 sentences, ≤ 110 words; one class summary per class citing the class winner's `result`; key moments (4–6 sprint, 4–8 endurance) in lap order.

**Judgements**: `factJudgements` may only lower confidence or add a `judgement_*` note, always with written reasoning (story `lowConfidenceJudgements` or finding `judgementOnLowConfidence`, ≤ 50 words). Citing a `low` fact needs a judgement. Never "correct" a value.

**Stop and ask the owner** when: a `blocker` is in `dataQuality`; two facts contradict each other; a value looks wrong against the source (give the fact id); a class has a car with no laps and no result; validation still fails after 3 rounds.

## 4. Report to the owner

End with one table and at most 5 lines of notes:

| Race | Source key | Action | Results | Warnings | Facts | Rule checks | Validator | Package | Review |
|---|---|---|---|---|---|---|---|---|---|
| Michelin Pilot Challenge Race — Road Atlanta | `imsa:26_2026/…/202610021140_Race` | updated | official | 2 | ok | 3 unknown | PASS | draft uploaded | `<site>/races/<raceId>` · `analysis-runs/<packageId>/REVIEW.md` |

- **Action** is the push result (`created`/`updated`/`unchanged`/error code). **Review** links the draft race page (`RACETRACE_API_URL`'s site host + `/races/<raceId>`, from `intake-work/<slug>/intake-result.json`) and the admin races page (`/admin/races`).
- Name every skipped step and why (for example "build-facts not on this branch (G2)").
- List provisional races; they will show up as `results-upgrade` when official results are published.
- Remind the owner that drafts are invisible to users until they publish them from the admin page.

## 5. Windows setup (PowerShell, once per laptop)

```powershell
# 1. Tools: Node 20+ and Git
winget install OpenJS.NodeJS.LTS
winget install Git.Git
git config --global core.longpaths true      # long Alkamel file names inside the work folder

# 2. Repo and dependencies (a short path keeps file paths well under 260 characters)
cd C:\src
git clone https://github.com/TedderEngineering/WRL-Timing.git
cd WRL-Timing\server
npm ci

# 3. Intake settings (git-ignored)
Copy-Item .env.intake.example .env.intake
notepad .env.intake
```

4. **Create the token.** Sign in to RaceTrace as an admin → **Admin → API Tokens** → name it (for example "Laptop intake"), choose an expiry → **Create token** → **Copy**. Paste it into `.env.intake` as `RACETRACE_API_TOKEN=rt_…`. It is shown once; if lost, revoke it and create another. Set `RACETRACE_API_URL` to the API host.
5. **WRL organisation id on Speedhive** (once; only for 2025 WRL races):
   ```powershell
   npx tsx scripts/intake.ts speedhive-org --from-session https://speedhive.mylaps.com/sessions/<any WRL race session id>
   ```
   Put the printed id in `.env.intake` as `SPEEDHIVE_WRL_ORG_ID=…`.
6. **Check**: `npx tsx scripts/intake.ts preflight` must show `yes` for the URL, token, health and token-scope rows.

Work folders go to `intake-work\` at the repo root (`INTAKE_WORK_DIR` to move them, for example `C:\RaceTrace\intake-work`). Analysis runs go to `analysis-runs\`. Both are git-ignored.

## 6. Reference

| Item | Value |
|---|---|
| Source keys | `imsa:<season>/<event>/<championship>/<session folder>` · `sro:<site series>/<season>/<event>/<sub-series>/<session folder>` · `redmist:event:<id>/session:<id>` · `speedhive:session:<id>` |
| Series ids | `imsa-mpc`, `imsa-wtsc`, `imsa-endurance`, `imsa-vprc`, `imsa-mx5`, `imsa-pccna`, `imsa-lst`, `imsa-mustang`, `imsa-*`; `sro-gt4`, `sro-grcup`, `sro-gtwca`, `sro-gta`, `sro-tca`, `sro-mclaren`, `sro-*`; `wrl` (RedMist), `wrl-speedhive` (2025) |
| WRL work folder | `redmist_<event>_<session>_{laps,pits,results,flags,control}.json` (raw, for the fact engine, format `redmist`) and `…_{summary,all_laps,flags,control}.csv` (Speedhive-format, for the chart). Crossing time = race-clock start (results `localTimeOfDay − runningRaceTime`) + total time |
| Work folder | `intake-work/<slug>/`: original file names, `manifest.json` (URL, sha256, size, fetch time, role, API key per file), `intake-result.json` after push |
| API | `GET /api/admin/intake/whoami`, `GET /api/admin/intake/races` (`?unkeyed=1&series=&season=` for races without a source key), `POST /api/admin/intake/races` (`attachToRaceId` for an owner-approved attach) (token scope `intake`) |
| Results | official › provisional › unofficial › unmarked; the server refuses a downgrade (409) |
