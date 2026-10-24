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

/** Laps / Time / Both for the x axis. */
export function AxisToggle({
  value,
  onChange,
  small,
}: {
  value: "laps" | "hours" | "both";
  onChange: (m: "laps" | "hours" | "both") => void;
  small?: boolean;
}) {
  return (
    <div role="group" aria-label="X axis" className="flex overflow-hidden rounded-md border" style={{ borderColor: T.border }}>
      {(["laps", "hours", "both"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => onChange(m)}
          className={small ? "min-h-[28px] px-2.5 text-xs" : "min-h-[44px] px-3 text-sm"}
          style={{ background: value === m ? T.line : "transparent", color: value === m ? T.text : T.muted }}
        >
          {m === "laps" ? "Laps" : m === "hours" ? "Time" : "Both"}
        </button>
      ))}
    </div>
  );
}
