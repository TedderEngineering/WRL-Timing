import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import {
  classifyFiles,
  buildFilesPayload,
  FILE_TYPE_LABELS,
  type RaceGroup,
  type RaceGroupMetadata,
  type DetectedFile,
  type ValidationState,
  type FormatId,
} from "../../lib/file-classifier";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BulkValidateResult {
  groupKey: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: ValidationState["stats"];
  duplicate: boolean;
}

interface BulkImportResult {
  groupKey: string;
  success: boolean;
  raceId?: string;
  entriesCreated?: number;
  lapsCreated?: number;
  warnings?: string[];
  error?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AdminUploadPage() {
  const [groups, setGroups] = useState<Map<string, RaceGroup>>(new Map());
  const [unmatchedFiles, setUnmatchedFiles] = useState<DetectedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);

  // Debounced validation
  const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const validationSeq = useRef(0);

  const hasFiles = groups.size > 0 || unmatchedFiles.length > 0;

  // ── File handling ────────────────────────────────────────────────────────

  const handleFiles = useCallback(
    async (fileList: FileList) => {
      setProcessing(true);
      const { groups: newGroups, unmatched } = await classifyFiles(
        Array.from(fileList),
        groups,
        unmatchedFiles
      );
      setGroups(newGroups);
      setUnmatchedFiles(unmatched);
      setProcessing(false);
      setImportDone(false);
    },
    [groups, unmatchedFiles]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const onFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFiles(e.target.files);
        e.target.value = ""; // allow re-selecting same files
      }
    },
    [handleFiles]
  );

  // ── Metadata editing ────────────────────────────────────────────────────

  const updateMetadata = useCallback(
    (groupId: string, field: keyof RaceGroupMetadata, value: string) => {
      setGroups((prev) => {
        const next = new Map(prev);
        const g = next.get(groupId);
        if (g) {
          next.set(groupId, {
            ...g,
            metadata: { ...g.metadata, [field]: value },
            validation: null, // clear validation on edit
          });
        }
        return next;
      });
    },
    []
  );

  const removeGroup = useCallback((groupId: string) => {
    setGroups((prev) => {
      const next = new Map(prev);
      next.delete(groupId);
      return next;
    });
  }, []);

  const removeUnmatched = useCallback((idx: number) => {
    setUnmatchedFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ── Auto-validation (debounced) ─────────────────────────────────────────

  useEffect(() => {
    if (validateTimer.current) clearTimeout(validateTimer.current);

    const completeGroups = Array.from(groups.values()).filter(
      (g) => g.complete && g.importStatus === "idle" && g.metadata.name.trim()
    );

    // Only validate groups that haven't been validated yet
    const needsValidation = completeGroups.filter((g) => !g.validation);
    if (needsValidation.length === 0) return;

    validateTimer.current = setTimeout(async () => {
      const seq = ++validationSeq.current;

      // Mark as validating
      setGroups((prev) => {
        const next = new Map(prev);
        for (const g of needsValidation) {
          const current = next.get(g.id);
          if (current && !current.validation) {
            next.set(g.id, {
              ...current,
              validation: { status: "validating", errors: [], warnings: [], stats: null, duplicate: false },
            });
          }
        }
        return next;
      });

      try {
        const payload = needsValidation.map((g) => ({
          groupKey: g.id,
          format: g.format,
          metadata: {
            name: g.metadata.name.trim(),
            date: g.metadata.date,
            track: g.metadata.track.trim(),
            series: g.metadata.series.trim(),
            season: Number(g.metadata.season),
            premium: false,
            status: "DRAFT",
          },
          files: buildFilesPayload(g),
        }));

        const res = await api.post<{ results: BulkValidateResult[] }>(
          "/admin/races/validate-bulk",
          { races: payload }
        );

        // Only apply if still the latest sequence
        if (seq !== validationSeq.current) return;

        setGroups((prev) => {
          const next = new Map(prev);
          for (const r of res.results) {
            const current = next.get(r.groupKey);
            if (current) {
              next.set(r.groupKey, {
                ...current,
                validation: {
                  status: r.valid ? (r.warnings.length > 0 ? "warning" : "valid") : "invalid",
                  errors: r.errors,
                  warnings: r.warnings,
                  stats: r.stats,
                  duplicate: r.duplicate,
                },
              });
            }
          }
          return next;
        });
      } catch {
        if (seq !== validationSeq.current) return;
        setGroups((prev) => {
          const next = new Map(prev);
          for (const g of needsValidation) {
            const current = next.get(g.id);
            if (current) {
              next.set(g.id, {
                ...current,
                validation: {
                  status: "invalid",
                  errors: ["Validation request failed"],
                  warnings: [],
                  stats: null,
                  duplicate: false,
                },
              });
            }
          }
          return next;
        });
      }
    }, 500);

    return () => {
      if (validateTimer.current) clearTimeout(validateTimer.current);
    };
  }, [groups]);

  // ── Bulk import ─────────────────────────────────────────────────────────

  const importableGroups = Array.from(groups.values()).filter(
    (g) =>
      g.complete &&
      g.importStatus === "idle" &&
      g.validation?.status !== "invalid" &&
      g.validation?.status !== "validating" &&
      g.metadata.name.trim()
  );

  const handleImport = useCallback(async () => {
    if (importableGroups.length === 0) return;
    setImporting(true);

    // Mark importing
    setGroups((prev) => {
      const next = new Map(prev);
      for (const g of importableGroups) {
        const current = next.get(g.id);
        if (current) next.set(g.id, { ...current, importStatus: "importing" });
      }
      return next;
    });

    try {
      const payload = importableGroups.map((g) => ({
        groupKey: g.id,
        format: g.format,
        metadata: {
          name: g.metadata.name.trim(),
          date: g.metadata.date,
          track: g.metadata.track.trim(),
          series: g.metadata.series.trim(),
          season: Number(g.metadata.season),
          premium: false,
          status: "DRAFT",
        },
        files: buildFilesPayload(g),
      }));

      const res = await api.post<{ results: BulkImportResult[] }>(
        "/admin/races/import-bulk",
        { races: payload }
      );

      setGroups((prev) => {
        const next = new Map(prev);
        for (const r of res.results) {
          const current = next.get(r.groupKey);
          if (current) {
            if (r.success) {
              next.set(r.groupKey, {
                ...current,
                importStatus: "success",
                importResult: {
                  raceId: r.raceId!,
                  entriesCreated: r.entriesCreated!,
                  lapsCreated: r.lapsCreated!,
                },
              });
            } else {
              next.set(r.groupKey, {
                ...current,
                importStatus: "error",
                importError: r.error || "Import failed",
              });
            }
          }
        }
        return next;
      });
    } catch (err: any) {
      setGroups((prev) => {
        const next = new Map(prev);
        for (const g of importableGroups) {
          const current = next.get(g.id);
          if (current && current.importStatus === "importing") {
            next.set(g.id, {
              ...current,
              importStatus: "error",
              importError: err.message || "Network error",
            });
          }
        }
        return next;
      });
    } finally {
      setImporting(false);
      setImportDone(true);
    }
  }, [importableGroups]);

  // ── Derived state ───────────────────────────────────────────────────────

  const groupsList = Array.from(groups.values());
  const successCount = groupsList.filter((g) => g.importStatus === "success").length;
  const errorCount = groupsList.filter((g) => g.importStatus === "error").length;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="p-6 lg:p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">Upload Race Data</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Drop files to auto-detect format, group, and import races.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={`relative border-2 border-dashed rounded-xl text-center transition-colors ${
          hasFiles ? "p-6 mb-4" : "p-16 mb-6"
        } ${
          dragOver
            ? "border-brand-500 bg-brand-50 dark:bg-brand-950/20"
            : "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".json,.csv,.pdf"
          multiple
          onChange={onFileInput}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
        {!hasFiles && <div className="text-4xl mb-3 opacity-40">📁</div>}
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {processing
            ? "Processing files..."
            : hasFiles
              ? "Drop more files here to add them"
              : "Drop .json, .csv, and .pdf files here"}
        </div>
        {!hasFiles && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Supports IMSA JSON, SpeedHive CSV, and WRL Website CSV (Summary + All Laps)
          </div>
        )}
      </div>

      {/* Race groups */}
      {groupsList.length > 0 && (
        <div className="space-y-3 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Detected Races ({groupsList.length})
          </h2>
          {groupsList.map((group) => (
            <RaceGroupCard
              key={group.id}
              group={group}
              onUpdateMetadata={(field, value) => updateMetadata(group.id, field, value)}
              onRemove={() => removeGroup(group.id)}
            />
          ))}
        </div>
      )}

      {/* Unmatched files */}
      {unmatchedFiles.length > 0 && (
        <div className="space-y-2 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Unmatched Files ({unmatchedFiles.length})
          </h2>
          <div className="border border-gray-200 dark:border-gray-800 rounded-lg divide-y divide-gray-200 dark:divide-gray-800">
            {unmatchedFiles.map((df, idx) => (
              <div key={idx} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <span className="text-sm font-mono text-gray-700 dark:text-gray-300">
                    {df.file.name}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">
                    ({(df.file.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <button
                  onClick={() => removeUnmatched(idx)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasFiles && !processing && (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
          No files dropped yet. Drag files above or click to browse.
        </div>
      )}

      {/* Import done summary */}
      {importDone && (successCount > 0 || errorCount > 0) && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 mb-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Import Complete
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {successCount > 0 && (
              <span className="text-green-600 dark:text-green-400">
                {successCount} imported successfully
              </span>
            )}
            {successCount > 0 && errorCount > 0 && " · "}
            {errorCount > 0 && (
              <span className="text-red-600 dark:text-red-400">{errorCount} failed</span>
            )}
          </p>
        </div>
      )}

      {/* Sticky bottom action bar */}
      {groupsList.length > 0 && (
        <div className="sticky bottom-0 bg-white dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 -mx-6 lg:-mx-8 px-6 lg:px-8 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {importableGroups.length} race{importableGroups.length !== 1 ? "s" : ""} ready
            {groupsList.some((g) => !g.complete) && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · {groupsList.filter((g) => !g.complete).length} incomplete
              </span>
            )}
          </div>
          <button
            onClick={handleImport}
            disabled={importableGroups.length === 0 || importing}
            className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {importing
              ? "Importing..."
              : `Import ${importableGroups.length} Race${importableGroups.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Race Group Card ─────────────────────────────────────────────────────────

function RaceGroupCard({
  group,
  onUpdateMetadata,
  onRemove,
}: {
  group: RaceGroup;
  onUpdateMetadata: (field: keyof RaceGroupMetadata, value: string) => void;
  onRemove: () => void;
}) {
  const needsTrack = (group.format === "speedhive" || group.format === "wrl-website") && !group.metadata.track.trim();
  const [expanded, setExpanded] = useState(needsTrack);

  const formatColors: Record<FormatId, string> = {
    imsa: "bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400",
    speedhive: "bg-purple-100 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400",
    "wrl-website": "bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400",
  };

  const borderColor =
    group.importStatus === "success"
      ? "border-green-400 dark:border-green-700"
      : group.importStatus === "error"
        ? "border-red-400 dark:border-red-700"
        : group.importStatus === "importing"
          ? "border-brand-400 dark:border-brand-600"
          : !group.complete
            ? "border-amber-300 dark:border-amber-800"
            : "border-gray-200 dark:border-gray-800";

  const fileEntries = Array.from(group.files.entries());
  const v = group.validation;

  return (
    <div className={`border rounded-xl transition-colors ${borderColor}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${formatColors[group.format]}`}>
              {group.format === "imsa" ? "IMSA" : group.format === "wrl-website" ? "WRL Website" : "SpeedHive"}
            </span>
            <ValidationBadge validation={v} />
            {!group.complete && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400">
                Missing: {group.missingRequired.join(", ")}
              </span>
            )}
            {v?.duplicate && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400">
                Duplicate
              </span>
            )}
            {group.importStatus === "success" && (
              <span className="text-green-600 dark:text-green-400 text-xs font-semibold">
                Imported
              </span>
            )}
            {group.importStatus === "importing" && (
              <span className="text-brand-600 dark:text-brand-400 text-xs">Importing...</span>
            )}
            {group.importStatus === "error" && (
              <span className="text-red-600 dark:text-red-400 text-xs font-semibold">Failed</span>
            )}
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1 truncate">
            {group.metadata.name || "Unnamed Race"}
          </h3>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {group.metadata.track ? (
              <span>{group.metadata.track}</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 font-medium">No track</span>
            )}
            {group.metadata.date && <span> · {group.metadata.date}</span>}
            {group.metadata.series && <span> · {group.metadata.series}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {group.importStatus === "idle" && (
            <>
              <button
                onClick={() => setExpanded(!expanded)}
                className="px-2.5 py-1 text-xs border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                {expanded ? "Collapse" : "Edit"}
              </button>
              <button
                onClick={onRemove}
                className="px-2 py-1 text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </>
          )}
          {group.importStatus === "success" && group.importResult && (
            <Link
              to={`/races/${group.importResult.raceId}`}
              className="px-3 py-1 text-xs bg-brand-600 text-white rounded-lg hover:bg-brand-700"
            >
              View Chart
            </Link>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && group.importStatus === "idle" && (
        <div className="border-t border-gray-200 dark:border-gray-800 p-4 space-y-3">
          {/* Metadata fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Race Name *
              </label>
              <input
                type="text"
                value={group.metadata.name}
                onChange={(e) => onUpdateMetadata("name", e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            <div>
              <label
                className={`block text-xs font-medium mb-1 ${
                  needsTrack
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                Track *{needsTrack && " (required)"}
              </label>
              <input
                type="text"
                value={group.metadata.track}
                onChange={(e) => onUpdateMetadata("track", e.target.value)}
                placeholder="e.g. Barber Motorsports Park"
                className={`w-full px-2.5 py-1.5 border rounded-lg bg-white dark:bg-gray-900 text-sm ${
                  needsTrack
                    ? "border-amber-400 dark:border-amber-600 ring-1 ring-amber-200 dark:ring-amber-800"
                    : "border-gray-300 dark:border-gray-700"
                }`}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Date
              </label>
              <input
                type="date"
                value={group.metadata.date}
                onChange={(e) => onUpdateMetadata("date", e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Series
              </label>
              <input
                type="text"
                value={group.metadata.series}
                onChange={(e) => onUpdateMetadata("series", e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Season
              </label>
              <input
                type="number"
                value={group.metadata.season}
                onChange={(e) => onUpdateMetadata("season", e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
              />
            </div>
          </div>

          {/* File list */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Files
            </label>
            <div className="space-y-1">
              {fileEntries.map(([type, df]) => (
                <div key={type} className="flex items-center gap-2 text-sm">
                  <span className="text-green-500">&#10003;</span>
                  <span className="text-gray-600 dark:text-gray-400">
                    {FILE_TYPE_LABELS[type]}
                  </span>
                  <span className="font-mono text-xs text-gray-400 truncate">
                    ({df.file.name})
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Validation details */}
          {v && v.status !== "validating" && (
            <div className="space-y-2">
              {v.errors.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {v.errors.map((e, i) => (
                    <div
                      key={i}
                      className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 px-3 py-1.5 rounded"
                    >
                      {e}
                    </div>
                  ))}
                </div>
              )}
              {v.warnings.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {v.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 px-3 py-1.5 rounded"
                    >
                      {w}
                    </div>
                  ))}
                </div>
              )}
              {v.stats && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {v.stats.totalCars} cars · {v.stats.maxLap} laps ·{" "}
                  {v.stats.totalLapRecords.toLocaleString()} records · {v.stats.fcyPeriods} FCY
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error message */}
      {group.importError && (
        <div className="border-t border-red-200 dark:border-red-900 px-4 py-2.5">
          <div className="text-sm text-red-600 dark:text-red-400">{group.importError}</div>
        </div>
      )}

      {/* Success result */}
      {group.importResult && (
        <div className="border-t border-green-200 dark:border-green-900 px-4 py-2.5">
          <div className="text-sm text-green-600 dark:text-green-400">
            {group.importResult.entriesCreated} entries ·{" "}
            {group.importResult.lapsCreated.toLocaleString()} laps
          </div>
        </div>
      )}

      {/* Collapsed file summary */}
      {!expanded && group.importStatus === "idle" && (
        <div className="border-t border-gray-100 dark:border-gray-900 px-4 py-2">
          <div className="flex items-center gap-3 text-xs text-gray-400">
            {fileEntries.map(([type]) => (
              <span key={type}>{FILE_TYPE_LABELS[type]}</span>
            ))}
            {v?.stats && (
              <span className="ml-auto">
                {v.stats.totalCars} cars · {v.stats.maxLap} laps
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Validation badge ────────────────────────────────────────────────────────

function ValidationBadge({ validation }: { validation: ValidationState | null }) {
  if (!validation) return null;

  switch (validation.status) {
    case "validating":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
          <span className="h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          Validating
        </span>
      );
    case "valid":
      return <span className="text-xs text-green-600 dark:text-green-400 font-medium">&#10003; Valid</span>;
    case "warning":
      return <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">&#9888; Warnings</span>;
    case "invalid":
      return <span className="text-xs text-red-600 dark:text-red-400 font-medium">&#10007; Invalid</span>;
  }
}
