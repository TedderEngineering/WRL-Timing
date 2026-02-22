# Phase 4a: Source File Analysis

## Key Finding: Data is JSON, NOT CSV

The source file embeds two JavaScript objects (not CSV files):
- **Line 170**: `const DATA = { ... }` (~944KB) — main race data
- **Line 171**: `const ANN = { ... }` (~80KB) — annotations (pit reasons, settle markers)

## Libraries Used

**NONE** — the chart is rendered with:
- Vanilla Canvas 2D API (no D3, no Plotly, no Chart.js)
- Pure DOM manipulation for UI controls (dropdowns, chips, presets)
- No build step, no framework, no imports

## DATA Schema

```typescript
interface RaceData {
  maxLap: number;              // 249
  totalCars: number;           // 57
  greenPaceCutoff: number;     // 127.2 (seconds — laps slower than this are FCY/pit laps)
  cars: Record<string, CarData>;  // keyed by car number as string
  fcy: [number, number][];     // full-course yellow periods: [[startLap, endLap], ...]
  classGroups: Record<string, number[]>;  // { "GTU": [60, 58, ...], "GTO": [...], ... }
  classCarCounts: Record<string, number>; // { "GTU": 10, "GTO": 18, ... }
}

interface CarData {
  num: number;              // 60
  team: string;             // "Stratus 60"
  cls: string;              // "GTU"
  finishPos: number;        // 1 (overall finish position)
  finishPosClass: number;   // 1 (in-class finish position)
  laps: LapData[];          // one entry per lap completed
}

interface LapData {
  l: number;      // lap number (1-indexed)
  p: number;      // overall position at end of this lap
  cp: number;     // in-class position at end of this lap
  lt: string;     // lap time formatted "M:SS.mmm" e.g. "1:38.676"
  ltSec: number;  // lap time in seconds e.g. 98.676
  flag: string;   // "GF" (green flag) or "FCY" (full-course yellow)
  pit: number;    // 1 if pitted this lap, 0 otherwise
  spd: number;    // average speed in mph e.g. 86.83
}
```

## ANN (Annotations) Schema

```typescript
interface Annotations {
  [carNumber: string]: CarAnnotations;
}

interface CarAnnotations {
  reasons: Record<string, string>;  // { "18": "Pit stop — Lost 1 in pit cycle...", ... }
  pits: PitMarker[];
  settles: SettleMarker[];
}

interface PitMarker {
  l: number;     // lap number
  lb: string;    // label e.g. "Pit 1", "Pit 2"
  c: string;     // color hex e.g. "#fbbf24"
  yo: number;    // y-offset for label positioning (avoid overlap)
  da: number;    // unused (always 0)
}

interface SettleMarker {
  l: number;     // lap number where position settled
  p: number;     // overall position settled to
  lb: string;    // label e.g. "Settled P5"
  su: string;    // summary e.g. "Was P4 · Lost 1"
  c: string;     // color hex — red (#f87171) for lost, gray (#888) for held
}
```

## Rendering Approach

### Canvas-Based Drawing
The chart uses the HTML Canvas 2D API directly:
- `resize()` — calculates dimensions based on viewport, scales for devicePixelRatio
- `xOf(lap)` / `yOf(pos)` — coordinate mapping functions
- `draw()` — main render function drawing in order:
  1. Grid lines (horizontal for positions, vertical every 10 laps)
  2. FCY bands (yellow transparent rectangles)
  3. Pit stop vertical lines with labels
  4. Comparison car traces (faded colored step lines)
  5. Focus car position line (bold, class-colored)
  6. Settle arrows (pointing down to settled position with label)
  7. Pit stop dots (yellow circles on the position line)
  8. Active lap crosshair and highlighted dot
  9. Axis labels (positions on left, lap numbers on bottom)

### Step-Line Rendering
Position traces use STEP lines, not smooth lines:
```javascript
// For each lap: draw horizontal to new X, then vertical to new Y
ctx.lineTo(x, yOf(previousPosition));  // horizontal step
ctx.lineTo(x, y);                       // vertical to new position
```

### Interactive Features
1. **Focus car selection** — dropdown to pick which car to highlight
2. **Class view filter** — dropdown to view only one class (positions become in-class)
3. **Comparison chips** — toggle other cars on/off, with preset buttons (All Cars, by class)
4. **Hover/touch** — shows crosshair at active lap, info panel updates with:
   - Lap number, position, flag status, pit indicator
   - Position delta from previous lap (up/down arrow, colored)
   - Reason annotation (if any)
   - Pace comparison (focus car time vs average of comparison cars, only on green-flag laps)
   - Car metadata (team, class, finish position)
5. **Prev/Next navigation** — buttons + arrow keys to step through laps
6. **Mobile responsive** — collapsible selector panel, touch panning

### Color Scheme
- Class colors: GTU=#4ade80, GTO=#60a5fa, GP1=#f87171, GP2=#fbbf24, GP3=#a78bfa
- Comparison palette: 20 colors cycled for comparison cars
- FCY: yellow (#fbbf24) at 7% opacity
- Pit markers: yellow (#fbbf24)
- Settle markers: red (#f87171) for lost position, gray (#888) for held

### Hardcoded Values (Need to Become Configurable)
- `greenPaceCutoff` — already in DATA, just needs to be per-race
- `CLASS_COLORS` — could be per-series or per-race
- Race title in `<h1>` — "Position Trace — Barber 8-Hour 2025"
- Header subtitle with class counts
- Initial focus car (#60)
- Initial class view (focus car's class)

## Data Ingestion Strategy

Since the source data is already JSON (not CSV), the admin upload should accept:
- **Option A**: Two JSON files (DATA + ANN) — exact format as embedded in HTML
- **Option B**: A single combined JSON file
- **Option C**: CSV files that get transformed into this JSON format

Recommend **Option A** for initial implementation (matches the existing toolchain that
generates these files), with Option C as a future enhancement.

## API Response Format

The chart component needs data in essentially the same shape as the embedded JSON.
The API should return:

```json
GET /api/races/:id/chart-data
{
  "race": { "id", "name", "date", "track", "series", "season" },
  "data": {
    "maxLap": 249,
    "totalCars": 57,
    "greenPaceCutoff": 127.2,
    "cars": { ... },
    "fcy": [...],
    "classGroups": { ... },
    "classCarCounts": { ... }
  },
  "annotations": { ... }
}
```

This lets the React chart component consume the data with minimal transformation.
