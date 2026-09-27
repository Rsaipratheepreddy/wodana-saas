"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { PHONE_MEDIA_QUERY, ToastProvider, TourOverlay, useMediaQuery, useToast } from "@/design-system";
import { useLanguage, useT } from "@/lib/i18n/i18n-provider";
import type { MessageKey, Translate } from "@/lib/i18n/keys";
import { TourRunner, type TourHost } from "@/lib/tours/engine";
import { TOUR_PACE, tourMinutes } from "@/lib/tours/timing";
import { tourById, tourForPath, tours } from "@/lib/tours/tours";
import { TOUR_SPEEDS, type Tour, type TourSpeed, type TourStep } from "@/lib/tours/types";
import { audioPath, createNarrator, hasAudio, pause, type Narrator } from "@/lib/tours/voice";
import { installWriteGuard } from "@/lib/tours/write-guard";

type TourControls = {
  /** Tours are for desktop and tablet; on a phone there is no explainer. */
  available: boolean;
  tours: Tour[];
  /** The tour that explains the current screen, if any. */
  current: Tour | undefined;
  active: boolean;
  start: (id: string) => void;
  minutes: (tour: Tour) => number;
};

const TourContext = createContext<TourControls | null>(null);

export function useTours() {
  return useContext(TourContext);
}

const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function voiceKey(userId: string) {
  return `wodana-tour-voice:${userId}`;
}

function readVoice(userId: string) {
  try { return window.localStorage.getItem(voiceKey(userId)) !== "off"; } catch { return true; }
}

/** The language a line is written in: untranslated lines are still English. */
function spokenLanguage(t: Translate, key: MessageKey, language: string) {
  return language !== "en" && t(key) === key ? "en" : language;
}

type HostOptions = {
  navigate: (href: string) => void;
  t: () => Translate;
  language: () => string;
  voice: () => boolean;
  narrator: Narrator;
  recorded: Map<string, boolean>;
};

