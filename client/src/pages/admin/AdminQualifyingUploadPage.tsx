import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, fetchEvents } from "../../lib/api";
import type { EventSummary } from "@shared/types";

export function AdminQualifyingUploadPage() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [date, setDate] = useState("");
  const [track, setTrack] = useState("");
  const [series, setSeries] = useState("Toyota GR Cup");
  const [season, setSeason] = useState(String(new Date().getFullYear()));
  const [eventId, setEventId] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);

  const [events, setEvents] = useState<EventSummary[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; carCount: number; lapCount: number } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch events for dropdown
  useEffect(() => {
    fetchEvents()
      .then((res) => setEvents(res.events))
      .catch(() => {})
      .finally(() => setEventsLoading(false));
  }, []);

  // Auto-fill track/series/season when event is selected
  const handleEventChange = (id: string) => {
    setEventId(id);
    const ev = events.find((e) => e.id === id);
    if (ev) {
      setTrack(ev.track);
      setSeason(ev.season);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvFile) { setError("Select a CSV file"); return; }
    if (!eventId) { setError("Select an event"); return; }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const csvText = await csvFile.text();

      const res = await api.post<{ id: string; name: string; carCount: number; lapCount: number }>(
        "/admin/qualifying",
        {
          metadata: { name, sessionName, date, track, series, season, eventId },
          timecards: csvText,
        }
      );

      setResult({ id: res.id, carCount: res.carCount, lapCount: res.lapCount });
    } catch (err: any) {
      setError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const inputClass =
    "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";
  const labelClass = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">
        Upload Qualifying Session
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Event (required) */}
        <div>
          <label className={labelClass}>Event *</label>
          <select
            className={inputClass}
            value={eventId}
            onChange={(e) => handleEventChange(e.target.value)}
            required
          >
            <option value="">
              {eventsLoading ? "Loading events..." : "Select an event"}
            </option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} — {ev.track} ({ev.series} {ev.season})
              </option>
            ))}
          </select>
        </div>

        {/* Name */}
        <div>
          <label className={labelClass}>Session Name (display)</label>
          <input
            type="text"
            className={inputClass}
            placeholder="Qualify 2 — Barber 2026"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        {/* Session identifier */}
        <div>
          <label className={labelClass}>Session Identifier</label>
          <input
            type="text"
            className={inputClass}
            placeholder="Qualify 2"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            required
          />
        </div>

        {/* Date + Track row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Date</label>
            <input
              type="date"
              className={inputClass}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Track</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Barber Motorsports Park"
              value={track}
              onChange={(e) => setTrack(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Series + Season row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Series</label>
            <select
              className={inputClass}
              value={series}
              onChange={(e) => setSeries(e.target.value)}
            >
              <option value="Toyota GR Cup">Toyota GR Cup</option>
              <option value="SRO GT4 America">SRO GT4 America</option>
              <option value="IMSA">IMSA</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Season</label>
            <input
              type="number"
              className={inputClass}
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              required
            />
          </div>
        </div>

        {/* CSV file upload */}
        <div>
          <label className={labelClass}>Time Cards CSV (23_Time Cards_Qualify...)</label>
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-brand-400 dark:hover:border-brand-500"
            style={{
              borderColor: csvFile ? "#4ade80" : undefined,
              background: csvFile ? "rgba(74,222,128,0.05)" : undefined,
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setCsvFile(file);
              }}
            />
            {csvFile ? (
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                {csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)
              </p>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Click to select CSV file or drag & drop
              </p>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Success */}
        {result && (
          <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-700 dark:text-green-400">
            <p className="font-medium">Qualifying session created</p>
            <p className="mt-1">
              {result.carCount} cars, {result.lapCount} laps parsed.
            </p>
            <button
              type="button"
              onClick={() => navigate(`/qualifying/${result.id}`)}
              className="mt-2 text-brand-600 dark:text-brand-400 hover:underline font-medium"
            >
              View session
            </button>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={uploading || !csvFile || !eventId}
          className="self-start px-6 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
        >
          {uploading ? "Uploading..." : "Upload Qualifying Session"}
        </button>
      </form>
    </div>
  );
}
