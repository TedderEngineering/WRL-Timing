/**
 * Setup Sheet — the JSON shapes the API returns. Dates without a time of day
 * are "YYYY-MM-DD"; timestamps are ISO strings; sheet data is { key: text }.
 */
import type {
  SetupCar,
  SetupCarModel,
  SetupEvent,
  SetupSession,
  SetupSessionNote,
  SetupSheet,
  SetupSheetRevision,
} from "@prisma/client";
import { fromDateOnly, readValues } from "./values.js";

export type PersonLookup = Map<string, { displayName: string | null; email: string }>;

export function personName(people: PersonLookup, id: string | null): string | null {
  if (!id) return null;
  const p = people.get(id);
  return p ? p.displayName || p.email : null;
}

export const serializeCar = (c: SetupCar) => ({
  id: c.id,
  teamId: c.teamId,
  name: c.name,
  number: c.number,
  carClass: c.carClass,
  reference: readValues(c.reference),
  archived: c.archived,
  modelId: c.modelId,
  createdAt: c.createdAt,
});

export const serializeModel = (m: SetupCarModel) => ({
  id: m.id,
  slug: m.slug,
  make: m.make,
  model: m.model,
  series: m.series,
  status: m.status,
  spec: m.spec,
  updatedAt: m.updatedAt,
});

export const serializeEvent = (e: SetupEvent) => ({
  id: e.id,
  teamId: e.teamId,
  name: e.name,
  track: e.track,
  startDate: fromDateOnly(e.startDate),
  endDate: fromDateOnly(e.endDate),
  notes: e.notes,
  createdAt: e.createdAt,
});

export const serializeSession = (s: SetupSession) => ({
  id: s.id,
  teamId: s.teamId,
  eventId: s.eventId,
  carId: s.carId,
  name: s.name,
  kind: s.kind,
  seq: s.seq,
  sessionDate: fromDateOnly(s.sessionDate),
  createdAt: s.createdAt,
});

export const serializeSheet = (s: SetupSheet, people?: PersonLookup) => ({
  id: s.id,
  sessionId: s.sessionId,
  kind: s.kind,
  data: readValues(s.data),
  notes: s.notes,
  updatedById: s.updatedById,
  updatedByName: people ? personName(people, s.updatedById) : null,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

export const serializeNote = (n: SetupSessionNote, people: PersonLookup) => ({
  id: n.id,
  sessionId: n.sessionId,
  authorId: n.authorId,
  authorName: personName(people, n.authorId),
  category: n.category,
  body: n.body,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
});

export const serializeRevision = (r: SetupSheetRevision, people: PersonLookup) => ({
  id: r.id,
  sheetId: r.sheetId,
  changes: Array.isArray(r.changes) ? r.changes : [],
  notesChanged: r.notesChanged,
  changedById: r.changedById,
  changedByName: personName(people, r.changedById),
  changedAt: r.changedAt,
});
