import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";

type Step = 1 | 2 | 3 | 4;

interface FileSlot {
  key: string;
  label: string;
  description: string;
  required: boolean;
}

interface FormatInfo {
  id: string;
  name: string;
  series: string;
  description: string;
  implemented: boolean;
  fileSlots: FileSlot[];
}

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
    fcyPeriods: number;
    greenPaceCutoff: number;
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

  // Available formats (loaded from API)
  const [formats, setFormats] = useState<FormatInfo[]>([]);
  const [formatsLoading, setFormatsLoading] = useState(true);

  // Step 1: metadata + format
  const [format, setFormat] = useState("");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [track, setTrack] = useState("");
  const [series, setSeries] = useState("");
  const [season, setSeason] = useState(String(new Date().getFullYear()));
  const [premium, setPremium] = useState(false);
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">("DRAFT");

  // Step 2: files (keyed by slot key)
  const [fileMap, setFileMap] = useState<Record<string, File | null>>({});
  const [csvMap, setCsvMap] = useState<Record<string, string | null>>({});
  const [previewMap, setPreviewMap] = useState<Record<string, string | null>>({});
  const [fileError, setFileError] = useState<string | null>(null);

  // Step 3: validation
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);

  // Step 4: result
  const [result, setResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Load available formats
  useEffect(() => {
    api
      .get<{ formats: FormatInfo[] }>("/admin/formats")
      .then((res) => {
        setFormats(res.formats);
        const first = res.formats.find((f) => f.implemented);
        if (first) {
          setFormat(first.id);
          setSeries(first.series);
        }
      })
      .catch(() => {})
      .finally(() => setFormatsLoading(false));
  }, []);

  const selectedFormat = formats.find((f) => f.id === format);

  const handleFormatChange = (fmtId: string) => {
    setFormat(fmtId);
    setFileMap({});
    setCsvMap({});
    setPreviewMap({});
    setFileError(null);
    const fmt = formats.find((f) => f.id === fmtId);
    if (fmt) setSeries(fmt.series);
  };

  const step1Valid =
    format && name.trim() && date && track.trim() && series.trim() && season && selectedFormat?.implemented;

  const handleFile = useCallback(async (slotKey: string, file: File) => {
    setFileMap((prev) => ({ ...prev, [slotKey]: file }));
    setFileError(null);
    try {
      const text = await file.text();
      setCsvMap((prev) => ({ ...prev, [slotKey]: text }));
      const lines = text.split("\n").slice(0, 4);
      setPreviewMap((prev) => ({ ...prev, [slotKey]: lines.join("\n") }));
    } catch {
      setFileError(`Could not read file for ${slotKey}`);
      setCsvMap((prev) => ({ ...prev, [slotKey]: null }));
    }
  }, []);

  const step2Valid =
    selectedFormat?.fileSlots.every(
      (slot) => !slot.required || csvMap[slot.key]
    ) ?? false;

  const runValidation = async () => {
    setValidating(true);
    setValidation(null);
    try {
      const files: Record<string, string> = {};
      for (const [key, csv] of Object.entries(csvMap)) {
        if (csv) files[key] = csv;
      }
      const res = await api.post<ValidationResult>("/admin/races/import/validate", {
        metadata: { name: name.trim(), date, track: track.trim(), series: series.trim(), season: Number(season), premium, status },
        format,
        files,
      });
      setValidation(res);
    } catch (err: any) {
      setValidation({ valid: false, errors: [err.message || "Validation request failed"], warnings: [], stats: null });
    } finally {
      setValidating(false);
    }
  };

  const commitUpload = async () => {
    setUploading(true);
    setUploadError(null);
    try {
      const files: Record<string, string> = {};
      for (const [key, csv] of Object.entries(csvMap)) {
        if (csv) files[key] = csv;
      }
      const res = await api.post<UploadResult>("/admin/races/import", {
        metadata: { name: name.trim(), date, track: track.trim(), series: series.trim(), season: Number(season), premium, status },
        format,
        files,
      });
      setResult(res);
      setStep(4);
    } catch (err: any) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-2">Upload Race Data</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Import race data from supported timing systems.</p>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-8">
        {[{ n: 1, label: "Format & Info" }, { n: 2, label: "Data Files" }, { n: 3, label: "Validate" }, { n: 4, label: "Complete" }].map(({ n, label }) => (
          <div key={n} className="flex items-center gap-2 flex-1">
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${step >= n ? "border-brand-600 bg-brand-600 text-white" : "border-gray-300 dark:border-gray-700 text-gray-400"}`}>
              {step > n ? "✓" : n}
            </div>
            <span className={`text-xs font-medium hidden sm:inline ${step >= n ? "text-gray-900 dark:text-gray-100" : "text-gray-400"}`}>{label}</span>
            {n < 4 && <div className={`flex-1 h-0.5 ${step > n ? "bg-brand-500" : "bg-gray-200 dark:bg-gray-800"}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Format + Metadata */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Data Format *</label>
            {formatsLoading ? (
              <div className="h-20 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
            ) : (
              <div className="grid gap-2">
                {formats.map((fmt) => (
                  <button
                    key={fmt.id}
                    onClick={() => handleFormatChange(fmt.id)}
                    disabled={!fmt.implemented}
                    className={`text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                      format === fmt.id
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-950/20"
                        : fmt.implemented
                        ? "border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700"
                        : "border-gray-100 dark:border-gray-900 opacity-60 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{fmt.name}</span>
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{fmt.series}</span>
                      </div>
                      {!fmt.implemented && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">Coming Soon</span>
                      )}
                      {format === fmt.id && fmt.implemented && (
                        <span className="text-brand-600 dark:text-brand-400 text-sm">✓</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{fmt.description}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Race Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Barber 7-Hour Sunday" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm" />
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
          <div className="flex justify-end pt-2">
            <button onClick={() => setStep(2)} disabled={!step1Valid} className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed">
              Next: Upload Files →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Data Files */}
      {step === 2 && selectedFormat && (
        <div className="space-y-6">
          <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 rounded-lg px-4 py-3">
            Uploading as <b>{selectedFormat.name}</b> format. {selectedFormat.fileSlots.length} file(s) expected.
          </div>
          {selectedFormat.fileSlots.map((slot) => (
            <FileDropZone
              key={slot.key}
              label={`${slot.label}${slot.required ? " *" : " (optional)"}`}
              description={slot.description}
              file={fileMap[slot.key] || null}
              accept=".csv"
              onFile={(f) => handleFile(slot.key, f)}
              valid={csvMap[slot.key] !== null && csvMap[slot.key] !== undefined}
              preview={previewMap[slot.key] || null}
            />
          ))}
          {fileError && <p className="text-sm text-red-600 dark:text-red-400">⚠ {fileError}</p>}
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900">← Back</button>
            <button onClick={() => { setStep(3); runValidation(); }} disabled={!step2Valid} className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed">
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
              <span className="text-gray-500 dark:text-gray-400">Parsing and validating data…</span>
            </div>
          ) : validation ? (
            <>
              <div className={`rounded-lg p-4 ${validation.valid ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"}`}>
                <div className="flex items-center gap-2">
                  <span className="text-lg">{validation.valid ? "✅" : "❌"}</span>
                  <span className={`font-semibold ${validation.valid ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                    {validation.valid ? "Data parsed and validated successfully" : "Validation failed"}
                  </span>
                </div>
              </div>
              {validation.errors.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Errors ({validation.errors.length})</h3>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {validation.errors.map((e, i) => (
                      <div key={i} className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-3 py-1.5 rounded">{e}</div>
                    ))}
                  </div>
                </div>
              )}
              {validation.warnings.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">Warnings ({validation.warnings.length})</h3>
                  {validation.warnings.map((w, i) => (
                    <div key={i} className="text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-1.5 rounded">{w}</div>
                  ))}
                </div>
              )}
              {validation.stats && (
                <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Parsed Data Summary</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div><span className="text-gray-500">Cars:</span> <b>{validation.stats.totalCars}</b></div>
                    <div><span className="text-gray-500">Max Lap:</span> <b>{validation.stats.maxLap}</b></div>
                    <div><span className="text-gray-500">Lap Records:</span> <b>{validation.stats.totalLapRecords.toLocaleString()}</b></div>
                    <div><span className="text-gray-500">FCY Periods:</span> <b>{validation.stats.fcyPeriods}</b></div>
                  </div>
                  <div className="mt-2 text-xs text-gray-500">Classes: {Object.entries(validation.stats.classCarCounts).map(([c, n]) => `${c}: ${n}`).join(" · ")}</div>
                  <div className="mt-1 text-xs text-gray-500">Green pace cutoff: {validation.stats.greenPaceCutoff}s</div>
                </div>
              )}
              {uploadError && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-4 py-3 rounded-lg">Import failed: {uploadError}</div>
              )}
            </>
          ) : null}
          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900">← Back</button>
            <div className="flex gap-2">
              <button onClick={runValidation} disabled={validating} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 disabled:opacity-40">Re-validate</button>
              <button onClick={commitUpload} disabled={!validation?.valid || uploading} className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {uploading ? "Importing…" : "✓ Import Race Data"}
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
              <p className="text-yellow-600 dark:text-yellow-400 text-sm mt-2">{result.warnings.length} warning(s) — data was still imported.</p>
            )}
          </div>
          <div className="flex justify-center gap-3">
            <button onClick={() => navigate(`/races/${result.raceId}`)} className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">View Chart →</button>
            <button onClick={() => navigate("/admin/races")} className="px-6 py-2.5 border border-gray-300 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-900">Manage Races</button>
          </div>
        </div>
      )}
    </div>
  );
}

function FileDropZone({ label, description, file, accept, onFile, valid, preview }: {
  label: string; description: string; file: File | null; accept: string;
  onFile: (f: File) => void; valid: boolean; preview: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <div>
      <div
        className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
          dragOver ? "border-brand-500 bg-brand-50 dark:bg-brand-950/20"
          : file ? (valid ? "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/10" : "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/10")
          : "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input type="file" accept={accept} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="absolute inset-0 opacity-0 cursor-pointer" />
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{description}</div>
        {file ? (
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className={valid ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>{valid ? "✓" : "✗"}</span>
            <span className="text-gray-700 dark:text-gray-300 font-mono">{file.name}</span>
            <span className="text-gray-400">({(file.size / 1024).toFixed(0)} KB)</span>
          </div>
        ) : (
          <div className="text-xs text-gray-400">Drop .csv file here or click to browse</div>
        )}
      </div>
      {preview && (
        <div className="mt-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 overflow-x-auto">
          <pre className="text-[10px] text-gray-500 dark:text-gray-400 font-mono leading-tight whitespace-pre">{preview}</pre>
        </div>
      )}
    </div>
  );
}
