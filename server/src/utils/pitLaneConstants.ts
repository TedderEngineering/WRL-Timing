/**
 * Pit Lane Transit Time Constants
 *
 * Approximate pit lane transit times (entry + exit, no service) for tracks
 * commonly used in WRL, IMSA, and other series. Values are in seconds and
 * represent a typical clean pass through pit road without stopping.
 *
 * These serve as a floor reference: any pit stop must take at least this long.
 * Also useful for future tooltip / decomposition display.
 */

const PIT_LANE_TRANSIT: Record<string, number> = {
  // WRL / IMSA tracks
  "COTA":                  45,
  "Circuit of the Americas": 45,
  "Daytona":               40,
  "Daytona International Speedway": 40,
  "Sebring":               42,
  "Sebring International Raceway": 42,
  "Road Atlanta":          38,
  "Michelin Raceway Road Atlanta": 38,
  "Watkins Glen":          40,
  "Watkins Glen International": 40,
  "Laguna Seca":           35,
  "WeatherTech Raceway Laguna Seca": 35,
  "Lime Rock":             30,
  "Lime Rock Park":        30,
  "Mid-Ohio":              36,
  "Mid-Ohio Sports Car Course": 36,
  "VIR":                   38,
  "Virginia International Raceway": 38,
  "Barber":                36,
  "Barber Motorsports Park": 36,
  "Detroit":               35,
  "Indianapolis":          42,
  "Indianapolis Motor Speedway": 42,
  "Long Beach":            30,
  "Petit Le Mans":         38,
  "Road America":          42,
  "Sonoma":                35,
  "Sonoma Raceway":        35,
  "Mosport":               38,
  "Canadian Tire Motorsport Park": 38,
  "NOLA":                  36,
  "NOLA Motorsports Park": 36,
  "MSR Houston":           34,
  "MSR Cresson":           32,
  "Harris Hill":           30,
  "Eagles Canyon":         32,
  "Hallett":               32,
  "Hallett Motor Racing Circuit": 32,
  "Motorsport Ranch":      32,
  "NCM Motorsports Park":  34,
  "Pittsburgh International Race Complex": 34,
  "Summit Point":          30,
  "Thunderhill":           35,
};

/** Default transit time when track is unknown (conservative estimate). */
const DEFAULT_TRANSIT_TIME = 38;

/**
 * Get approximate pit lane transit time for a given track.
 *
 * Performs case-insensitive substring matching, so partial names work
 * (e.g. "COTA", "Sebring", "Road Atlanta").
 *
 * @returns Transit time in seconds
 */
export function getPitLaneTransitTime(trackName: string): number {
  if (!trackName) return DEFAULT_TRANSIT_TIME;

  // Exact match first
  if (PIT_LANE_TRANSIT[trackName] != null) {
    return PIT_LANE_TRANSIT[trackName];
  }

  // Case-insensitive substring match
  const lower = trackName.toLowerCase();
  for (const [key, value] of Object.entries(PIT_LANE_TRANSIT)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return value;
    }
  }

  return DEFAULT_TRANSIT_TIME;
}
