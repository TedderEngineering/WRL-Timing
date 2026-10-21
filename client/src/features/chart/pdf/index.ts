/** The PDF for each race-page tab; loaded only when someone downloads. */
import type { AnnotationData, RaceChartData } from "@shared/types";
import { api } from "../../../lib/api";
import { driverPerformance } from "../driver-performance";
import { driverReportView, sortDriverRows } from "../driver-report-view";
import type { PitAnalysisResponse } from "../PitAnalysisTab";
import { loadRaceStories, storyCarFor } from "../StoryTab";
import { pdfFileName, type PdfMeta } from "./kit";

export type PdfTab = "position" | "story" | "pitanalysis" | "laptimes" | "strategy" | "drivers";

export const PDF_TITLES: Record<PdfTab, string> = {
  position: "Position Trace",
  story: "Race Story",
  pitanalysis: "Pit Stops",
  laptimes: "Lap Times",
  strategy: "Strategy",
  drivers: "Driver Report",
};

export interface TabPdfInput {
  raceId: string;
  data: RaceChartData;
  annotations: AnnotationData;
  focusNum: number;
  meta: PdfMeta;
  /** "focus": just the focus car (the Story tab); the whole race otherwise. */
  scope?: "race" | "focus";
}

export async function tabPdf(tab: PdfTab, input: TabPdfInput): Promise<{ blob: Blob; name: string }> {
  const { data, annotations, focusNum, meta, raceId } = input;
  const name = pdfFileName(PDF_TITLES[tab], meta);
  switch (tab) {
    case "position":
      return { blob: await (await import("./positionTrace")).positionTracePdf(data, annotations, focusNum, meta), name };
    case "laptimes":
      return { blob: await (await import("./lapTimes")).lapTimesPdf(data, annotations, focusNum, meta), name };
    case "strategy":
      return { blob: await (await import("./strategy")).strategyPdf(data, annotations, focusNum, meta), name };
    case "drivers": {
      // As the table is on screen: its class, in its order (every class, ranked on average lap, when
      // the tab was never opened).
      const view = driverReportView(data);
      let reports = driverPerformance(data, annotations);
      if (view) reports = reports.filter((r) => r.cls === view.cls).map((r) => ({ ...r, rows: sortDriverRows(r.rows, view.sort) }));
      return { blob: await (await import("./driverReport")).driverReportPdf(reports, meta, view?.sort), name };
    }
    case "pitanalysis": {
      const pits = await api.get<PitAnalysisResponse>(`/races/${raceId}/pit-analysis`);
      return { blob: await (await import("./pitStops")).pitStopsPdf(data, pits, focusNum, meta), name };
    }
    case "story": {
      const stories = await loadRaceStories(raceId);
      if (!stories) throw new Error("This race has no published story.");
      const car = input.scope === "focus" ? storyCarFor(data, focusNum, stories.stories) : null;
      const carName = car ? pdfFileName(`${PDF_TITLES.story} - #${car}`, meta) : name;
      return { blob: await (await import("./story")).storyPdf(stories, meta, car), name: carName };
    }
  }
}
