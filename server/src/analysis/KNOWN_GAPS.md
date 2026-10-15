# Fact engine (G2): known gaps

This file lists every Stage 1 fixture mismatch that the engine does not fix, and why. It also lists the readings of `DEFINITIONS.md` that G2 had to decide. The acceptance test `__tests__/fixtures.acceptance.test.ts` requires the mismatch list to equal `__fixtures__/known-gaps.json` exactly. A new mismatch fails CI, and so does a gap that has been fixed but is still listed. No tolerance has been widened. The one tolerance not taken literally from FACT_ENGINE_SPEC §8.2 is WRL reconstructed FCY: ±0.05 s, because `V1_race_level_fcy` prints the expected WRL values to 1 dp.

## Result

Run with `RACETRACE_FIXTURE_DATA=/home/claude/fixture-data`.

| Race | Pit passages matched | Race-level gaps |
|---|---|---|
| MPC Road Atlanta | 96 / 96 | 7 drive times (G6, G7) |
| GT4 Indy R1 | 36 / 36 | 2 drive times (G6) |
| GT4 Indy R2 | 35 / 35 | 3 drive times (G6) |
| SRO COTA R1 | 99 / 99 | — |
| GR Cup COTA R1 | 11 / 11 | — |
| WRL Barber 8 h | 88 / 88 | — |
| WRL COTA 8 h | 76 / 83 | 2 class medians (G4) |
| Speedhive Sunday 7 h | 81 / 81 | 1 class median (G5) |
| **Total** | **522 / 529** | |

"Matched" means every compared field is within tolerance. The fields are: presence, kind, outcome, in-lap and out-lap, FCY context, pit-in and pit-out, official pit-lane time and its reliability flag, time-lost method and value, reference lap and window, class and overall positions before and after, net change, gained-on and lost-to sets, lap-down, and cycle id and members.

Race-level checks cover FCY intervals and leader laps, class median clean laps, Alkamel cycles, pit groups (C3), the transit estimate, and drive time against Drive Time `TOTAL_TRACK_TIME` (210 drivers with an official value; 198 match within ±0.0015 s).

## Gaps

