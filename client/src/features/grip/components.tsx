import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button } from "@/components/Button";
import { cn } from "@/lib/utils";
import {
  CORNER_KEYS,
  type CornerKey,
  type Corners,
  type Track,
  type Weather,
} from "./api";

// ─── Buttons ─────────────────────────────────────────────────────────────────

interface GripButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

/** The shared Button with Finding Grip's orange for the primary action. */
export function GripButton({
  variant = "primary",
  className,
  ...props
}: GripButtonProps) {
  return (
    <Button
      variant={variant}
      className={cn(
        variant === "primary" &&
          "bg-grip-500 text-gray-950 font-semibold hover:bg-grip-400 focus:ring-grip-500",
        variant !== "primary" && "focus:ring-grip-500",
        "dark:focus:ring-offset-gray-950",
        className
      )}
      {...props}
    />
  );
}

/** Class string for a <Link> that should look like the primary button. */
export const primaryLinkClass =
  "inline-flex items-center justify-center rounded-lg bg-grip-500 text-gray-950 font-semibold hover:bg-grip-400 transition-colors focus:outline-none focus:ring-2 focus:ring-grip-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950";
export const secondaryLinkClass =
  "inline-flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-grip-500";

// ─── Surfaces ────────────────────────────────────────────────────────────────

export function Card({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-5 min-w-0",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl sm:text-[1.65rem] font-bold tracking-tight text-gray-900 dark:text-gray-50">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">
      {children}
    </h2>
  );
}

const pillTones = {
  neutral: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300",
  pro: "bg-grip-500/15 text-grip-700 dark:text-grip-300",
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  dry: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  wet: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
} as const;

export function Pill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: keyof typeof pillTones;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        pillTones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export const WeatherPill = ({ weather }: { weather: Weather }) => (
  <Pill tone={weather === "WET" ? "wet" : "dry"}>
    {weather === "WET" ? "Wet" : "Dry"}
  </Pill>
);

export function TrackBadge({
  track,
}: {
  track: Pick<Track, "shortName" | "name" | "logoUrl">;
}) {
  return (
    <span
      title={track.name}
      className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800 text-[11px] font-extrabold tracking-wide text-gray-600 dark:text-gray-300"
    >
      {track.logoUrl ? (
        <img src={track.logoUrl} alt="" className="h-full w-full object-contain" />
      ) : (
        track.shortName
      )}
    </span>
  );
}

export function Note({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "border-l-2 border-gray-300 dark:border-gray-700 pl-3 text-xs text-gray-500",
        className
      )}
    >
      {children}
    </p>
  );
}

export function Banner({
  tone = "neutral",
  children,
  action,
}: {
  tone?: "neutral" | "warn" | "ok";
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    neutral: "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900",
    warn: "border-amber-400/60 bg-amber-500/10",
    ok: "border-emerald-500/60 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  };
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
        tones[tone]
      )}
    >
      <div className="min-w-0">{children}</div>
      {action}
    </div>
  );
}

// ─── The four-corner grid ────────────────────────────────────────────────────
// Every per-wheel value is laid out the way the car is: LF RF over LR RR.

const CORNER_LABEL: Record<CornerKey, string> = {
  lf: "LF",
  rf: "RF",
  lr: "LR",
  rr: "RR",
};
const AREA: Record<CornerKey, string> = {
  lf: "col-start-1 row-start-1",
  rf: "col-start-3 row-start-1",
  lr: "col-start-1 row-start-2",
  rr: "col-start-3 row-start-2",
};

function Chassis() {
  return (
    <div
      aria-hidden="true"
      className="col-start-2 row-start-1 row-span-2 my-2 flex justify-center rounded-t-[18px] rounded-b-[10px] border-[1.5px] border-gray-300 dark:border-gray-700 relative"
    >
      <span className="mt-1 text-[8px] uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
        Front
      </span>
      <span className="absolute inset-x-1.5 top-[24%] h-[26%] rounded-t-md rounded-b-sm border-[1.5px] border-gray-300 dark:border-gray-700" />
    </div>
  );
}

interface CornerGridProps {
  values: Corners<string>;
  unit: string;
  /** Large orange figures, for the calculated result. */
  emphasis?: boolean;
  /** Small line under each value. */
  detail?: Partial<Corners<string>>;
}

