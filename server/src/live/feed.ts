/**
 * The live timing feed, under the names the rest of src/live uses.
 *
 * WRL timing comes through the intake's existing timing-system client and
 * converters; this is the only file in src/live that imports them, so the
 * live code and everything it sends to viewers stay source-neutral.
 */
export {
  REDMIST_API as FEED_API,
  buildRedmistAllLapsCsv as buildAllLapsCsv,
  buildRedmistControlCsv as buildControlCsv,
  buildRedmistFlagsCsv as buildFlagsCsv,
  buildRedmistSummaryCsv as buildSummaryCsv,
  carsFromResults,
  eventDisplayName,
  eventsFromResponse,
  isWrlEvent,
  plausibleDate,
  sessionClock,
  type RmControlEntry as FeedControlEntry,
  type RmFlag as FeedFlag,
  type RmLap as FeedLap,
  type RmResults as FeedResults,
  type RmSession as FeedSession,
} from "../intake/parse-redmist.js";
export { REDMIST_KNOWN_EVENTS as KNOWN_EVENTS } from "../intake/sources/redmist-events.js";
export { paced, redmistUrls as feedUrls } from "../intake/sources/redmist.js";
