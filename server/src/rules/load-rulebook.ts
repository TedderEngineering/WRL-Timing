/**
 * Rulebook loading: parse YAML, validate (JSON Schema + the checks JSON Schema cannot express, as in
 * stage2/rules/tools/validate_rulebooks.py), select by series / season / event, and resolve the layers
 * series -> class -> event -> event-class (RULEBOOK_FORMAT.md §5.1).
 *
 * No database access. Pure functions plus file reads.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import { parse as parseYaml } from "yaml";
import type {
  EventDef,
  OverrideDef,
  ProvenanceLayer,
  ResolvedRule,
  ResolvedRulebook,
  Rulebook,
  RuleDef,
  Severity,
  SourceRef,
  TbdEntry,
} from "./rulebook-types.js";

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  possible: 1,
  likely: 2,
};

const HERE = dirname(fileURLToPath(import.meta.url));

/** Directory holding the bundled rulebooks (`server/src/rules/rulebooks`). */
export function defaultRulebookDir(): string {
  const local = join(HERE, "rulebooks");
  if (existsSync(local)) return local;
  // dist build: YAML files are not copied by tsc; fall back to the source tree.
  const src = join(process.cwd(), "src", "rules", "rulebooks");
  return existsSync(src) ? src : local;
}

export class RulebookError extends Error {
  constructor(
    message: string,
    public readonly errors: string[] = []
  ) {
    super(errors.length ? `${message}:\n  ${errors.join("\n  ")}` : message);
    this.name = "RulebookError";
  }
}

// ─── validation ────────────────────────────────────────────────────────────

let validator: ((d: unknown) => boolean) & { errors?: ErrorObject[] | null } =
  null as never;

function schemaValidator(dir: string) {
  if (validator) return validator;
  const schemaPath = join(dir, "rulebook.schema.json");
  const fallback = join(defaultRulebookDir(), "rulebook.schema.json");
  const schema = JSON.parse(
    readFileSync(existsSync(schemaPath) ? schemaPath : fallback, "utf8")
  );
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  validator = ajv.compile(schema);
  return validator;
}

function tbdPaths(obj: unknown, prefix: string): string[] {
  if (obj === "TBD") return [prefix];
  if (Array.isArray(obj)) return obj.flatMap((v, i) => tbdPaths(v, `${prefix}[${i}]`));
  if (obj && typeof obj === "object")
    return Object.entries(obj).flatMap(([k, v]) => tbdPaths(v, `${prefix}.${k}`));
  return [];
}

function sources(s: SourceRef | SourceRef[] | undefined): SourceRef[] {
  return s ? (Array.isArray(s) ? s : [s]) : [];
}

function checkEntry(
  e: RuleDef | OverrideDef,
  where: string,
  docs: Set<string>,
  errs: string[],
  parent?: RuleDef
): void {
  const q = e.quote ?? "";
  const n = q.split(/\s+/).filter(Boolean).length;
  if (n > 25) errs.push(`${where}: quote has ${n} words (> 25)`);
  const tb = (e.tbd ?? []).map((t) => t.field);
  if (q === "TBD" && !tb.includes("quote"))
    errs.push(`${where}: quote is TBD but has no tbd[] entry for 'quote'`);
  for (const s of sources(e.source))
    if (!docs.has(s.doc)) errs.push(`${where}: source doc '${s.doc}' not in documents`);
  for (const path of [
    ...tbdPaths(e.params ?? {}, "params"),
    ...tbdPaths(e.source ?? {}, "source"),
  ]) {
    const p = path.replace(/\[\d+\]/g, "");
    if (!tb.some((f) => p === f || p.startsWith(f) || f.startsWith(p)))
      errs.push(`${where}: ${path} is TBD but has no tbd[] question`);
  }
  const sev = (e as OverrideDef).severity;
  if (parent && sev && SEVERITY_RANK[sev] > SEVERITY_RANK[parent.severity]) {
    errs.push(`${where}: override raises severity ${parent.severity} -> ${sev}`);
  }
}

