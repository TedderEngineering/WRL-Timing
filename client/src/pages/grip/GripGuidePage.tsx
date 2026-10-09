import { Card } from "@/features/grip/components";

const STEPS = [
  {
    title: "1. Create a reference session",
    body: "The calculation is based on a session you have already run. Pick one that represents the setup and pace you expect in the race. Record six things: track temperature, ambient temperature, session duration, cold wheel temperature, cold tire pressure and hot tire pressure. Take care to collect them accurately.",
  },
  {
    title: "2. Calculate the next session",
    body: "Open the reference session and enter five things for the run ahead: track temperature, ambient temperature, session duration, cold wheel temperature and the hot pressure you want. The calculator returns the cold pressure to set at each corner.",
  },
  {
    title: "3. Convert it to a new reference",
    body: "After the run, open the calculation, add the hot pressures you measured and convert it. Your newest run is now a baseline for the next one.",
  },
  {
    title: "Wet sessions",
    body: "Mark the calculation Wet when the track is wet. Wet calculations use a different method from dry ones.",
  },
  {
    title: "Damper tuning",
    body: "Choose your damper type, the turn direction, whether the car oversteers or understeers, the corner segment and the corner speed. Try option 1 first and reassess before moving on.",
  },
];

export function GripGuidePage() {
  return (
    <div className="container-page max-w-3xl">
      <h1 className="text-2xl sm:text-[1.65rem] font-bold tracking-tight text-gray-900 dark:text-gray-50">
        Guide
      </h1>
      <p className="mt-1 text-gray-600 dark:text-gray-400">
        How to get accurate cold pressures from Finding Grip.
      </p>

      <Card className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">
          Prefer to watch? Demo and how-to videos are on the Tedder Engineering site.
        </span>
        <a
          href="https://tedderengineering.com"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Watch videos ↗
        </a>
      </Card>

      <div className="mt-6 space-y-6">
        {STEPS.map((s) => (
          <section key={s.title}>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50">
              {s.title}
            </h2>
            <p className="mt-1.5 text-gray-600 dark:text-gray-400 leading-relaxed">
              {s.body}
            </p>
          </section>
        ))}
      </div>

      <p className="mt-8 border-l-2 border-gray-300 dark:border-gray-700 pl-3 text-sm text-gray-500">
        Finding Grip gives engineering guidance. You are responsible for every setup
        decision and for staying within the limits set by your tire and vehicle
        manufacturers.
      </p>
    </div>
  );
}
