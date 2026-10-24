/**
 * Race cards (mobile redesign): a view of its own on the phone race page, where the car's race
 * card and each of its drivers' cards are shown as the images they are, one at a time, with one
 * big Share button under each.
 *
 *   [ #60's race ] [ Alana ] [ Michele ] [ Hannah ]       which card (44 px chips)
 *   ┌───────────────────────────┐
 *   │        the card image      │  ← swipe sideways for the next card
 *   └───────────────────────────┘
 *   [ ⇪  Share ]                   the phone's share sheet: Messages, WhatsApp, Instagram,
 *                                  Facebook, X, email, AirDrop, copy the image or the link…
 *   (Copy image · Save · Copy link only where there is no share sheet for images)
 *
 * Seeing the finished card is what makes people send it (peak-end), so the card is the screen's
 * content, not a link under a list. The share sheet carries the image and a link to the race
 * (tagged as a share). Where the browser has no share sheet for files, Share saves the image.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { AnnotationData, RaceChartData } from "@shared/types";
import { track } from "@/lib/analytics";
import { currentDeviceClass } from "@/lib/breakpoint";
import { copyImage, downloadImage, imageName, shareImage, sharedUrl } from "@/features/share";
import { loadCarCard, makeCarCard } from "../dashboard/carShare";
import { loadDriverCardFacts, makeDriverCard, primeRaceChart } from "../my-drivers/driverCard";
import { displayName } from "../my-drivers/api";
import { carDriverNames } from "../my-drivers/CarDrivers";
import { TraceControls } from "../chart/TraceControls";
import type { TraceView } from "../chart/trace-view";

const C = { bg: "#0b0b18", card: "#12122a", line: "#1e1e38", border: "#3a3a5c", text: "#e0e0e8", soft: "#cbd5e1", muted: "#9a9ab4", accent: "#F48C34" };

interface Slide {
  key: string;
  /** The chip: "#60's race", "Alana". */
  chip: string;
  /** Who or what the card is, for the share text and the file name. */
  title: string;
  make: () => Promise<Blob>;
  kind: "car_race" | "driver_race";
}

const first = (name: string) => name.split(/\s+/)[0];

function ShareIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

