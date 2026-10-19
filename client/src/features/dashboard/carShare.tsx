/**
 * "Share" on the dashboard's car card: the race page's car card (features/chart/raceCard.tsx,
 * the car's class position trace with its stops, its finish and best class benchmark) for the
 * race shown, from the race's chart data, fetched once per race. On a phone the chart is fetched
 * ahead so the share sheet opens from the tap.
 */
import { useEffect } from "react";
import { imageName } from "@/features/share";
import { ShareImageActions } from "@/features/share/ShareImageActions";
import { isComputer } from "@/features/share/shareImage";
import { makeRaceCarCard } from "../chart/raceCard";
import { loadRaceChartWithNotes } from "../my-drivers/driverCard";

interface Race {
  id: string;
  name: string;
  track: string;
  date: string;
}

export async function makeDashboardCarCard(race: Race, carKey: string): Promise<Blob> {
  const chart = await loadRaceChartWithNotes(race.id);
  if (!chart || !chart.data.cars[carKey]) throw new Error("no chart");
  return makeRaceCarCard(chart.data, chart.annotations, Number(carKey), { id: race.id, name: race.name, track: race.track, date: race.date });
}

export function ShareCarCardButton({ race, carKey, short }: { race: Race; carKey: string; short: string }) {
  useEffect(() => {
    if (isComputer()) return;
    const t = window.setTimeout(() => void loadRaceChartWithNotes(race.id), 1200);
    return () => window.clearTimeout(t);
  }, [race.id]);
  return (
    <ShareImageActions
      make={() => makeDashboardCarCard(race, carKey)}
      filename={imageName("racetrace", `${short} ${race.name}`)}
      text={`${short} · ${race.name} on RaceTrace`}
      kind="dashboard_car"
      label={`Share ${short}'s race card`}
      className="min-h-[36px] text-left text-sm font-semibold hover:underline disabled:opacity-60"
    />
  );
}

