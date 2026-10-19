/**
 * The race-ready email's body, laid out like the dashboard's car card (client
 * features/dashboard/MyCarCard.tsx): the car and its drivers, the result, the car's race (best lap,
 * stops, places over the pit cycles), who drove when with each stint's average, and the pit cycles
 * one row each, numbered the car's own way. For a followed driver, their own drive comes first.
 *
 * Email clients: tables and inline styles only, no images, no web fonts. The colours are RaceTrace's
 * own dark theme (client styles/globals.css .dark), set with bgcolor as well as CSS so clients that
 * drop CSS backgrounds keep them, and marked dark-only so mail apps don't re-colour it.
 * Facts only, as on the card.
 */
import type { CarFacts } from "../dashboard/my-car.js";
import type { CarDrive, DriverFacts } from "../dashboard/my-driver.js";
import { displayName } from "./driver-search.js";
import { escapeHtml } from "./email.js";

// RaceTrace's dark theme (--rt-* in client/src/styles/globals.css).
const BG = "#0b0b18";
const SURFACE = "#12122a";
const ACCENT = "#F48C34";
const TEXT = "#e0e0e8";
const SOFT = "#cbd5e1";
const MUTED = "#9a9ab4";
const LINE = "#1e1e38";
const GOOD = "#4ade80";
const BAD = "#e66767";
/** Each driver's colour in the stint bar, in the order they first drove (as the car card). */
const DRIVER_COLORS = ["#F48C34", "#7aa2ff", "#a78bfa", "#2dd4bf", "#9a9ab4"];
const ORDINAL = ["", "fastest", "2nd fastest", "3rd fastest"];
const QUICKEST = ["", "Quickest", "2nd quickest", "3rd quickest"];

/** "2:17.732" */
export function lapTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