/** Every error in a parsed rulebook (empty array = valid). `expectedId` is the file name without .yaml. */
export function validateRulebook(
  doc: unknown,
  expectedId?: string,
  schemaDir = defaultRulebookDir()
): string[] {
  const v = schemaValidator(schemaDir);
  if (!v(doc)) {
    return (v.errors ?? []).map((e) =>
      `schema: ${e.instancePath || "/"}: ${e.message ?? ""}`.slice(0, 240)
    );
  }
  const rb = doc as Rulebook;
  const errs: string[] = [];
  if (expectedId && rb.id !== expectedId)
    errs.push(`id '${rb.id}' != file name '${expectedId}'`);
  if (!rb.id.endsWith(`-${rb.season}`))
    errs.push(`id '${rb.id}' does not end with the season ${rb.season}`);
  const docs = new Set(rb.documents.map((d) => d.id));
  const rules = new Map<string, RuleDef>();
  for (const r of rb.rules) {
    if (rules.has(r.id)) errs.push(`duplicate rule id ${r.id}`);
    rules.set(r.id, r);
    checkEntry(r, r.id, docs, errs);
  }
  const checkOverride = (o: OverrideDef, where: string, d: Set<string>) => {
    const par = rules.get(o.rule);
    if (!par && !(o.type && o.check)) errs.push(`${where}: unknown rule ${o.rule}`);
    checkEntry(o, `${where} (${o.rule})`, d, errs, par);
  };
  for (const [cls, list] of Object.entries(rb.class_overrides ?? {})) {
    if (!rb.classes.some((c) => c.id === cls))
      errs.push(`class_overrides.${cls}: unknown class`);
    list.forEach((o, i) => checkOverride(o, `class_overrides.${cls}[${i}]`, docs));
  }
  for (const [ek, ev] of Object.entries(rb.events ?? {})) {
    const edocs = new Set([...docs, ...(ev.documents ?? []).map((d) => d.id)]);
    ev.overrides.forEach((o, i) =>
      checkOverride(o, `events.${ek}.overrides[${i}]`, edocs)
    );
    for (const [cls, list] of Object.entries(ev.class_overrides ?? {})) {
      list.forEach((o, i) =>
        checkOverride(o, `events.${ek}.class_overrides.${cls}[${i}]`, edocs)
      );
    }
  }
  return errs;
}

// ─── loading and selection ─────────────────────────────────────────────────

/** Parse and validate one rulebook file. Throws RulebookError when invalid. */
export function loadRulebookFile(path: string): Rulebook {
  // YAML 1.2 core schema: calendar dates stay strings ("2026-10-02"), as the format requires.
  const doc = parseYaml(readFileSync(path, "utf8"), { schema: "core" }) as unknown;
  const errs = validateRulebook(
    doc,
    basename(path).replace(/\.ya?ml$/, ""),
    dirname(path)
  );
  if (errs.length) throw new RulebookError(`invalid rulebook ${path}`, errs);
  return doc as Rulebook;
}

/** Every rulebook in a directory (files `<series>-<season>.yaml`). */
export function loadAllRulebooks(dir = defaultRulebookDir()): Rulebook[] {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => loadRulebookFile(join(dir, f)));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Select the rulebook for a series and season. `series` may be the rulebook id prefix ("imsa-mpc"),
 * the series id, or the series name ("IMSA Michelin Pilot Challenge"); matching ignores case and punctuation.
 * Returns null when no rulebook exists (D2: such series get no rule checks).
 */
export function selectRulebook(
  series: string,
  season: number,
  dir = defaultRulebookDir()
): Rulebook | null {
  const want = norm(series);
  const hits = loadAllRulebooks(dir).filter(
    (rb) =>
      rb.season === season &&
      [rb.id.replace(/-\d{4}$/, ""), rb.series.id, rb.series.name, rb.id].some(
        (s) => norm(s) === want
      )
  );
  if (hits.length > 1)
    throw new RulebookError(
      `more than one rulebook matches ${series} ${season}: ${hits.map((h) => h.id).join(", ")}`
    );
  return hits[0] ?? null;
}

/**
 * Pick the event layer. An explicit key wins (and must exist); otherwise the event whose `match`
 * (track + date range) or `track` + `dates` contains the race. Returns null when nothing matches.
 */
