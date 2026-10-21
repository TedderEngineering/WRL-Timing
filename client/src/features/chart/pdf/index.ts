/** The PDF for each race-page tab; loaded only when someone downloads. */
import type { AnnotationData, RaceChartData } from "@shared/types";
import { api } from "../../../lib/api";
import { driverPerformance } from "../driver-performance";
import type { PitAnalysisResponse } from "../PitAnalysisTab";
import { loadRaceStories } from "../StoryTab";
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
    case "drivers":
      return { blob: await (await import("./driverReport")).driverReportPdf(driverPerformance(data, annotations), meta), name };
    case "pitanalysis": {
      const pits = await api.get<PitAnalysisResponse>(`/races/${raceId}/pit-analysis`);
      return { blob: await (await import("./pitStops")).pitStopsPdf(data, pits, focusNum, meta), name };
    }
    case "story": {
      const stories = await loadRaceStories(raceId);
      if (!stories) throw new Error("This race has no published story.");
      return { blob: await (await import("./story")).storyPdf(stories, meta), name };
    }
  }
}