/** The browser side of the tour engine: DOM lookups, real-looking clicks, typing, dialogs and voice. */
function createBrowserHost({ navigate, t, language, voice, narrator, recorded }: HostOptions): TourHost {
  const recordedLine = (tour: Tour, step: TourStep) => {
    const key = step.voice ?? step.narration;
    const src = audioPath(spokenLanguage(t(), key, language()), tour.id, step.id);
    return recorded.get(src) ? src : null;
  };
  return {
    path: () => window.location.pathname,
    navigate,
    find(target) {
      for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`)) {
        if (!element.closest(".wd-tour") && element.getClientRects().length) return element;
      }
      return null;
    },
    async reveal(element) {
      const rect = element.getBoundingClientRect();
      if (rect.top >= 64 && rect.bottom <= window.innerHeight - 24) return;
      element.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: rect.height > window.innerHeight * 0.6 ? "start" : "center", inline: "nearest" });
      await pause(reducedMotion() ? 60 : 600);
    },
    press(element) {
      const rect = element.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, composed: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
      const pointer = { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true };
      element.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
      element.dispatchEvent(new MouseEvent("mousedown", { ...at, buttons: 1 }));
      element.dispatchEvent(new PointerEvent("pointerup", pointer));
      element.dispatchEvent(new MouseEvent("mouseup", at));
      element.dispatchEvent(new MouseEvent("click", at));
    },
    fill(field, value) {
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    },
    overlays: () => Array.from(document.querySelectorAll<HTMLElement>(OVERLAYS)).filter((element) => !element.closest(".wd-tour") && element.getClientRects().length > 0),
    dismiss(overlay) {
      overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      window.setTimeout(() => {
        if (!overlay.isConnected || !overlay.getClientRects().length) return;
        overlay.querySelector<HTMLElement>(`[data-tour-close], button[aria-label="${CSS.escape(t()("Close dialog"))}"]`)?.click();
      }, 300);
    },
    line(tour, step, values) {
      const fallbacks = Object.fromEntries((tour.examples ?? []).map((example) => [example.key, t()(example.fallback)]));
      return t()(step.voice && recordedLine(tour, step) ? step.voice : step.narration, { ...fallbacks, ...values });
    },
    narrate(tour, step, text, speed, signal) {
      const key = step.voice && recordedLine(tour, step) ? step.voice : step.narration;
      return narrator.speak({ text, language: spokenLanguage(t(), key, language()), audio: recordedLine(tour, step), speed, voice: voice(), signal });
    },
    silence: () => narrator.stop(),
    sleep: pause,
  };
}

/** Checks which recorded lines exist for a tour before it starts (at most a moment). */
async function findRecordings(tour: Tour, t: Translate, language: string, recorded: Map<string, boolean>) {
  const checks = tour.steps.map(async (step) => {
    const src = audioPath(spokenLanguage(t, step.voice ?? step.narration, language), tour.id, step.id);
    recorded.set(src, await hasAudio(src));
  });
  await Promise.race([Promise.all(checks), pause(1500)]);
}

export type TourProviderProps = { children: ReactNode; userId: string; userName?: string; brandStyle?: CSSProperties };

/** Woddy explains: plays scripted tours over the workspace. Start one from the Woddy menu or `?tour=<id>`. */
export function TourProvider(props: TourProviderProps) {
  return <ToastProvider><TourPlayer {...props} /></ToastProvider>;
}

function TourPlayer({ children, userId, userName, brandStyle }: TourProviderProps) {
  const t = useT();
  const { language, direction } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const toast = useToast();
  const [voice, setVoice] = useState(true);
  useEffect(() => { setVoice(readVoice(userId)); }, [userId]);

  const live = useRef({ t, language, voice, router });
  useEffect(() => { live.current = { t, language, voice, router }; });
  const recorded = useRef(new Map<string, boolean>());
  const [runner] = useState(() => {
    const narrator = createNarrator();
    return new TourRunner(createBrowserHost({
      navigate: (href) => live.current.router.push(href),
      t: () => live.current.t,
      language: () => live.current.language,
      voice: () => live.current.voice,
      narrator,
      recorded: recorded.current,
    }));
  });
  const state = useSyncExternalStore(runner.subscribe, runner.getSnapshot, runner.getSnapshot);
  const active = state.status !== "idle";
  const phone = useMediaQuery(PHONE_MEDIA_QUERY);
  const phoneNow = useRef(phone);
  useEffect(() => { phoneNow.current = phone; });
  // No explainer on phones: a tour that is running when the screen narrows to phone width ends cleanly.
  useEffect(() => { if (phone) runner.exit(); }, [phone, runner]);

  const start = useCallback((id: string) => {
    const tour = tourById(id);
    if (!tour || phoneNow.current || window.matchMedia?.(PHONE_MEDIA_QUERY).matches) return;
    const firstName = userName?.trim().split(/\s+/u)[0];
    void findRecordings(tour, live.current.t, live.current.language, recorded.current).then(() => runner.start(tour, { name: firstName || live.current.t("there") }));
  }, [runner, userName]);

  useEffect(() => () => runner.exit(), [runner]);

  // Demo safety: while a tour shows, nothing is written. A quiet notice says so (at most every few seconds).
  useEffect(() => {
    if (!active) return;
    let last = 0;
    return installWriteGuard(() => {
      if (Date.now() - last < 4000) return;
      last = Date.now();
      toast.push({ title: live.current.t("Demo mode: nothing is saved"), message: "", tone: "info" });
    });
  }, [active, toast]);

  // `?tour=<id>` starts a tour, for sharing and demos.
  const requested = search.get("tour");
  useEffect(() => {
    if (!requested || !tourById(requested) || phone) return;
    const rest = new URLSearchParams(search.toString());
    rest.delete("tour");
    router.replace(rest.size ? `${pathname}?${rest}` : pathname, { scroll: false });
    start(requested);
  }, [requested, pathname, router, search, start, phone]);

  const toggleVoice = useCallback(() => {
    const next = !live.current.voice;
    live.current.voice = next;
    setVoice(next);
    try { window.localStorage.setItem(voiceKey(userId), next ? "on" : "off"); } catch { /* This device keeps the choice for now. */ }
    // Replay the current line with the new setting.
    if (runner.getSnapshot().status === "running") { runner.pause(); runner.resume(); }
  }, [runner, userId]);

  const minutes = useCallback((tour: Tour) => tourMinutes(tour, (key) => t(key as MessageKey)), [t]);
  const controls = useMemo<TourControls>(() => ({ available: !phone, tours, current: tourForPath(pathname), active, start, minutes }), [phone, pathname, active, start, minutes]);

  const tour = state.tour;
  const next = tour?.next ? tourById(tour.next) : undefined;
  return <TourContext.Provider value={controls}>
    {children}
    {active && tour && !phone ? <TourOverlay
      clicks={state.clicks}
      direction={direction}
      finished={state.status === "finished"}
      glideMs={TOUR_PACE.glide / state.speed}
      nextTour={next ? { title: t(next.title), onStart: () => start(next.id) } : null}
      note={state.missing ? t("I can't find this part of the screen right now, so let's skip ahead.") : null}
      onBack={() => runner.back()}
      onExit={() => runner.exit()}
      onNext={() => runner.next()}
      onSpeed={(speed) => runner.setSpeed(speed as TourSpeed)}
      onToggle={() => runner.toggle()}
      onVoice={toggleVoice}
      phase={state.phase}
      playing={state.status === "running"}
      pointer={state.pointer}
      speed={state.speed}
      speeds={TOUR_SPEEDS}
      spotlight={state.spotlight}
      step={state.index + 1}
      style={brandStyle}
      text={state.text}
      title={t(tour.title)}
      total={tour.steps.length}
      voice={voice}
      pose={state.missing ? "oops" : state.mood}
    /> : null}
  </TourContext.Provider>;
}
