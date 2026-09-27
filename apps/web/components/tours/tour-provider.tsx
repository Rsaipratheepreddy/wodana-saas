"use client";

import { woddyPath } from "@wodana/contracts/brand";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { PHONE_MEDIA_QUERY, ToastProvider, TourLoader, TourOverlay, useMediaQuery, useToast, type TourPersonaView } from "@/design-system";
import { useLanguage, useT } from "@/lib/i18n/i18n-provider";
import { tKey, type MessageKey, type Translate } from "@/lib/i18n/keys";
import { TourRunner, type TourHost } from "@/lib/tours/engine";
import { loadJourney } from "@/lib/tours/journey";
import { personaAvatar, TOUR_PERSONAS, type TourPersona } from "@/lib/tours/personas";
import { measureTarget, viewport } from "@/lib/tours/position";
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
  /** The person the demo shows while a tour runs: the workspace is presented the way they see it. */
  persona: TourPersona | null;
  /** The same person, translated, for the header and the cursor. */
  personaView: TourPersonaView | null;
  /** Whose tour preferences these are (voice, the first-run highlight). */
  userId: string;
};

const TourContext = createContext<TourControls | null>(null);

export function useTours() {
  return useContext(TourContext);
}

const OVERLAYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
/** Where every workspace screen renders; the page is back once it is there. */
const PAGE = '[data-tour="page-content"]';

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

/** Resolves once `ready()` is true (checked every frame), or after `limit` ms. */
async function until(ready: () => unknown, limit: number) {
  const started = Date.now();
  while (!ready() && Date.now() - started < limit) await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
}

/** The address to come back to: where the person was, without a `?tour=` that started the tour. */
function currentLocation() {
  const params = new URLSearchParams(window.location.search);
  params.delete("tour");
  return `${window.location.pathname}${params.size ? `?${params}` : ""}`;
}

type HostOptions = {
  navigate: (href: string) => void;
  t: () => Translate;
  language: () => string;
  voice: () => boolean;
  narrator: Narrator;
  recorded: Map<string, boolean>;
};