| Id | Where | What | Why it is not fixed |
|---|---|---|---|
| G1 | COTA 8 h: #58 L46, #60 L46, #908 L45, #1 L41 (members); #1 L41 (after-lap, overall after) | Car 247's lap-40 stop falls into the GTU cycle of #1 instead of the cycle of #58, #60 and #908. | Car 247's lap 40 has `Lap_Time` 140.129 s, but its `Total_Race_Time` rises by 283.076 s, so the export is inconsistent. D-TIME defines lap L as (end[L−1], end[L]], so the in-lap starts at 9106.976 s. Stage 1 used end − `Lap_Time` = 9249.9 s. The `windows` model opens a window at an in-lap start, so the 143 s shift moves the car to another window. The engine keeps the definition. Laps whose elapsed difference disagrees with the lap time by more than 1 s are not clean (see I5). |
| G2 | COTA 8 h #21 L74 overall position after | Expected 33, engine 34 | `fixture_deltas` C4 changed this row's `after_lap` from 80 to 77, but it did not update `overall_pos_after`. The value 33 is the overall position at lap 80. At lap 77 the lap chart gives 34. |
| G3 | COTA 8 h #60 L1, #85 L1 time-lost method | Expected "fallback or none", engine `fcy_neighbours` | D-LOSS-FCY anchors in-lap-1 passages at the lap-1 start and takes neighbours by lap-1 start (as for GR #15). Stage 1 WRL anchored at race time 0 and found no neighbours. `fixture_deltas` says no WRL FCY value changes, so it does not list these two rows. |
| G4 | COTA 8 h class medians GP2 (162.909 → 162.916) and GTO (146.090 → 146.0875) | Clean-lap sets differ. | Two decisions remove laps that Stage 1 counted as clean. Under D-REF-PACE, a blank `Lap_Time` is not clean (WS20). Under I5, rows whose elapsed difference disagrees with `Lap_Time` are excluded, for example #418 L130 with 318.8 s elapsed against a 160.0 s lap time. No passage value changes. |
| G5 | Sunday 7 h class median GTU (143.418 → 143.416) | One lap (#60 L120) is clean under the hybrid FCY reconstruction. | D-FCY-RECON starts a caution at the midpoint, where Stage 1 WRL used the outer bracket. V1 checked passage values only, not class medians. |
| G6 | 12 drivers whose last stint ends at a Drive-Time-only retirement (MPC #23, #52, #53, #57, #59, #77; R1 #19, #72; R2 #38, #028, #131) | Drive time is 0.02–0.95 s short. | The retirement's pit-in comes from Drive Time `START`, which is printed to whole seconds. That is the only source for these passages. |
| G7 | MPC #12 driver 1 | 4324.725 s against official 4260.466 s (+64.259 s) | #12 crossed the line in the pit lane after the chequer (`finished_in_pit_lane`). Drive time runs to the time expiry (13:40:42.357, IMSA SR 12.11.4). The Drive Time file ends the stint at 13:39:38, with no PIT row. Owner question: what does IMSA's Drive Time report count when a car is in the pit lane at the expiry? |

## Interpretations decided in G2

| Id | Definition | Reading taken | Why |
|---|---|---|---|
| I1 | D-PIT-KIND rule 6, "no penalty record exists for the race" | Read **per passage**: no matched RC penalty and no Drive Time `PENALTY` type for this passage. | Read literally, MPC #59 L62 (37.1 s; transit 35.1 s; no RC text; `PIT_TYPE=NORMAL`) becomes a 37-second "stop". The fixture and C5 keep it as a drive-through. Confidence stays low with `drive_through_by_duration`. |
| I2 | D-PITLANE for AO2 (card in-time equals a line crossing) | The card value is kept and `pitLaneTimeReliable` is false (SRO COTA #28 L53: 308.985 s). | D-PITLANE allows a null value only when there is no official record, and the AA7 row says "null / pitLaneTimeReliable = false". Stage 1 printed null. |
| I3 | D-PITLANE for B-flag-only passages and retirements | Null, including MPC #12 L77. Stage 1 printed `race_end − estimate` = 27.193 s. | No official record exists. A passage that finished in the pit lane keeps its card value when it has one. |
| I4 | D-STINT on WRL | A stint ends at the in-lap end and the next starts there. There are no pit times, so confidence is medium. When the WW `Driver_Name` changes without a stop, the stint is split and one `DRIVER-CHANGE-NO-STOP` warning per car is raised (WN5 makes this frequent on COTA). | — |
| I5 | Clean lap (D-REF-PACE) | Also requires \|elapsed difference − lap time\| ≤ 1 s. | WRL website rows with repeated or shifted `Total_Race_Time` exist: COTA #29 L146 repeats L145, which made reference pace 154.50 s against 154.40 s. |
| I6 | `metadata.lexicon` | Only proper names that contain a digit. | Lexicon terms are removed before the banned-word and required-word checks. With every team, session and driver name in the lexicon, session "Race" masked "Race control" (A16). |
| I7 | Result status for Speedhive and WRL summaries (Q4 open) | `provisional`, with note `RESULTS-PROVISIONAL`. Speedhive `Normal` maps to classified and `DQ` to dsq. The WW summary has no status, so a row with a position is classified. A class position of 0 or less is null. | — |
| I8 | Cycle-result id when one car has two member stops in one cycle | `cycres:<class>:<n>:<car>:<k>` for k ≥ 2 (MPC GS, R2 Am, SRO COTA Pro-Am). | The schema grammar `cycres:<class>:<n>:<car>` would collide. |
| I9 | D-DATE when the files have no date (SRO COTA, GR COTA) | Blocker `DATE-AMBIGUOUS`; `raceDate` 1970-01-01 until the owner enters it. | No date was invented. The COTA 8 h test uses 2025-12-06, which is the day before the Sunday 7 h `Time of Day` date. |
| I10 | Lap interval when a previous row exists | Previous row's end (D-TIME), also for WRL. | Stage 1 WRL used end − `Lap_Time`; see G1. |

## Not built in G2 (status October 2026)

| Item | Status |
|---|---|
| M17 rule checks | Built in G3: `rules/run-rule-checks.ts` with rulebooks `imsa-mpc-2026`, `sro-gt4-america-2026` and `wrl-2026` (`rules/rulebooks/*.yaml`, loaded by `rules/load-rulebook.ts`). |
| WRL control log / Redmist flags (FCY rank 1 or 2 for WRL) | Built for the RedMist format (`adapters/redmist.ts`): its flags file gives the caution periods and its pit report the pit passages. WRL website and Speedhive exports still reconstruct FCY (Q1). |
| WW `Penalties` column | Not turned into penalty records. The schema has no type for "presence only". |
| `12_Lap Chart` check (A-LC) | Built: `engine/lap-chart.ts` compares the lap chart with D-POS and raises `LAP-CHART-MISMATCH` (warning) or `LAP-CHART-UNMATCHED` / `LAP-CHART-UNREAD` (notes). MPC Road Atlanta: 3261 of 3261 positions agree. Not part of the frozen fixtures (their file lists leave the lap chart out). |
| IMSA PDF flags, W-POS running-order check (T6) | Not implemented. |
| T8 penalty fixture (22 records) and T9 make/date fixtures | Covered only by unit tests on synthetic data, and by MPC/R1 spot checks (dates 2026-10-02, 2026-10-10 −04:00, 2026-10-11). There is no frozen expected file. |
| Rulebook YAML loader | Built (`rules/load-rulebook.ts`). The engine itself still takes the few values it reads as `options.rulebook` (`pitCycleModel`, `pitLaneTransitS`, `garageThresholdS`, `serveWindowS`, `scheduledDurationS`, `driveTimeEndsAt`). |

## On the race page

Since October 2026 the race page, Your car and the Pit Stops tab take their pit facts from a race's published package (`packages/pit-facts.ts`). So the gaps above are the gaps users see on those races. Races without a package still show the import's own analysis (`utils/parsers/position-analysis.ts`, audited in ACCURACY_WRL / ACCURACY_ALKAMEL).