export function selectEvent(
  rb: Rulebook,
  opts: {
    eventKey?: string | null;
    track?: string | null;
    date?: string | null;
    eventName?: string | null;
  }
): string | null {
  const events = rb.events ?? {};
  if (opts.eventKey) {
    if (!events[opts.eventKey])
      throw new RulebookError(
        `rulebook ${rb.id} has no event '${opts.eventKey}'`,
        Object.keys(events)
      );
    return opts.eventKey;
  }
  if (!opts.date) return null;
  const hits = Object.entries(events).filter(([, ev]) => {
    const track = ev.match?.track ?? ev.track;
    const [from, to] = (
      ev.match?.date_range?.length === 2 ? ev.match.date_range : ev.dates
    ) as [string, string];
    if (opts.track && track && opts.track !== track) return false;
    if (!(opts.date! >= from && opts.date! <= to)) return false;
    const contains = ev.match?.event_name_contains;
    if (
      contains &&
      opts.eventName &&
      !opts.eventName.toLowerCase().includes(contains.toLowerCase())
    )
      return false;
    return true;
  });
  return hits.length === 1 ? hits[0][0] : null;
}

/** The event session for a race date (or key); its duration is the published race duration. */
export function selectSession(
  ev: EventDef | undefined,
  opts: { sessionKey?: string | null; date?: string | null }
) {
  if (!ev) return null;
  if (opts.sessionKey) return ev.sessions.find((s) => s.key === opts.sessionKey) ?? null;
  const onDate = ev.sessions.filter((s) => s.date === opts.date);
  return onDate.length === 1 ? onDate[0] : null;
}

// ─── resolution ────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Maps merge, scalars and lists replace (RULEBOOK_FORMAT.md §5). */
export function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) {
    out[k] =
      isPlainObject(v) && isPlainObject(out[k])
        ? deepMerge(out[k] as Record<string, unknown>, v)
        : v;
  }
  return out;
}

function leafPaths(obj: Record<string, unknown>, prefix: string): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    isPlainObject(v) && Object.keys(v).length
      ? leafPaths(v, `${prefix}.${k}`)
      : [`${prefix}.${k}`]
  );
}

function seriesLayer(r: RuleDef): ProvenanceLayer {
  return {
    layer: "series",
    setsParams: leafPaths(r.params ?? {}, "params"),
    source: sources(r.source),
    quote: r.quote,
    verified: r.verified,
    params: r.params ?? {},
    tbd: r.tbd ?? [],
  };
}

function applyOverride(
  base: ResolvedRule | undefined,
  o: OverrideDef,
  layer: ProvenanceLayer["layer"],
  ctx: { eventKey?: string; cls?: string }
): ResolvedRule {
  const prov: ProvenanceLayer = {
    layer,
    ...(ctx.eventKey ? { eventKey: ctx.eventKey } : {}),
    ...(ctx.cls ? { class: ctx.cls } : {}),
    setsParams: leafPaths(o.params ?? {}, "params"),
    source: sources(o.source),
    quote: o.quote,
    verified: o.verified,
    params: o.params ?? {},
    tbd: o.tbd ?? [],
  };
  if (!base) {
    // A new rule introduced by an override (must be a full rule object).
    return {
      id: o.rule,
      type: o.type!,
      title: o.title ?? o.rule,
      appliesTo: o.applies_to ?? {},
      params: o.params ?? {},
      severity: o.severity ?? "info",
      checkableWith: o.checkable_with ?? {},
      check: o.check ?? "",
      disabled: !!o.disabled,
      verified: o.verified,
      seasonConfirmed: true,
      provenance: [prov],
      tbd: o.tbd ?? [],
      notes: o.notes,
    };
  }
  const sev =
    o.severity && SEVERITY_RANK[o.severity] < SEVERITY_RANK[base.severity]
      ? o.severity
      : base.severity;
  return {
    ...base,
    title: o.title ?? base.title,
    appliesTo: { ...base.appliesTo, ...(o.applies_to ?? {}) },
    params: deepMerge(base.params, o.params),
    severity: sev,
    checkableWith: o.checkable_with
      ? { ...base.checkableWith, ...o.checkable_with }
      : base.checkableWith,
    check: o.check ?? base.check,
    disabled: base.disabled || !!o.disabled,
    provenance: [...base.provenance, prov],
  };
}

