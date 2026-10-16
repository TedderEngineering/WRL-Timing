import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "../../lib/api";
import { formatDateRange } from "../../lib/race-dates";

interface EventDrafts {
  eventId: string;
  name: string;
  series: string;
  track: string;
  startDate: string;
  endDate: string;
  drafts: { id: string; name: string; date: string }[];
  publishedCount: number;
}

/**
 * Admin › Races: the events with draft races (the weekly import brings a whole weekend in as
 * drafts), each with "Publish all" so a weekend goes out in one step instead of race by race.
 * Each race is published as if one by one, so followers get their race emails.
 */
export function EventDraftsPanel({ onPublished }: { onPublished: () => void }) {
  const [events, setEvents] = useState<EventDrafts[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setEvents((await api.get<{ events: EventDrafts[] }>("/admin/events/drafts")).events);
    } catch {
      setEvents([]);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const publish = async (ev: EventDrafts) => {
    setBusy(ev.eventId);
    setMessage(null);
    try {
      const res = await api.post<{ published: { id: string; name: string }[] }>(`/admin/events/${encodeURIComponent(ev.eventId)}/publish`);
      setMessage({ ok: true, text: `Published ${res.published.length} race${res.published.length === 1 ? "" : "s"} from ${ev.name}.` });
      setConfirm(null);
      await load();
      onPublished();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiClientError ? e.message : "Publishing failed" });
    } finally {
      setBusy(null);
    }
  };

  if (!events || events.length === 0) return message ? <Banner message={message} onClose={() => setMessage(null)} /> : null;

  return (
    <section aria-labelledby="event-drafts" className="mb-6 rounded-lg border border-gray-200 dark:border-gray-800">
      <h2 id="event-drafts" className="m-0 border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 dark:border-gray-800 dark:text-gray-300">
        Drafts waiting, by event
      </h2>
      {message && <Banner message={message} onClose={() => setMessage(null)} />}
      <ul className="m-0 list-none divide-y divide-gray-100 p-0 dark:divide-gray-800">
        {events.map((ev) => {
          const n = ev.drafts.length;
          return (
            <li key={ev.eventId} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-medium text-gray-900 dark:text-gray-100">
                  {ev.series} · {ev.name}
                  <span className="font-normal text-gray-500 dark:text-gray-400"> · {formatDateRange(ev.startDate, ev.endDate)}</span>
                </p>
                <p className="m-0 mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {n} draft{n === 1 ? "" : "s"}: {ev.drafts.map((r) => r.name).join(", ")}
                  {ev.publishedCount ? ` · ${ev.publishedCount} already published` : ""}
                </p>
              </div>
              {confirm === ev.eventId ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Visitors see them, and followers get their race emails.</span>
                  <button
                    type="button"
                    onClick={() => publish(ev)}
                    disabled={busy !== null}
                    className="min-h-[36px] rounded-md bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {busy === ev.eventId ? "Publishing…" : `Publish ${n} race${n === 1 ? "" : "s"}`}
                  </button>
                  <button type="button" onClick={() => setConfirm(null)} className="min-h-[36px] px-2 text-sm text-gray-600 dark:text-gray-400">
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirm(ev.eventId)}
                  disabled={busy !== null}
                  className="min-h-[36px] shrink-0 rounded-md border border-brand-600 px-3 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-950/30"
                >
                  {n === 1 ? "Publish…" : `Publish all ${n}…`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Banner({ message, onClose }: { message: { ok: boolean; text: string }; onClose: () => void }) {
  return (
    <div
      role="status"
      className={`mx-4 my-3 flex items-center justify-between rounded-lg border p-3 text-sm ${
        message.ok
          ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/20 dark:text-green-300"
          : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-300"
      }`}
    >
      {message.text}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="ml-3 opacity-60 hover:opacity-100">
        ✕
      </button>
    </div>
  );
}
