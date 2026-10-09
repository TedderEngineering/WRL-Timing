import { useRef, useState, type FormEvent } from "react";
import { ApiClientError } from "@/lib/api";
import { gripApi, type Track } from "@/features/grip/api";
import { useGrip } from "@/features/grip/GripContext";
import { useLoad } from "@/features/grip/hooks";
import {
  Card,
  Eyebrow,
  Field,
  GripButton,
  Note,
  PageHeader,
  Pill,
  Spinner,
  TrackBadge,
} from "@/features/grip/components";

function SetupRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Pill tone={ok ? "ok" : "warn"}>{ok ? "Ready" : "To do"}</Pill>
      <div className="min-w-0">
        <div className="font-semibold text-gray-900 dark:text-gray-100">{label}</div>
        <div className="text-sm text-gray-600 dark:text-gray-400 break-words">
          {detail}
        </div>
      </div>
    </div>
  );
}

const ACCESS_TEXT = {
  off: "Off. Nobody can use Finding Grip.",
  admin: "Admins only.",
  testers: "Admins and the tester list.",
  public: "Open to every account.",
} as const;

export function GripAdminPage() {
  const { toast, refresh } = useGrip();
  const overview = useLoad(() => gripApi.admin.overview());
  const tracks = useLoad(() => gripApi.admin.tracks());
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importProblems, setImportProblems] = useState<string[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newShort, setNewShort] = useState("");
  const [trackError, setTrackError] = useState<string | null>(null);
  const [savingTrack, setSavingTrack] = useState(false);

  const importDamper = async (file: File) => {
    setImporting(true);
    setImportProblems(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const body = Array.isArray(parsed) ? { scenarios: parsed } : parsed;
      const { rows } = await gripApi.admin.replaceDamperTable(body);
      toast(`Damper table loaded: ${rows} scenarios`);
      await Promise.all([overview.reload(), refresh()]);
    } catch (err) {
      if (err instanceof ApiClientError) {
        const payload = err.payload as
          | { problems?: string[]; details?: { field: string; message: string }[] }
          | undefined;
        setImportProblems(
          payload?.problems ??
            payload?.details?.slice(0, 10).map((d) => `${d.field}: ${d.message}`) ?? [
              err.message,
            ]
        );
      } else {
        setImportProblems(["That file is not valid JSON."]);
      }
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addTrack = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newShort.trim()) {
      setTrackError("Enter a name and a short code.");
      return;
    }
    setSavingTrack(true);
    setTrackError(null);
    try {
      await gripApi.admin.addTrack({ name: newName.trim(), shortName: newShort.trim() });
      setNewName("");
      setNewShort("");
      toast("Track added");
      await Promise.all([tracks.reload(), overview.reload()]);
    } catch (err) {
      setTrackError(err instanceof Error ? err.message : "Could not add track");
    } finally {
      setSavingTrack(false);
    }
  };

  const toggleTrack = async (t: Track) => {
    try {
      await gripApi.admin.updateTrack(t.id, {
        name: t.name,
        shortName: t.shortName,
        isActive: !t.isActive,
      });
      toast(t.isActive ? "Track deactivated" : "Track activated");
      await Promise.all([tracks.reload(), overview.reload()]);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not update track");
    }
  };

  if (overview.loading) return <Spinner />;
  if (overview.error || !overview.data) {
    return (
      <div className="container-page">
        <Card className="text-sm text-red-600 dark:text-red-400">
          {overview.error ?? "Could not load"}
        </Card>
      </div>
    );
  }
  const { counts, setup } = overview.data;

  return (
    <div className="container-page space-y-6">
      <PageHeader
        title="Finding Grip admin"
        subtitle="Setup status, tracks and the damper table. Users and the audit log are in the main admin panel."
      />

      <div
        className={`grid gap-3 grid-cols-2 ${setup.pricing === "paid" ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
      >
        {[
          ["Accounts", counts.accounts],
          ...(setup.pricing === "paid" ? [["Pro subscribers", counts.pro]] : []),
          ["Reference sessions", counts.sessions],
          ["Calculations", counts.calculations],
          ["Active tracks", counts.tracks],
        ].map(([label, value]) => (
          <Card key={label as string}>
            <Eyebrow>{label}</Eyebrow>
            <div className="mt-1 text-2xl font-extrabold tabular-nums text-gray-900 dark:text-gray-50">
              {(value as number).toLocaleString()}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="font-bold text-gray-900 dark:text-gray-50 mb-1">Setup</h2>
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          <SetupRow
            ok={setup.access !== "off"}
            label="Who can use it"
            detail={`${ACCESS_TEXT[setup.access]}${setup.access === "testers" ? ` ${setup.testerCount} tester email(s) listed.` : ""} Set with GRIP_ACCESS on the server.`}
          />
          <SetupRow
            ok={setup.calcModel.ready}
            label="Calculation model"
            detail={
              setup.calcModel.ready
                ? `Loaded${setup.calcModel.version ? ` (version ${setup.calcModel.version})` : ""}.`
                : `${setup.calcModel.problem ?? "Not configured"}. Set GRIP_CALC_MODEL on the server.`
            }
          />
          <SetupRow
            ok={setup.damperTable.ready}
            label="Damper table"
            detail={`${setup.damperTable.rows} of ${setup.damperTable.expected} scenarios loaded.`}
          />
          {setup.pricing === "paid" ? (
            <SetupRow
              ok={setup.stripePrice.ready}
              label="Pro price"
              detail={
                setup.stripePrice.ready
                  ? "Stripe price configured. Checkout is available."
                  : "Set STRIPE_GRIP_PRO_PRICE_ID on the server to switch checkout on."
              }
            />
          ) : (
            <SetupRow
              ok
              label="Pricing"
              detail="Free for every account: no calculation limit, damper tool included. Set GRIP_PRICING=paid on the server to bring back Free and Pro plans."
            />
          )}
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold text-gray-900 dark:text-gray-50">Damper table</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Load the full table from its private JSON file. The upload replaces every
          scenario and is rejected unless all {setup.damperTable.expected} input
          combinations are present exactly once.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && importDamper(e.target.files[0])}
        />
        <div>
          <GripButton
            variant="secondary"
            loading={importing}
            onClick={() => fileRef.current?.click()}
          >
            {setup.damperTable.rows > 0 ? "Replace damper table…" : "Load damper table…"}
          </GripButton>
        </div>
        {importProblems && (
          <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">
            <b>The table was not loaded.</b>
            <ul className="mt-1 list-disc pl-5">
              {importProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        <Note>The table is proprietary. Keep the file out of the code repository.</Note>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-bold text-gray-900 dark:text-gray-50">Tracks</h2>
        <form
          onSubmit={addTrack}
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end"
        >
          <Field
            id="track-name"
            label="Track name"
            value={newName}
            onChange={setNewName}
            placeholder="e.g. Road Atlanta"
          />
          <Field
            id="track-short"
            label="Short code"
            value={newShort}
            onChange={setNewShort}
            placeholder="ATL"
          />
          <GripButton type="submit" loading={savingTrack}>
            Add track
          </GripButton>
        </form>
        {trackError && (
          <p className="text-sm text-red-600 dark:text-red-400">{trackError}</p>
        )}
        {tracks.loading ? (
          <Spinner />
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {(tracks.data ?? []).map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
              >
                <div className="flex items-center gap-3 min-w-0 basis-full sm:basis-0 sm:flex-1">
                  <TrackBadge track={t} />
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 break-words">
                      {t.name}
                    </div>
                    {!t.isActive && (
                      <div className="text-xs text-gray-500">
                        Hidden from the session form. Past sessions keep it.
                      </div>
                    )}
                  </div>
                </div>
                <Pill tone={t.isActive ? "ok" : "neutral"}>
                  {t.isActive ? "Active" : "Inactive"}
                </Pill>
                <GripButton size="sm" variant="ghost" onClick={() => toggleTrack(t)}>
                  {t.isActive ? "Deactivate" : "Activate"}
                </GripButton>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
