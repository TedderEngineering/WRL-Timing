/** Small controls shared by the laptop control bar (TraceControls) and the phone car sheet (CarSheet). */

/** The race page's colours (RaceDetailPage `RT`, laptop and phone alike). */
export const T = {
  card: "#12122a",
  border: "#3a3a5c",
  line: "#1e1e38",
  text: "#e0e0e8",
  soft: "#cbd5e1",
  muted: "#9a9ab4",
  accent: "#F48C34",
};

/**
 * Laps / Time / Both for the x axis. `phone`: just Laps | Time, small in the chart's caption
 * line, each with a 44 px touch area reaching past its 28 px look (Both stays in the car sheet).
 */
export function AxisToggle({
  value,
  onChange,
  small,
  phone,
}: {
  value: "laps" | "hours" | "both";
  onChange: (m: "laps" | "hours" | "both") => void;
  small?: boolean;
  phone?: boolean;
}) {
  const modes = phone ? (["laps", "hours"] as const) : (["laps", "hours", "both"] as const);
  const on = (m: string) => value === m || (phone && m === "hours" && value === "both");
  return (
    <div role="group" aria-label="X axis" className={`flex shrink-0 rounded-md border${phone ? "" : " overflow-hidden"}`} style={{ borderColor: T.border }}>
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={on(m)}
          onClick={() => onChange(m)}
          data-touch-44={phone ? "" : undefined}
          className={
            phone
              ? "relative min-h-[28px] px-3 text-[12px] before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']"
              : small
                ? "min-h-[28px] px-2.5 text-xs"
                : "min-h-[44px] px-3 text-sm"
          }
          style={{ background: on(m) ? T.line : "transparent", color: on(m) ? T.text : T.muted }}
        >
          {m === "laps" ? "Laps" : m === "hours" ? "Time" : "Both"}
        </button>
      ))}
    </div>
  );
}
