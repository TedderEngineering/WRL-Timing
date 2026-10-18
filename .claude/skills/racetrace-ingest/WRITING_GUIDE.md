# Writing race stories for RaceTrace (one class, as a patch)

You write the words; code fetched, parsed and computed every number. Your job: one JSON patch for one class of one race, which passes the validator. Never edit the package, the digest or any script.

## Inputs (paths given in your task)

- `<run>/package.json`: the facts package (read-only; the validator reads it).
- `<run>/digest/race.md`: race context (classes, winners, cautions, data notes, lexicon).
- `<run>/digest/<class>.md`: every fact of your class, one line per fact: `<factId> field=value …`. Seconds show as `102.336s (1:42.336)`.

## Output

Write `<run>/patches/<class>.json` (or `<class>.1.json`, `<class>.2.json` when the class has more than 12 cars; same format, each with its share of cars). Then run, from `/home/claude/tedderengineering/wrl-timing/server`:

```
npx tsx scripts/analysis.ts check <run>/package.json <run>/patches/<file>.json
```

Fix the patch until it prints `PASS` (when a class is split in parts, the only error allowed is A13 "cars without a story" naming the other part's cars). After 4 failing rounds, stop and report the remaining errors.

## Patch format (`analysis-patch/1`)

```json
{
  "patchFormat": "analysis-patch/1",
  "basedOn": { "generatedAt": "<generatedAt from race.md>" },
  "scope": { "kind": "class", "class": "<class id>" },
  "carStories": [
    {
      "id": "story:68",
      "car": "68",
      "headline": { "text": "{car:68} won {class:Silver} on the provisional results after pitting on lap {0}.", "refs": [ { "factId": "pit:68:1", "field": "inLap" } ] },
      "paragraphs": [
        { "text": "{driver:68:1} started and pitted on lap {0}, handing over to {driver:68:2}. The stop took {1} in the pit lane.", "refs": [ { "factId": "pit:68:1", "field": "inLap" }, { "factId": "pit:68:1", "field": "officialPitLaneTimeS" } ] },
        { "text": "{car:68} finished {0} in class and {1} overall on the provisional results, completing {2} laps.", "refs": [ { "factId": "result:68", "field": "positionClass" }, { "factId": "result:68", "field": "positionOverall" }, { "factId": "result:68", "field": "laps" } ] }
      ],
      "keyFactIds": ["result:68", "pit:68:1", "cycres:Silver:1:68"]
    }
  ],
  "ruleFindings": []
}
```

**Refs:** give only `factId` and `field` (the field name exactly as in the digest line, e.g. `timeLost.valueS`, `classPosBefore`, `stats.nMembers`). The merge fills value, unit and display. For a signed value (`netClass`, `deltaToCycleMeanS`) add `"transform": "abs"` and say the direction in words (gained / lost, less / more than the cycle mean). `{n}` in the text is `refs[n]`, counting from 0 within that one text.

## Hard rules (the validator rejects the patch otherwise)

- **No digits** in the text except inside tokens: every number is a `{n}` ref. Car `{car:68}`, class `{class:Silver}`, driver `{driver:68:2}` (numbers from the digest). Lexicon terms (in race.md) may appear as written.
- **No number words**: not two, three, second, third, half, twice, double, dozen… Allowed: one, first, last, both, once, a lap. For ranks write "ranked {0} of {1} for time lost in the class cycle" citing `cycres:…timeLostRank` and `cycle:…stats.nMembers`.
- A sentence citing a class position must contain the word "class" (or a `{class:…}` token); one citing an overall position must contain "overall".
- Positions: "{0} in class", never "P{0}". Times: "{0} in the pit lane", never "{0} s" or "{0} seconds".
- **Provisional results** (see race.md): every story or summary that cites a finishing position says "provisional" (e.g. "on the provisional results").
- **Banned words** (any form): would, could have, might have, should have, otherwise, but for, if not for, potential; fault, mistake, error, blame, took out, responsible for, caused; deliberately, tried to, wanted to, chose to, decided to, opted to, in order to, aimed to, strategy, strategic, tactic, undercut, overcut, gamble; mechanical, engine, gearbox, brakes, tyres, tires, fuel, electrical, suspension, damage, puncture, crash, accident, spun, spin, went off, contact, collision, incident, problem, issue, failure, due to, because of; violated, breach, illegal, infringe, clearly, definitely, certainly, likely, proves; unfortunately, sadly, lucky, unlucky, dominant, brilliant, superb, impressive, costly, poor, terrible, "!"; pit loss, pit time, pit road, pit lap, settled, avg, average pace, unofficial, preliminary, insight. "fastest lap" only in the race summary (say "best lap" in stories).
- No markup characters (`* _ # [ ] | < >`), no clock times.
- **Story shape:** one story per car of the class (DNS and retirements included), `id` = `story:<car>`, headline contains `{car:<car>}`. Headline: 1–2 sentences, ≤ 35 words. Paragraphs: 1–4 sentences and ≤ 90 words each. Sprint race (≤ 2 h): 1–4 paragraphs, ≤ 260 words total; endurance (> 2 h): 1–6 paragraphs, ≤ 420 words; DNS: exactly one paragraph ≤ 60 words.
- `keyFactIds` (1–16): must include `result:<car>`, `ret:<car>` if any, every `pen:<car>:*`, every passage of the car whose kind is not `stop`. The story must cite `result:<car>` in a ref.
- Compare only through facts (rank, `deltaToCycleMeanS`, `netClass`); never add or subtract numbers yourself, never state a number that is not a fact.
- Retirements: say the last completed lap (`ret:<car>.lastCompletedLap`), the class position at retirement if given, and the results classification. Never a reason the facts do not contain. A retired car may still be classified: write both ("retired after lap {0} and is classified {1} in class"), never "finished" (validator A22).
- A car with two stops in one pit cycle has one cycle result, on its first stop, ranked over its stops combined (digest says so). Don't cite it as that stop's own rank.
- A stop with `green_loss_exceeds_pit_lane` (medium): cite the pit-lane time, not the time lost, unless you add a judgement.
- Facts with `confidence=low` need a written judgement if you cite them (`lowConfidenceJudgements: [{ "factId": "...", "judgement": { "text": "...", "refs": [] } }]`, ≤ 50 words). Easier: avoid citing low-confidence facts.

## What a good story says (in this order)

1. Start and first stint (who started, if the digest names drivers).
2. Each stop: lap, time in the pit lane, time lost against green pace (green stops) or under the caution; the class pit cycle: class position before → after (`cycres` `classPosBefore`/`classPosAfter`), net gained/lost/held, and the rank for time lost or the delta to the cycle mean.
3. Penalties (quote `reason` via a ref with `field: "reason"` — it is text, so it is cited, not typed).
4. On-track class swaps worth naming (a pass row is fact `pass:<winner>:<lap>:<loser>`, fields `lap`).
5. Finish: class and overall position, laps, "provisional" when the results are; or the retirement.

Plain, factual, past tense, no praise or blame. Name the driver handover when the digest gives `driverIn`/`driverOut` numbers. Vary sentence openings; do not copy the same template for every car.

## Rule findings

One finding per rule check of your class whose status is `fail` or `unknown` (lines with `RULE` in the digest). Fields:

```json
{ "ruleCheckIds": ["rule:…"], "car": "77", "assessment": "…", "severity": "info", "statement": { "text": "…", "refs": [] } }
```

- `fail` with `officialAction` (race control acted): assessment `penalised_consistent` (or `data_insufficient`); the statement names "race control".
- `fail` without official action: `possible_unpenalised` (the statement says "possible") or `data_insufficient`.
- `unknown`: `data_insufficient` or `not_assessable`.
- `severity` never above the check's `severityCeiling` (from the digest). Statement ≤ 2 sentences, ≤ 60 words, no rulebook value that is TBD. Nothing stronger than "possible"; never accuse a team.

## The race patch (`patches/race.json`, scope `{ "kind": "race" }`)

Written after the class patches, from `digest/race.md` and the class digests. Shape (no `carStories`; `ruleFindings: []`):

```json
{
  "patchFormat": "analysis-patch/1",
  "basedOn": { "generatedAt": "<generatedAt from race.md>" },
  "scope": { "kind": "race" },
  "raceSummary": {
    "headline": { "text": "{car:68} won {class:Silver} and finished {0} overall on the provisional results, completing {1} laps.", "refs": [ { "factId": "result:68", "field": "positionOverall" }, { "factId": "result:68", "field": "laps" } ] },
    "paragraphs": [ { "text": "…", "refs": [] } ],
    "classSummaries": [ { "class": "Silver", "text": { "text": "{car:68} won {class:Silver} on the provisional results, …", "refs": [ … ] } } ],
    "keyMoments": [
      { "lap": { "factId": "fcy:1", "field": "leaderLaps[0]" }, "lapEnd": { "factId": "fcy:1", "field": "leaderLaps[1]" }, "causes": ["fcy"],
        "title": { "text": "Full-course yellow after the start", "refs": [] },
        "text": { "text": "A full-course yellow ran from leader lap {0} to leader lap {1}.", "refs": [ … ] },
        "cars": [], "factIds": ["fcy:1"] }
    ]
  },
  "carStories": [],
  "ruleFindings": []
}
```

- Headline ≤ 30 words, cites the overall winner's `result:<car>` (and says "provisional" if the results are).
- 1–2 paragraphs, 2–4 sentences and ≤ 110 words counted across both paragraphs together. A decimal in a cited value does not end a sentence, but keep to short sentences.
- One class summary per class (every class in race.md, even a one-car class), each citing that class winner's `result:<car>`.
- Key moments in lap order: 4–6 for a sprint (≤ 2 h), 4–8 for an endurance race. `lap` (and optional `lapEnd`) is a ref to a lap-valued field. `causes` from: pit_cycle, on_track, rival_pit, penalty, fcy, retirement. `title`: no digits, no tokens needing refs, ≤ 12 words, no final full stop. `text`: one sentence ≤ 35 words. `cars`: car ids involved. `factIds`: the facts behind it.
- "fastest lap" is allowed here (not in stories). All the hard rules above apply.

## Whole race, one agent

When your task is a whole race: write every class patch (split a class over 12 cars into `.1`, `.2` …), check each, then write `race.json`, then run the full merge from `server/`:

```
npx tsx scripts/analysis.ts merge <run>/package.json <run>/patches --out <run>/draft.json
```

Fix patches until it prints `PASS`. Lines starting `MERGE patch … was written on facts generated …` mean your `basedOn.generatedAt` is wrong: copy it from race.md.

## Owner rules on tone

- Teammates race together: never compare co-drivers against each other (no "quicker than his co-driver"); say what each driver did for the car.
- Never mention how the stories are written (no AI, no model names).
- Results classification wording: DNS cars "did not start"; a DNS car listed with a position: "is listed {0} in class".