/** "3:42 h", "48 min" (as the cards). */
export function driveTime(s: number): string {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")} h` : `${min} min`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
const e = (s: string | number) => escapeHtml(String(s));

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function finishText(f: CarFacts): string {
  if (f.finishClass !== null) {
    const of = f.classSize ? ` of ${f.classSize}` : "";
    if (f.finished === false) return `Retired after lap ${f.laps} · classified P${f.finishClass} in ${f.cls}${of}`;
    return `Finished P${f.finishClass} in ${f.cls}${of} · P${f.finishOverall} overall`;
  }
  if (f.status === "dsq") return "Disqualified";
  if (f.status === "dns") return "Did not start";
  if (f.status === "dnf") return "Did not finish";
  return "Not classified";
}

const label = (t: string) =>
  `<div style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${MUTED}; margin: 0 0 8px;">${e(t)}</div>`;

/** Three stat cells: a big value over a small line. */
function stats(cells: { value: string; sub: string; color?: string; mono?: boolean }[]): string {
  const w = Math.floor(100 / cells.length);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;"><tr>${cells
    .map(
      (c) => `<td width="${w}%" valign="top" style="padding: 0 8px 0 0;">
        <div style="font-size: 20px; font-weight: 700; line-height: 1.1; color: ${c.color ?? TEXT};${c.mono ? " font-family: Menlo, Consolas, monospace;" : ""}">${c.value}</div>
        <div style="font-size: 12px; color: ${MUTED}; margin-top: 4px;">${c.sub}</div>
      </td>`
    )
    .join("")}</tr></table>`;
}

export interface AlertEmail {
  subject: string;
  /** "your car's race is up", "your driver's race is up", "the results are official" (fixed wording, not escaped). */
  kicker: string;
  raceName: string;
  raceDate: string;
  f: CarFacts;
  /** The entry's drivers, display-cased. */
  drivers: string[];
  drive: CarDrive | null;
  /** A followed driver: their name and their drive. */
  driverName?: string | null;
  driverDrive?: DriverFacts | null;
  raceUrl: string;
  unsubscribeUrl: string;
  settingsUrl: string;
  /** The official follow-up: what changed since the provisional email. */
  changes?: string[];
}

export function alertEmailHtml(p: AlertEmail): string {
  const { f, drive } = p;
  const cycles = f.pitCycles;
  const net = cycles.reduce((a, c) => a + c.net, 0);
  const named = !!drive?.known && drive.drivers.length > 0;
  const stops = drive && drive.stints.length > 0 ? drive.stints.length - 1 : cycles.length;
  const stopLaps = drive && drive.stints.length > 1 ? drive.stints.slice(0, -1).map((s) => s.end) : cycles.map((c) => c.stopLap).filter((l): l is number => !!l);
  const colorOf = (d: string | null) => {
    if (!d || !drive) return LINE;
    const i = drive.drivers.findIndex((x) => displayName(x.name) === displayName(d));
    return i < 0 ? LINE : DRIVER_COLORS[i % DRIVER_COLORS.length];
  };
  const mine = (d: string | null) => !!p.driverName && !!d && displayName(d) === displayName(p.driverName);
  const date = new Date(p.raceDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  const parts: string[] = [];

  // The car and its drivers.
  parts.push(`<p style="margin: 0 0 14px; font-size: 14px; color: ${SOFT};">
      <span style="font-family: Menlo, Consolas, monospace; font-weight: 700; color: ${ACCENT};">#${e(f.number)}</span>
      ${e(f.team)} <span style="color: ${MUTED};">· ${e(f.cls)}</span>${p.drivers.length ? `<br><span style="color: ${MUTED};">${e(list(p.drivers))}</span>` : ""}
    </p>`);

  if (p.changes) {
    parts.push(`<p style="margin: 0 0 6px; color: ${TEXT}; font-weight: 600;">Changed since the provisional results</p>
      <ul style="padding-left: 18px; margin: 0 0 16px; color: ${SOFT}; line-height: 1.6;">${p.changes.map((l) => `<li>${e(l)}</li>`).join("")}</ul>`);
  }

  // The result.
  parts.push(`<p style="margin: 0 0 16px; font-size: 16px; font-weight: 600; color: ${TEXT};">${e(finishText(f))} · ${e(f.laps)} of ${e(f.raceLaps)} laps</p>`);

  // A followed driver's own drive.
  const dd = p.driverDrive;
  if (p.driverName && dd?.known && dd.myStints > 0) {
    const first = displayName(p.driverName).split(/\s+/)[0];
    const share = dd.carTimeS > 0 ? ` · ${Math.round((dd.driveTimeS / dd.carTimeS) * 100)}%` : "";
    const my = dd.stints.filter((s) => s.mine);
    const avgs = my.filter((s) => s.avgLapS).map((s) => `laps ${s.start}–${s.end} <b style="font-family: Menlo, Consolas, monospace; color: ${TEXT};">${lapTime(s.avgLapS!)}</b>`);
    parts.push(`<div style="border: 1px solid ${LINE}; border-radius: 10px; padding: 14px 16px; margin: 0 0 12px; background: ${SURFACE};">
        ${label(`${first}'s drive`)}
        ${stats([
          { value: e(driveTime(dd.driveTimeS)), sub: `drive time${share}` },
          { value: `${dd.myStints} <span style="font-size: 13px; color: ${MUTED};">stint${dd.myStints === 1 ? "" : "s"}</span>`, sub: `laps ${my.map((s) => `${s.start}–${s.end}`).join(", ")}` },
          { value: dd.bestLap ? lapTime(dd.bestLap.sec) : "—", sub: dd.bestLap ? `best lap, lap ${dd.bestLap.lap}` : "no green lap", mono: true },
        ])}
        ${avgs.length ? `<div style="font-size: 12px; color: ${MUTED}; margin-top: 10px;">${my.length === 1 ? "Stint average" : "Stint averages"}: ${avgs.join(" · ")}</div>` : ""}
      </div>`);
  }

  // The car's race.
  const raceBox: string[] = [];
  raceBox.push(label(`#${f.number}'s race`));
  const cells: { value: string; sub: string; color?: string; mono?: boolean }[] = [
    {
      value: f.bestLap ? lapTime(f.bestLap.sec) : "—",
      sub: f.bestLap ? `best lap, lap ${f.bestLap.lap}${f.bestLapClassRank ? ` · ${ORDINAL[f.bestLapClassRank]} in ${e(f.cls)}` : ""}` : "no green lap",
      mono: true,
    },
    {
      value: `${stops} <span style="font-size: 13px; color: ${MUTED};">stop${stops === 1 ? "" : "s"}</span>`,
      sub: stopLaps.length ? `laps ${stopLaps.join(", ")}` : stops > 0 ? "in the pit lane" : "no pit stops",
    },
  ];
  if (cycles.length) {
    cells.push({
      value: signed(net),
      sub: `place${Math.abs(net) === 1 ? "" : "s"} in ${e(f.cls)} over ${cycles.length} pit cycle${cycles.length === 1 ? "" : "s"}`,
      color: net > 0 ? GOOD : net < 0 ? BAD : TEXT,
    });
  }
  raceBox.push(stats(cells));

  if (named) {
    const total = Math.max(1, drive!.stints.reduce((n, s) => n + s.end - s.start + 1, 0));
    // The stint bar: one cell per stint, as wide as its laps.
    raceBox.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: separate; border-spacing: 2px 0; margin: 14px 0 8px;"><tr>${drive!.stints
      .map((s) => `<td width="${(((s.end - s.start + 1) / total) * 100).toFixed(1)}%" height="10" style="height: 10px; line-height: 10px; font-size: 1px; background: ${colorOf(s.driver)}; border-radius: 3px;">&nbsp;</td>`)
      .join("")}</tr></table>`);
    raceBox.push(`<div style="font-size: 12px; color: ${SOFT}; line-height: 1.8;">${drive!.drivers
      .map(
        (d) =>
          `<span style="white-space: nowrap; margin-right: 14px;"><span style="display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: ${colorOf(d.name)};"></span> ${e(displayName(d.name))} <span style="color: ${MUTED};">${e(driveTime(d.driveTimeS))}${drive!.carTimeS > 0 ? ` · ${Math.round((d.driveTimeS / drive!.carTimeS) * 100)}%` : ""}</span></span>`
      )
      .join("")}</div>`);
    if (drive!.stints.some((s) => s.avgLapS)) {
      raceBox.push(`<div style="font-size: 12px; font-weight: 600; color: ${MUTED}; margin: 12px 0 4px;">Stint averages</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse: collapse; font-size: 12px; color: ${MUTED};">${drive!.stints
          .map(
            (s) => `<tr${mine(s.driver) ? ` style="color: ${TEXT};"` : ""}>
              <td style="padding: 2px 8px 2px 0;"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 2px; background: ${colorOf(s.driver)};"></span></td>
              <td style="padding: 2px 14px 2px 0; white-space: nowrap;">laps ${s.start}–${s.end}</td>
              <td style="padding: 2px 14px 2px 0;">${s.driver ? e(displayName(s.driver)) : "—"}</td>
              <td style="padding: 2px 0; font-family: Menlo, Consolas, monospace; font-weight: 700; color: ${TEXT};">${s.avgLapS ? lapTime(s.avgLapS) : "—"}</td>
            </tr>`
          )
          .join("")}</table>`);
    }
  } else if (drive) {
    raceBox.push(`<p style="margin: 12px 0 0; font-size: 12px; color: ${MUTED};">This race's timing doesn't say who drove when.</p>`);
  }
  parts.push(`<div style="border: 1px solid ${LINE}; border-radius: 10px; padding: 14px 16px; margin: 0 0 16px; background: ${SURFACE};">${raceBox.join("")}</div>`);

  // The pit cycles, one row each.
  if (cycles.length) {
    parts.push(`${label(`Pit cycles in ${f.cls}`)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; font-size: 13px; margin: 0 0 18px;">
        ${cycles
          .map((c) => {
            const tone = c.net > 0 ? GOOD : c.net < 0 ? BAD : MUTED;
            const change = c.net > 0 ? `Gained ${c.net}` : c.net < 0 ? `Lost ${-c.net}` : "Held";
            const notes = [
              c.driveThrough ? "drive-through" : c.caution ? "caution" : null,
              c.quickest ? `<span style="color: ${GOOD};">${QUICKEST[c.quickest.rank]} stop of ${c.quickest.of}</span>` : null,
            ].filter(Boolean);
            return `<tr>
              <td style="padding: 7px 10px 7px 0; border-top: 1px solid ${LINE}; color: ${MUTED}; white-space: nowrap;">${c.cycle} · ${c.stopLap ? `lap ${c.stopLap}` : `settled lap ${c.lap}`}</td>
              <td style="padding: 7px 10px 7px 0; border-top: 1px solid ${LINE}; font-weight: 600; color: ${TEXT}; white-space: nowrap;">P${c.before} → P${c.after}</td>
              <td style="padding: 7px 10px 7px 0; border-top: 1px solid ${LINE}; font-weight: 600; color: ${tone}; white-space: nowrap;">${change}</td>
              <td style="padding: 7px 0; border-top: 1px solid ${LINE}; color: ${MUTED}; font-size: 12px;">${notes.join(" · ")}</td>
            </tr>`;
          })
          .join("")}
      </table>`);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark only"><meta name="supported-color-schemes" content="dark only">
<style>:root { color-scheme: dark only; } a { color: ${ACCENT}; }</style></head>
<body style="margin: 0; padding: 0; background: ${BG};" bgcolor="${BG}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="background: ${BG}; border-collapse: collapse;"><tr><td align="center" style="padding: 24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${BG}" style="max-width: 560px; background: ${BG}; border-collapse: collapse;"><tr><td style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; color: ${TEXT}; text-align: left;">
      <p style="margin: 0 0 4px; font-size: 13px; color: ${MUTED};">RaceTrace · ${p.kicker}</p>
      <h2 style="margin: 0 0 6px; font-size: 20px; line-height: 1.3; color: ${TEXT};">${e(p.subject)}</h2>
      <p style="margin: 0 0 14px; font-size: 14px; color: ${SOFT};">${e(p.raceName)} · ${e(date)}</p>
      ${parts.join("\n")}
      <a href="${p.raceUrl}" style="display: inline-block; background: ${ACCENT}; color: ${BG}; padding: 11px 20px; border-radius: 8px; text-decoration: none; font-weight: 700;">Open the race</a>
      <p style="margin: 24px 0 0; color: ${MUTED}; font-size: 12px; line-height: 1.5;">
        You get this because you follow ${p.driverName ? e(p.driverName) : `#${e(f.number)}`} on RaceTrace and turned on race emails.
        <a href="${p.unsubscribeUrl}" style="color: ${MUTED};">Turn these emails off</a> ·
        <a href="${p.settingsUrl}" style="color: ${MUTED};">${p.driverName ? "My drivers" : "My cars"}</a>
      </p>
  </td></tr></table>
</td></tr></table>
</body></html>`;
}
