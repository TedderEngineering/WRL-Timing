import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

type Step = 1 | 2 | 3 | 4;

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    totalCars: number;
    maxLap: number;
    totalLapRecords: number;
    classes: string[];
    classCarCounts: Record<string, number>;
  } | null;
}

interface UploadResult {
  raceId: string;
  entriesCreated: number;
  lapsCreated: number;
  warnings: string[];
}

export function AdminUploadPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);

  // Step 1: metadata
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [track, setTrack] = useState("");
  const [series, setSeries] = useState("WRL");
  const [season, setSeason] = useState(String(new Date().getFullYear()));
  const [premium, setPremium] = useState(false);
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">("DRAFT");

  // Step 2: files
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [annFile, setAnnFile] = useState<File | null>(null);
  const [dataJson, setDataJson] = useState<any>(null);
  const [annJson, setAnnJson] = useState<any>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Step 3: validation
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Step 4: result
  const [result, setResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Step 1 validation ──────────────────────────────────────────
  const step1Valid = name.trim() && date && track.trim() && series.trim() && season;

  // ── Step 2: parse files ────────────────────────────────────────
  const handleDataFile = useCallback(async (file: File) => {
    setDataFile(file);
    setFileError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json.cars || !json.maxLap) {
        setFileError('Data file must contain "cars" and "maxLap" fields');
        setDataJson(null);
        return;
      }
      setDataJson(json);
    } catch {
      setFileError("Invalid JSON in data file");
      setDataJson(null);
    }
  }, []);

  const handleAnnFile = useCallback(async (file: File) => {
    setAnnFile(file);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      setAnnJson(json);
    } catch {
      setAnnJson({});
    }
  }, []);

  const step2Valid = dataJson !== null;

  // ── Step 3: validate ───────────────────────────────────────────
  const runValidation = async () => {
    setValidating(true);
    setValidation(null);
    try {
      const res = await api.post<ValidationResult>("/admin/races/validate", {
        metadata: {
          name: name.trim(),
          date,
          track: track.trim(),
          series: series.trim(),
          season: Number(season),
          premium,
          status,
        },
        data: dataJson,
        annotations: annJson || {},
      });
      setValidation(res);
    } catch (err: any) {
      setValidation({
        valid: false,
        errors: [err.message || "Validation request failed"],
        warnings: [],
        stats: null,
      });
    } finally {
      setValidating(false);
    }
  };

  // ── Step 4: commit ─────────────────────────────────────────────
  const commitUpload = async () => {
    setUploading(true);
    setUploadError(null);
    try {
      const res = await api.post<UploadResult>("/admin/races", {
        metadata: {
          name: name.trim(),
          date,
          track: track.trim(),
          series: series.trim(),
          season: Number(season),
          premium,
          status,
        },
        data: dataJson,
        annotations: annJson || {},
      });
      setResult(res);
      setStep(4);
    } catch (err: any) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  // ─── RENDER ────────────────────────────────────────────────────

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">Upload Race Data</h1>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8">
        {[
          { n: 1, label: "Metadata" },
          { n: 2, label: "Files" },
          { n: 3, label: "Validate" },
          { n: 4, label: "Complete" },
        ].map(({ n, label }) => (
          <div key={n} className="flex items-center gap-2 flex-1">
            <div
              className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                step >= n
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-gray-300 dark:border-gray-700 text-gray-400"
              }`}
            >
              {step > n ? "✓" : n}
            </div>
            <span className={`text-xs font-medium hidden sm:inline ${step >= n ? "text-gray-900 dark:text-gray-100" : "text-gray-400"}`}>
              {label}
            </span>
            {n < 4 && <div className={`flex-1 h-0.5 ${step > n ? "bg-brand-500" : "bg-gray-200 dark:bg-gray-800"}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Metadata */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Race Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Barber 8-Hour 2025" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Track *</label>
              <input type="text" value={track} onChange={(e) => setTrack(e.target.value)} placeholder="e.g. Barber Motorsports Park" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Series *</label>
              <input type="text" value={series} onChange={(e) => setSeries(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Season *</label>
              <input type="number" value={season} onChange={(e) => setSeason(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={premium} onChange={(e) => setPremium(e.target.checked)} className="rounded border-gray-300" />
              Premium (Pro only)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-900 text-sm">
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
              </select>
              Initial status
            </label>
          </div>
          <div className="flex justify-end pt-4">
            <button onClick={() => setStep(2)} disabled={!step1Valid} className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed">
              Next: Upload Files →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Files */}
      {step === 2 && (
        <div className="space-y-6">
          <FileDropZone
            label="Race Data JSON *"
            description="The main DATA file containing cars, laps, positions, fcy periods, and class groups."
            file={dataFile}
            accept=".json"
            onFile={handleDataFile}
            valid={dataJson !== null}
          />
          <FileDropZone
            label="Annotations JSON (optional)"
            description="The ANN file with pit markers, settle markers, and lap reasons."
            file={annFile}
            accept=".json"
            onFile={handleAnnFile}
            valid={annJson !== null}
          />
          {fileError && <p className="text-sm text-red-600 dark:text-red-400">⚠ {fileError}</p>}
          {dataJson && (
            <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3">
              <b>Quick peek:</b> {Object.keys(dataJson.cars || {}).length} cars, {dataJson.maxLap} max lap, classes: {Object.keys(dataJson.classGroups || {}).join(", ") || "N/A"}
            </div>
          )}
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900">
              ← Back
            </button>
            <button
              onClick={() => { setStep(3); runValidation(); }}
              disabled={!step2Valid}
              className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next: Validate →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Validate */}
      {step === 3 && (
        <div className="space-y-4">
          {validating ? (
            <div className="flex items-center gap-3 py-8 justify-center">
              <div className="h-6 w-6 border-3 border-brand-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-gray-500 dark:text-gray-400">Validating data…</span>
            </div>
          ) : validation ? (
            <>
              {/* Status */}
              <div className={`rounded-lg p-4 ${validation.valid ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{validation.valid ? "✅" : "❌"}</span>
                  <span className={`font-semibold ${validation.valid ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                    {validation.valid ? "Validation passed" : "Validation failed"}
                  </span>
                </div>
              </div>

              {/* Errors */}
              {validation.errors.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Errors ({validation.errors.length})</h3>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {validation.errors.map((e, i) => (
                      <div key={i} className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-3 py-1.5 rounded">
                        {e}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {validation.warnings.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">Warnings ({validation.warnings.length})</h3>
                  {validation.warnings.map((w, i) => (
                    <div key={i} className="text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-1.5 rounded">
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {/* Stats */}
              {validation.stats && (
                <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Data Summary</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div><span className="text-gray-500">Cars:</span> <b>{validation.stats.totalCars}</b></div>
                    <div><span className="text-gray-500">Max Lap:</span> <b>{validation.stats.maxLap}</b></div>
                    <div><span className="text-gray-500">Lap Records:</span> <b>{validation.stats.totalLapRecords.toLocaleString()}</b></div>
                    <div><span className="text-gray-500">Classes:</span> <b>{validation.stats.classes.join(", ")}</b></div>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">
                    {Object.entries(validation.stats.classCarCounts).map(([c, n]) => `${c}: ${n}`).join(" · ")}
                  </div>
                </div>
              )}

              {/* Upload error */}
              {uploadError && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-4 py-3 rounded-lg">
                  Upload failed: {uploadError}
                </div>
              )}
            </>
          ) : null}

          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900">
              ← Back
            </button>
            <div className="flex gap-2">
              <button onClick={runValidation} disabled={validating} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 disabled:opacity-40">
                Re-validate
              </button>
              <button
                onClick={commitUpload}
                disabled={!validation?.valid || uploading}
                className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {uploading ? "Importing…" : "✓ Commit & Import"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 4 && result && (
        <div className="text-center py-8">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-50 mb-2">Race Imported Successfully</h2>
          <div className="text-gray-600 dark:text-gray-400 mb-6">
            <p>{result.entriesCreated} entries · {result.lapsCreated.toLocaleString()} lap records</p>
            {result.warnings.length > 0 && (
              <p className="text-yellow-600 dark:text-yellow-400 text-sm mt-2">
                {result.warnings.length} warning(s) — data was still imported.
              </p>
            )}
          </div>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => navigate(`/races/${result.raceId}`)}
              className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
            >
              View Chart →
            </button>
            <button
              onClick={() => navigate("/admin/races")}
              className="px-6 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              Manage Races
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── File drop zone ──────────────────────────────────────────────────────────

function FileDropZone({
  label,
  description,
  file,
  accept,
  onFile,
  valid,
}: {
  label: string;
  description: string;
  file: File | null;
  accept: string;
  onFile: (f: File) => void;
  valid: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
        dragOver
          ? "border-brand-500 bg-brand-50 dark:bg-brand-950/20"
          : file
          ? valid
            ? "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/10"
            : "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/10"
          : "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept={accept}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
      <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{description}</div>
      {file ? (
        <div className="flex items-center justify-center gap-2 text-sm">
          <span className={valid ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
            {valid ? "✓" : "✗"}
          </span>
          <span className="text-gray-700 dark:text-gray-300 font-mono">{file.name}</span>
          <span className="text-gray-400">({(file.size / 1024).toFixed(0)} KB)</span>
        </div>
      ) : (
        <div className="text-xs text-gray-400">Drop file here or click to browse</div>
      )}
    </div>
  );
}