function finalise(r: ResolvedRule): ResolvedRule {
  // A TBD question stays open only while the resolved value it asks about is still TBD.
  const tbd: TbdEntry[] = [];
  const seen = new Set<string>();
  for (const layer of r.provenance) {
    for (const t of layer.tbd) {
      const still = t.field.startsWith("params.")
        ? tbdPaths(getPath(r.params, t.field.slice(7)), t.field).length > 0
        : true;
      const key = `${t.field}|${t.question}`;
      if (still && !seen.has(key)) {
        seen.add(key);
        tbd.push(t);
      }
    }
  }
  return { ...r, verified: r.provenance.every((p) => p.verified), tbd };
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split(".").filter(Boolean)) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Resolve every rule for one rulebook class, optionally with an event layer. */
export function resolveRulesForClass(
  rb: Rulebook,
  eventKey: string | null,
  cls: string | null
): Map<string, ResolvedRule> {
  const rules = new Map<string, ResolvedRule>();
  for (const r of rb.rules) {
    rules.set(r.id, {
      id: r.id,
      type: r.type,
      title: r.title,
      appliesTo: r.applies_to ?? {},
      params: r.params ?? {},
      severity: r.severity,
      checkableWith: r.checkable_with ?? {},
      check: r.check,
      disabled: false,
      verified: r.verified,
      seasonConfirmed: r.season_confirmed !== false,
      provenance: [seriesLayer(r)],
      tbd: r.tbd ?? [],
      penalty: r.penalty,
      notes: r.notes,
    });
  }
  const layers: [
    ProvenanceLayer["layer"],
    OverrideDef[],
    { eventKey?: string; cls?: string },
  ][] = [];
  if (cls) layers.push(["class", rb.class_overrides?.[cls] ?? [], { cls }]);
  const ev = eventKey ? rb.events?.[eventKey] : undefined;
  if (eventKey && !ev)
    throw new RulebookError(`rulebook ${rb.id} has no event '${eventKey}'`);
  if (ev) {
    layers.push(["event", ev.overrides ?? [], { eventKey: eventKey ?? undefined }]);
    if (cls)
      layers.push([
        "event-class",
        ev.class_overrides?.[cls] ?? [],
        { eventKey: eventKey ?? undefined, cls },
      ]);
  }
  for (const [layer, list, ctx] of layers) {
    for (const o of list)
      rules.set(o.rule, applyOverride(rules.get(o.rule), o, layer, ctx));
  }
  for (const [id, r] of rules) rules.set(id, finalise(r));
  return rules;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Resolve the rulebook for a race: one rule set per rulebook class, plus the hash of the whole set. */
export function resolveRulebook(
  rb: Rulebook,
  opts: { eventKey?: string | null; sessionKey?: string | null } = {}
): ResolvedRulebook {
  const eventKey = opts.eventKey ?? null;
  const byClass = new Map<string, Map<string, ResolvedRule>>();
  for (const c of rb.classes) byClass.set(c.id, resolveRulesForClass(rb, eventKey, c.id));
  const hashInput = canonical({
    rulebook: rb.id,
    eventKey,
    sessionKey: opts.sessionKey ?? null,
    classes: Object.fromEntries([...byClass].map(([c, m]) => [c, Object.fromEntries(m)])),
  });
  const documents = new Map(rb.documents.map((d) => [d.id, d]));
  for (const d of (eventKey && rb.events?.[eventKey]?.documents) || [])
    documents.set(d.id, d);
  return {
    rulebook: rb,
    eventKey,
    sessionKey: opts.sessionKey ?? null,
    byClass,
    hash: createHash("sha256").update(hashInput).digest("hex"),
    documents,
  };
}

/** Rulebook class id for a class label in the timing data (id or alias, case-insensitive). */
export function rulebookClassFor(rb: Rulebook, cls: string): string | null {
  const n = norm(cls);
  for (const c of rb.classes) {
    if (norm(c.id) === n || (c.aliases ?? []).some((a) => norm(a) === n)) return c.id;
  }
  return null;
}