export function CornerGrid({ values, unit, emphasis, detail }: CornerGridProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_46px_minmax(0,1fr)] gap-2">
      {CORNER_KEYS.map((c) => {
        const empty = values[c] === "—";
        return (
          <div
            key={c}
            className={cn(
              "rounded-lg border px-3 py-2 min-w-0",
              AREA[c],
              emphasis && !empty
                ? "border-grip-500 bg-grip-500/10"
                : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950"
            )}
          >
            <div className="text-[11px] font-bold tracking-widest text-gray-500">
              {CORNER_LABEL[c]}
            </div>
            <div
              className={cn(
                "tabular-nums font-bold leading-tight",
                emphasis
                  ? "text-[1.75rem] sm:text-[2rem] font-extrabold tracking-tight"
                  : "text-lg",
                empty
                  ? "text-gray-400 dark:text-gray-600"
                  : emphasis
                    ? "text-grip-600 dark:text-grip-400"
                    : "text-gray-900 dark:text-gray-100"
              )}
            >
              {values[c]}
              {!empty && (
                <span className="ml-1 text-[11px] font-medium text-gray-500">{unit}</span>
              )}
            </div>
            {detail?.[c] && (
              <div className="text-[11px] tabular-nums text-gray-500">{detail[c]}</div>
            )}
          </div>
        );
      })}
      <Chassis />
    </div>
  );
}

interface CornerInputsProps {
  idPrefix: string;
  values: Corners<string>;
  unit: string;
  errors?: Partial<Corners<string>>;
  onChange: (corner: CornerKey, value: string) => void;
}

export function CornerInputs({
  idPrefix,
  values,
  unit,
  errors,
  onChange,
}: CornerInputsProps) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_46px_minmax(0,1fr)] gap-2">
      {CORNER_KEYS.map((c) => (
        <div
          key={c}
          className={cn(
            "rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-2 min-w-0",
            AREA[c]
          )}
        >
          <label
            htmlFor={`${idPrefix}-${c}`}
            className="block text-[11px] font-bold tracking-widest text-gray-500 mb-1"
          >
            {CORNER_LABEL[c]}
          </label>
          <div className="relative">
            <input
              id={`${idPrefix}-${c}`}
              inputMode="decimal"
              autoComplete="off"
              value={values[c]}
              onChange={(e) => onChange(c, e.target.value)}
              aria-invalid={!!errors?.[c]}
              className={cn(
                fieldClass,
                "pr-10 text-base font-semibold tabular-nums",
                errors?.[c] && fieldErrorClass
              )}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500">
              {unit}
            </span>
          </div>
          {errors?.[c] && (
            <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{errors[c]}</p>
          )}
        </div>
      ))}
      <Chassis />
    </div>
  );
}

// ─── Form fields ─────────────────────────────────────────────────────────────

export const fieldClass =
  "block w-full min-w-0 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-grip-500 focus:border-grip-500 transition-colors";
export const fieldErrorClass = "border-red-500 focus:ring-red-500 focus:border-red-500";

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  error?: string;
  numeric?: boolean;
  placeholder?: string;
  hint?: string;
}

export function Field({
  id,
  label,
  value,
  onChange,
  unit,
  error,
  numeric,
  placeholder,
  hint,
}: FieldProps) {
  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={numeric ? "decimal" : undefined}
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={!!error}
          className={cn(
            fieldClass,
            unit && "pr-11",
            numeric && "tabular-nums",
            error && fieldErrorClass
          )}
        />
        {unit && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
            {unit}
          </span>
        )}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function ChoiceChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: ReadonlyArray<readonly [T, string]>;
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "rounded-full border px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-grip-500",
            value === v
              ? "border-grip-500 bg-grip-500 text-gray-950 font-bold"
              : "border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-gray-950/70 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-2xl"
      >
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-50">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{body}</p>
      <div className="mt-5 flex justify-end gap-2">
        <GripButton variant="secondary" onClick={onClose}>
          Cancel
        </GripButton>
        <GripButton variant="danger" loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </GripButton>
      </div>
    </Dialog>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin h-7 w-7 border-4 border-grip-500 border-t-transparent rounded-full" />
    </div>
  );
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export const formatShortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
