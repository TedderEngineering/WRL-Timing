/**
 * WRL events on RedMist (organisation 1), from the back-catalogue inventory
 * (claude/BACK_CATALOGUE_INVENTORY.md, 14 Oct 2026). Discovery also lists
 * RedMist's archived and live events, so a new event does not need adding
 * here; this list keeps known events findable when that listing is down.
 * Ids only: no timing data.
 */
export interface KnownRedmistEvent {
  eventId: number;
  season: number;
  name: string;
  track: string;
}

export const REDMIST_KNOWN_EVENTS: KnownRedmistEvent[] = [
  // 2025: RedMist has sessions but no lap history (use wrl-speedhive).
  { eventId: 25, season: 2025, name: "World Racing League - Barber 2025", track: "Barber Motorsports Park" },
  { eventId: 26, season: 2025, name: "World Racing League - Mid-Ohio 2025", track: "Mid-Ohio Sports Car Course" },
  { eventId: 28, season: 2025, name: "World Racing League - Road America 2025", track: "Road America" },
  { eventId: 30, season: 2025, name: "World Racing League - Daytona 2025", track: "Daytona International Speedway" },
  { eventId: 44, season: 2025, name: "World Racing League - High Plains 2025", track: "High Plains Raceway" },
  { eventId: 60, season: 2025, name: "World Racing League - Watkins Glen 2025", track: "Watkins Glen International" },
  { eventId: 72, season: 2025, name: "World Racing League - Sebring 2025", track: "Sebring International Raceway" },
  { eventId: 87, season: 2025, name: "World Racing League - COTA 2025", track: "Circuit of the Americas" },
  // 2026: lap data; Flagtronics pit report from Road Atlanta on.
  { eventId: 139, season: 2026, name: "World Racing League - Eagles Canyon 2026", track: "Eagles Canyon Raceway" },
  { eventId: 155, season: 2026, name: "World Racing League - Barber 2026", track: "Barber Motorsports Park" },
  { eventId: 182, season: 2026, name: "World Racing League - Thunderhill 2026", track: "Thunderhill Raceway Park" },
  { eventId: 200, season: 2026, name: "World Racing League - Road America 2026", track: "Road America" },
  { eventId: 234, season: 2026, name: "World Racing League - Daytona 2026", track: "Daytona International Speedway" },
  { eventId: 297, season: 2026, name: "World Racing League - Road Atlanta 2026", track: "Michelin Raceway Road Atlanta" },
  { eventId: 376, season: 2026, name: "World Racing League - Watkins Glen 2026", track: "Watkins Glen International" },
  { eventId: 405, season: 2026, name: "World Racing League - West Desert 2026", track: "Utah Motorsports Campus" },
];