function shown(element: HTMLElement) {
  if (element.closest(".wd-tour, .wd-tour-loader") || !element.getClientRects().length) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** The browser side of the tour engine: DOM lookups, real-looking clicks, typing, dialogs and voice. */
export function createBrowserHost({ navigate, t, language, voice, narrator, recorded }: HostOptions): TourHost {
  const recordedLine = (tour: Tour, step: TourStep) => {
    const key = step.voice ?? step.narration;
    const src = audioPath(spokenLanguage(t(), key, language()), tour.id, step.id);
    return recorded.get(src) ? src : null;
  };
  return {
    path: () => window.location.pathname,
    location: () => `${window.location.pathname}${window.location.search}`,
    navigate,
    find(target, record) {
      // A component may name an element with several words (`data-tour="quote-open quote-main"`).
      for (const element of document.querySelectorAll<HTMLElement>(`[data-tour~="${CSS.escape(target)}"]`)) {
        if (!shown(element)) continue;
        // One record's row: the link that opens it, or an element that names it.
        if (record && !(element.closest("a")?.getAttribute("href") ?? "").includes(record) && element.dataset.tourRecord !== record) continue;
        return element;
      }
      return null;
    },
    async reveal(element) {
      const seen = measureTarget(element, viewport());
      const view = viewport();
      const whole = seen?.visible && seen.visible.width >= seen.box.width - 1 && seen.visible.height >= Math.min(seen.box.height, view.height * 0.6) - 1;
      if (whole && seen.box.top >= 64 && seen.box.top + Math.min(seen.box.height, view.height * 0.6) <= view.height - 24) return;
      const tall = (seen?.box.height ?? 0) > view.height * 0.6;
      element.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: tall ? "start" : "center", inline: "nearest" });
      // Wait until the scroll has come to rest (the element holds still for a few frames), at most a second.
      let last = "";
      let still = 0;
      const started = Date.now();
      while (still < 4 && Date.now() - started < 1000) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const rect = element.getBoundingClientRect();
        const now = `${Math.round(rect.top)}:${Math.round(rect.left)}`;
        still = now === last ? still + 1 : 0;
        last = now;
      }
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
    overlays: () => Array.from(document.querySelectorAll<HTMLElement>(OVERLAYS)).filter((element) => !element.closest(".wd-tour, .wd-tour-loader") && element.getClientRects().length > 0),
    dismiss(overlay) {
      overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      window.setTimeout(() => {
        if (!overlay.isConnected || !overlay.getClientRects().length) return;
        overlay.querySelector<HTMLElement>(`[data-tour-close], button[aria-label="${CSS.escape(t()("Close dialog"))}"]`)?.click();
      }, 300);
    },
    line(tour, step, values) {
      const fallbacks = Object.fromEntries((tour.examples ?? []).map((example) => [example.key, t()(example.fallback)]));
      // A short caption stays on screen while the longer line is heard.
      if (step.caption) return t()(step.caption, { ...fallbacks, ...values });
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

export type TourProviderProps = { children: ReactNode; userId: string; userName?: string; brandStyle?: CSSProperties; /** For the job a walkthrough follows. */ workspaceId?: string };

/** Woddy explains: plays scripted tours over the workspace. Start one from the Woddy menu or `?tour=<id>`. */
export function TourProvider(props: TourProviderProps) {
  return <ToastProvider><TourPlayer {...props} /></ToastProvider>;
}

/**
 * - `starting`: the loader covers the page while the first screen opens (demo mode is already on);
 * - `touring`: the tour plays over the page;
 * - `ending`: the loader covers the page while demo mode goes, the tour's dialogs and text are cleared, the
 *   page's data is fetched again and the person is taken back to where they started.
 */
type Stage = "idle" | "starting" | "touring" | "ending";
type Loader = { message: MessageKey; progress: number; leaving: boolean };

const STARTING = tKey("Getting the tour ready…");
const ENDING = tKey("Back to your workspace…");
/** How long the loader takes to fade in or out (the CSS transition, with a little room). */
const FADE_MS = 260;

function TourPlayer({ children, userId, userName, brandStyle, workspaceId }: TourProviderProps) {
  const t = useT();
  const { language, direction } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const toast = useToast();
  const [voice, setVoice] = useState(true);
  useEffect(() => { setVoice(readVoice(userId)); }, [userId]);

  const live = useRef({ t, language, voice, router, toast });
  useEffect(() => { live.current = { t, language, voice, router, toast }; });
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
  const [stage, setStageState] = useState<Stage>("idle");
  const stageRef = useRef<Stage>("idle");
  const setStage = useCallback((next: Stage) => { stageRef.current = next; setStageState(next); }, []);
  const [loader, setLoader] = useState<Loader | null>(null);
  // Bumped when a tour ends: every page component below mounts afresh, so no demo state survives.
  const [epoch, setEpoch] = useState(0);
  const origin = useRef<string | null>(null);
  const phone = useMediaQuery(PHONE_MEDIA_QUERY);
  const phoneNow = useRef(phone);
  useEffect(() => { phoneNow.current = phone; });

  // Demo safety: from the moment a tour starts until it has fully ended, nothing is written. A quiet notice
  // says so (at most every few seconds). `data-tour-demo` on the page marks the guard for checks.
  const guard = useRef<(() => void) | null>(null);
  const armGuard = useCallback(() => {
    if (guard.current) return;
    let last = 0;
    const remove = installWriteGuard(() => {
      if (Date.now() - last < 4000) return;
      last = Date.now();
      live.current.toast.push({ title: live.current.t("Demo mode: nothing is saved"), message: "", tone: "info" });
    });
    document.documentElement.dataset.tourDemo = "true";
    guard.current = () => { remove(); delete document.documentElement.dataset.tourDemo; };
  }, []);
  const disarmGuard = useCallback(() => { guard.current?.(); guard.current = null; }, []);

  const start = useCallback((id: string) => {
    const tour = tourById(id);
    if (!tour || phoneNow.current || window.matchMedia?.(PHONE_MEDIA_QUERY).matches || stageRef.current === "ending") return;
    if (stageRef.current === "idle") origin.current = currentLocation();
    setStage("starting");
    setLoader({ message: STARTING, progress: 0.12, leaving: false });
    armGuard();
    // The people in this tour: their pictures are ready before anyone takes over.
    for (const actor of new Set(tour.steps.map((step) => step.actor).filter((actor) => actor !== undefined))) new Image().src = personaAvatar(TOUR_PERSONAS[actor]);
    const firstName = userName?.trim().split(/\s+/u)[0];
    // A walkthrough that follows one job picks it now (read-only), so every step shows that job.
    // At most a few seconds (a slow first load falls back to the first record on screen).
    const job = tour.follows ? Promise.race([loadJourney(workspaceId ?? "", tour.follows), pause(8000).then(() => ({}))]) : Promise.resolve({});
    void Promise.all([job, findRecordings(tour, live.current.t, live.current.language, recorded.current)]).then(([records]) => {
      if (stageRef.current !== "starting") return;
      setLoader((current) => (current && !current.leaving ? { ...current, progress: 0.3 } : current));
      runner.start(tour, { ...records, name: firstName || live.current.t("there") });
    });
  }, [armGuard, runner, setStage, userName, workspaceId]);

  /** Ends the tour behind the loader and brings the real workspace back. */
  const leave = useCallback(async () => {
    if (stageRef.current === "idle" || stageRef.current === "ending") return;
    setStage("ending");
    setLoader({ message: ENDING, progress: 0.15, leaving: false });
    // Stop at once: no more speech, typed text cleared, the dialogs the tour opened closed.
    runner.exit();
    await pause(FADE_MS);
    disarmGuard();
    setLoader((current) => current && { ...current, progress: 0.45 });
    const back = origin.current ?? "/workspace";
    origin.current = null;
    const backPath = back.split("?")[0];
    if (`${window.location.pathname}${window.location.search}` !== back) {
      live.current.router.push(back);
      await until(() => window.location.pathname === backPath, 8000);
    }
    // Every page component mounts afresh and the server data is fetched again: nothing from the demo remains.
    setEpoch((value) => value + 1);
    live.current.router.refresh();
    setLoader((current) => current && { ...current, progress: 0.8 });
    await pause(120);
    await until(() => document.querySelector(PAGE) && !document.querySelector(`${PAGE} [aria-busy="true"]`), 4000);
    setLoader((current) => current && { ...current, progress: 1 });
    await pause(200);
    setStage("idle");
    setLoader((current) => current && { ...current, leaving: true });
  }, [disarmGuard, runner, setStage]);

  // The first screen is ready: the loader fades and the tour shows. A tour that stops by itself ends cleanly.
  const leaveNow = useRef(leave);
  useEffect(() => { leaveNow.current = leave; });
  useEffect(() => runner.subscribe(() => {
    const { status, progress } = runner.getSnapshot();
    if (stageRef.current === "starting" && status === "preparing") {
      setLoader((current) => (current && !current.leaving ? { ...current, progress: Math.max(current.progress, progress) } : current));
    } else if (stageRef.current === "starting" && (status === "running" || status === "paused" || status === "finished")) {
      setStage("touring");
      setLoader((current) => current && { ...current, progress: 1, leaving: true });
    } else if (stageRef.current === "touring" && status === "idle") {
      void leaveNow.current();
    }
  }), [runner, setStage]);

  // A fading loader is removed once its fade has finished (unless a new start or end has taken it over).
  const fading = Boolean(loader?.leaving);
  useEffect(() => {
    if (!fading) return;
    const timer = window.setTimeout(() => setLoader((current) => (current?.leaving ? null : current)), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [fading]);

  // No explainer on phones: a tour that is running when the screen narrows to phone width ends cleanly.
  useEffect(() => { if (phone) void leave(); }, [phone, leave]);

  useEffect(() => () => { runner.exit(); guard.current?.(); guard.current = null; }, [runner]);
  // The loader's Woddy is ready before it is needed, so the loader never shows without him.
  useEffect(() => { if (!phone) new Image().src = woddyPath("thinking"); }, [phone]);

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

  const active = stage !== "idle";
  const persona = stage === "touring" && state.actor ? TOUR_PERSONAS[state.actor] : null;
  const personaView = useMemo<TourPersonaView | null>(() => (persona ? {
    id: persona.id, label: t(persona.label), switchLine: t(persona.switchLine), avatar: personaAvatar(persona), color: persona.color,
  } : null), [persona, t]);
  const minutes = useCallback((tour: Tour) => tourMinutes(tour, (key) => t(key as MessageKey)), [t]);
  const controls = useMemo<TourControls>(() => ({ available: !phone, tours, current: tourForPath(pathname), active, start, minutes, persona, personaView, userId }),
    [phone, pathname, active, start, minutes, persona, personaView, userId]);

  const tour = state.tour;
  const next = tour?.next ? tourById(tour.next) : undefined;
  const showing = (stage === "touring" || stage === "starting") && tour && state.status !== "idle" && state.status !== "preparing" && !phone;
  return <TourContext.Provider value={controls}>
    <Fragment key={epoch}>{children}</Fragment>
    {showing ? <TourOverlay
      clicks={state.clicks}
      direction={direction}
      finished={state.status === "finished"}
      glideMs={TOUR_PACE.glide / state.speed}
      nextTour={next ? { title: t(next.title), onStart: () => start(next.id) } : null}
      note={state.missing ? t("I can't find this part of the screen right now, so let's skip ahead.") : null}
      onBack={() => runner.back()}
      onExit={() => void leave()}
      onNext={() => runner.next()}
      onSpeed={(speed) => runner.setSpeed(speed as TourSpeed)}
      onToggle={() => runner.toggle()}
      onVoice={toggleVoice}
      persona={personaView}
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
    {loader ? <TourLoader direction={direction} leaving={loader.leaving} message={t(loader.message)} progress={loader.progress} style={brandStyle} /> : null}
  </TourContext.Provider>;
}