/** One card's image, drawn once and kept while the view is open. */
function useCardImage(slide: Slide | undefined, delayMs: number) {
  const [state, setState] = useState<{ url: string; blob: Blob } | "error" | null>(null);
  useEffect(() => {
    if (!slide) return;
    let alive = true;
    let url: string | null = null;
    setState(null);
    const t = window.setTimeout(() => {
      slide
        .make()
        .then((blob) => {
          if (!alive) return;
          url = URL.createObjectURL(blob);
          setState({ url, blob });
        })
        .catch(() => alive && setState("error"));
    }, delayMs);
    return () => {
      alive = false;
      window.clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
    // A slide is remade only when its card changes (its key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.key, delayMs]);
  return state;
}

function CardSlide({ slide, index, onImage }: { slide: Slide; index: number; onImage: (key: string, blob: Blob | null) => void }) {
  // The first card is drawn at once; the others just after, so the first shows quickly.
  const img = useCardImage(slide, index === 0 ? 0 : 250 + index * 200);
  useEffect(() => {
    onImage(slide.key, img && img !== "error" ? img.blob : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);
  return (
    <div data-race-card={slide.key} className="flex h-full w-full shrink-0 snap-center items-center justify-center px-1">
      {/* The image sizes itself: as large as fits either way, at its own 4:5. */}
      {img && img !== "error" ? (
        <img src={img.url} alt={`${slide.title} share card`} className="block max-h-full max-w-full rounded-xl border object-contain" style={{ borderColor: C.line }} draggable={false} />
      ) : (
        <div className="flex aspect-[4/5] max-h-full w-full max-w-full items-center justify-center rounded-xl border p-6 text-center text-[14px]" style={{ borderColor: C.line, background: C.card, color: C.muted }}>
          {img === "error" ? "This card could not be made. Check your connection and try again." : <span className="animate-pulse">Making the card…</span>}
        </div>
      )}
    </div>
  );
}

export function RaceCardsView({
  raceId,
  raceName,
  data,
  annotations,
  focusNum,
  setFocusNum,
  classView,
  compSet,
  view,
  phoneSlot = null,
  landscape = false,
  startAt,
}: {
  raceId: string;
  raceName: string;
  data: RaceChartData;
  annotations: AnnotationData | null;
  focusNum: number;
  setFocusNum: (n: number) => void;
  classView: string;
  compSet: Set<number>;
  view: TraceView;
  phoneSlot?: HTMLElement | null;
  /** A phone held sideways: the card on the left, the buttons beside it. */
  landscape?: boolean;
  /** Open on this driver's card (from a Share button in the lap details). */
  startAt?: string | null;
}) {
  const car = data.cars[String(focusNum)];
  const number = car?.label ?? String(focusNum);
  // The drivers: the server's list for the card when it has one, else the timing's.
  const [drivers, setDrivers] = useState<string[]>(() => carDriverNames(car));
  useEffect(() => {
    primeRaceChart(raceId, data, annotations);
    setDrivers(carDriverNames(car));
    let alive = true;
    loadCarCard(raceId, number).then((c) => alive && c?.drivers?.length && setDrivers(c.drivers));
    return () => {
      alive = false;
    };
  }, [raceId, number, car, data, annotations]);

  const slides = useMemo<Slide[]>(
    () => [
      {
        key: `car:${number}`,
        chip: `#${number}'s race`,
        title: `#${number} ${car?.team ?? ""}`.trim(),
        kind: "car_race",
        make: async () => {
          const input = await loadCarCard(raceId, number);
          if (!input) throw new Error("no card");
          return makeCarCard(input);
        },
      },
      ...drivers.map((d) => {
        const name = displayName(d);
        return {
          key: `driver:${number}:${d}`,
          chip: first(name),
          title: name,
          kind: "driver_race" as const,
          make: async () => {
            const facts = await loadDriverCardFacts(raceId, number, d);
            if (!facts) throw new Error("no card");
            return makeDriverCard({ driverName: name, ...facts });
          },
        };
      }),
    ],
    [raceId, number, car?.team, drivers]
  );

  const [current, setCurrent] = useState(0);
  // A share sheet that takes images (phones): Share is the one button.
  const [canShareFiles] = useState(() => {
    try {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      return typeof nav.share === "function" && !!nav.canShare?.({ files: [new File([""], "card.png", { type: "image/png" })] });
    } catch {
      return false;
    }
  });
  const strip = useRef<HTMLDivElement>(null);
  const blobs = useRef(new Map<string, Blob>());
  const [, bump] = useState(0);
  const onImage = (key: string, blob: Blob | null) => {
    if (blob) blobs.current.set(key, blob);
    else blobs.current.delete(key);
    bump((n) => n + 1);
  };
  const go = (i: number, smooth = true) => {
    const el = strip.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
    setCurrent(i);
  };
  // A Share button in the lap details opens this view on that driver's card.
  useEffect(() => {
    if (!startAt) return;
    const i = slides.findIndex((s) => s.key.endsWith(`:${startAt}`));
    if (i > 0) requestAnimationFrame(() => go(i, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt, slides.length]);
  useEffect(() => setCurrent((c) => Math.min(c, slides.length - 1)), [slides.length]);

  const slide = slides[current] ?? slides[0];
  const blob = slide ? blobs.current.get(slide.key) : undefined;
  const link = sharedUrl(`/chart?race=${raceId}&car=${encodeURIComponent(number)}`);
  const text = slide ? `${slide.title} · ${raceName} on RaceTrace ${link}` : "";
  const file = slide ? imageName("racetrace", `${slide.title} ${raceName}`) : "card.png";
  const [note, setNote] = useState<string | null>(null);
  const say = (s: string) => {
    setNote(s);
    window.setTimeout(() => setNote(null), 3500);
  };
  const done = (method: string) => slide && track("share_card", { kind: slide.kind, method, device: currentDeviceClass(), from: "race_cards" });

  const share = async () => {
    if (!blob) return;
    const m = await shareImage(blob, file, text);
    if (m === "download") say("Image saved. Attach it to a post or a message.");
    if (m !== "cancelled") done(m);
  };
  const copy = async () => {
    if (!blob) return;
    if (await copyImage(Promise.resolve(blob))) {
      say("Image copied. Paste it into a message or post.");
      done("copy");
    } else say("This browser can't copy images. Use Save instead.");
  };
  const save = () => {
    if (!blob) return;
    downloadImage(blob, file);
    say("Image saved to your downloads.");
    done("download");
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      say("Link to the race copied.");
      track("share_card", { kind: "race_link", method: "copy", device: currentDeviceClass(), from: "race_cards" });
    } catch {
      say("The link could not be copied.");
    }
  };

  // Drawn 36 px tall so the card gets the room, each with a 44 px touch area (::before).
  const secondary =
    "relative flex h-9 flex-1 items-center justify-center rounded-lg border text-[13px] font-semibold disabled:opacity-50 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";
  const actions = (
    <div className="flex flex-col gap-2" data-race-cards="actions">
      <button
        type="button"
        onClick={share}
        disabled={!blob}
        data-race-cards="share"
        className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl text-[15px] font-bold shadow-lg disabled:opacity-60"
        style={{ background: C.accent, color: C.bg }}
      >
        <ShareIcon />
        {blob ? `Share ${slide?.kind === "car_race" ? "the race card" : `${slide?.chip}'s card`}` : "Making the card…"}
      </button>
      {/* The phone's share sheet already copies the image or the link and saves it: these
          show only where a browser has no share sheet for images. */}
      {!canShareFiles && <div className="flex gap-2">
        <button type="button" onClick={copy} disabled={!blob} data-touch-44 className={secondary} style={{ borderColor: C.border, color: C.text }}>
          Copy image
        </button>
        <button type="button" onClick={save} disabled={!blob} data-touch-44 className={secondary} style={{ borderColor: C.border, color: C.text }}>
          Save
        </button>
        <button type="button" onClick={copyLink} data-touch-44 className={secondary} style={{ borderColor: C.border, color: C.text }}>
          Copy link
        </button>
      </div>}

    </div>
  );

  const chips = (
    <div role="tablist" aria-label="Cards" className="no-scrollbar flex gap-1.5 overflow-x-auto px-3" data-phone-cards="chips">
      {slides.map((s, i) => (
        <button
          key={s.key}
          type="button"
          role="tab"
          aria-selected={i === current}
          onClick={() => go(i)}
          data-touch-44
          className="relative h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-semibold before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
          style={i === current ? { borderColor: C.accent, background: "rgba(244,140,52,0.14)", color: C.text } : { borderColor: C.border, color: C.muted }}
        >
          {s.chip}
        </button>
      ))}
    </div>
  );

  const cards = (
    <div className="relative flex min-h-0 flex-1 flex-col">
    {note && (
      <p role="status" className="pointer-events-none absolute inset-x-0 bottom-2 z-10 m-0 mx-auto w-max max-w-[90%] rounded-full px-3 py-1.5 text-center text-[12px] shadow-lg" style={{ background: "rgba(18,18,42,0.95)", border: `1px solid ${C.border}`, color: C.text }}>
        {note}
      </p>
    )}
    <div
      ref={strip}
      onScroll={(e) => {
        const el = e.currentTarget;
        const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
        if (i !== current) setCurrent(i);
      }}
      className="no-scrollbar flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto"
      data-race-cards="strip"
      data-carousel
    >
      {slides.map((s, i) => (
        <CardSlide key={s.key} slide={s} index={i} onImage={onImage} />
      ))}
    </div>
    </div>
  );

  if (!car) return null;
  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: C.bg, color: C.text }} data-race-cards="view">
      {/* Upright, no car pill: the chips name the car and the card gets the room (the car is the
          one picked on the other views). Sideways, the pill sits in the top row at no cost. */}
      {phoneSlot && <TraceControls data={data} focusNum={focusNum} onFocus={setFocusNum} classView={classView} compSet={compSet} view={view} phoneSlot={phoneSlot} />}
      <div className="pt-2">{chips}</div>
      {landscape ? (
        <div className="flex min-h-0 flex-1 gap-3 px-3 py-2">
          <div className="flex min-h-0 w-1/2 flex-col">{cards}</div>
          <div className="flex w-1/2 flex-col justify-center">{actions}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-2 pb-2 pt-2" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
          {cards}
          {actions}
        </div>
      )}
    </div>
  );
}
