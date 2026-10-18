"use client";

import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import type { WoddyPose } from "@wodana/contracts/brand";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/i18n-provider";
import { isTypingTarget } from "@/lib/keyboard/typing-target";
import { cursorOffset, placeBubble, pointerTip, restingTip, spotlightHole, viewport, watchTarget, type TargetView } from "@/lib/tours/position";
import { Button, IconButton } from "../components/actions";
import { Woddy } from "../components/woddy";

/** The person working on the current step, as the cursor and the switch card show them. */
export type TourPersonaView = {
  id: string;
  /** "Finance" */
  label: string;
  /** "Now as Finance" */
  switchLine: string;
  /** The brand role picture. */
  avatar: string;
  /** A colour token (`var(--wd-color-…)`) for the cursor and name chip. */
  color: string;
};

export type TourOverlayProps = {
  /** The tour's name, for assistive technology. */
  title: string;
  step: number;
  total: number;
  text: string;
  /** Replaces the text when a step's target could not be found. */
  note?: string | null;
  /** Woddy's expression for this step. */
  pose: WoddyPose;
  pointer: HTMLElement | null;
  spotlight: HTMLElement | null;
  /** Increments on every click; replays the ripple. */
  clicks: number;
  /** Cursor glide time at the chosen speed. */
  glideMs: number;
  playing: boolean;
  finished: boolean;
  speed: number;
  speeds: readonly number[];
  onSpeed: (speed: number) => void;
  voice: boolean;
  onVoice: () => void;
  onToggle: () => void;
  onBack: () => void;
  onNext: () => void;
  onExit: () => void;
  /** Offered when the tour has finished. */
  nextTour?: { title: string; onStart: () => void } | null;
  direction?: "ltr" | "rtl";
  /** Tenant brand variables, so the cursor and actions follow the workspace colour. */
  style?: CSSProperties;
  /** Where the step is (switching, loading, seeking, moving, acting, speaking, resting); exposed for replay scripts. */
  phase?: string;
  /** Who is working on this step: the cursor takes their colour and name. */
  persona?: TourPersonaView | null;
};

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keeps a live view of an element: its box and the part of it that can be seen right now. Until a new element
 * has been measured the last measurement stands, so nothing jumps to a guessed place in between.
 */
function useTargetView(element: HTMLElement | null) {
  const [view, setView] = useState<TargetView | null>(null);
  useEffect(() => watchTarget(element, setView), [element]);
  return element ? view : null;
}

const subscribeNothing = () => () => undefined;

/**
 * Woddy explains: a soft spotlight on the part being explained, the cursor of the person working on the step
 * gliding there and clicking, and a caption bubble with the line, the step count and the player controls.
 * Rendered in the top layer so app dialogs neither hide nor dismiss it; the page underneath is not interactive
 * while it shows. The cursor never points at a stale place: it follows its target as the page scrolls or
 * changes, and hides while the target is out of sight or another screen is loading.
 */
export function TourOverlay(props: TourOverlayProps) {
  const t = useT();
  const { title, step, total, text, note, pose, pointer, spotlight, clicks, glideMs, playing, finished, speed, speeds, onSpeed, voice, onVoice, onToggle, onBack, onNext, onExit, nextTour, direction = "ltr", style, phase, persona } = props;
  const bubble = useRef<HTMLElement>(null);
  const [bubbleSize, setBubbleSize] = useState({ width: 352, height: 160 });
  // Rendered in the browser only (it measures the page); false during server rendering and hydration.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const loading = phase === "loading";
  const switching = phase === "switching";
  const spot = useTargetView(loading || switching ? null : spotlight);
  const aim = useTargetView(loading || switching ? null : pointer);
  const rtl = direction === "rtl";
  // A new spotlight target remounts the cut-out, so under reduced motion it fades in instead of sliding.
  const [spotKey, setSpotKey] = useState(0);
  const [spotFor, setSpotFor] = useState<HTMLElement | null>(null);
  if (spotFor !== spotlight) { setSpotFor(spotlight); if (reducedMotion()) setSpotKey((key) => key + 1); }
  // The cursor glides to a new target, then follows it exactly (no lag while the page scrolls under it).
  const [gliding, setGliding] = useState(false);
  const [glideFor, setGlideFor] = useState<HTMLElement | null>(null);
  if (glideFor !== pointer) { setGlideFor(pointer); setGliding(true); }
  useEffect(() => {
    if (!gliding) return;
    const timer = window.setTimeout(() => setGliding(false), glideMs + 60);
    return () => window.clearTimeout(timer);
  }, [gliding, glideMs, glideFor]);

  // Focus moves to the bubble while it shows and returns where it was afterwards.
  useEffect(() => {
    if (!mounted) return;
    const previous = document.activeElement as HTMLElement | null;
    bubble.current?.focus({ preventScroll: true });
    return () => { previous?.focus?.({ preventScroll: true }); };
  }, [mounted]);

  // Keyboard: Esc exits; arrows step (mirrored in right-to-left).
  const keys = useRef({ onBack, onNext, onExit, rtl });
  useEffect(() => { keys.current = { onBack, onNext, onExit, rtl }; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.isTrusted) return;
      const handlers = keys.current;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); handlers.onExit(); return; }
      const typing = isTypingTarget(event.target);
      if (typing || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key === (handlers.rtl ? "ArrowLeft" : "ArrowRight")) { event.preventDefault(); handlers.onNext(); }
      else if (event.key === (handlers.rtl ? "ArrowRight" : "ArrowLeft")) { event.preventDefault(); handlers.onBack(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useLayoutEffect(() => {
    const element = bubble.current;
    if (!element) return;
    const measure = () => setBubbleSize((size) => (size.width === element.offsetWidth && size.height === element.offsetHeight ? size : { width: element.offsetWidth, height: element.offsetHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted]);

  if (!mounted) return null;
  const view = viewport();
  const hole = spot ? spotlightHole(spot.box, view) : null;
  const place = placeBubble(hole, bubbleSize, view);
  // Logical offsets: inline-start is the right edge in right-to-left.
  const inlineStart = (left: number, width: number) => (rtl ? view.width - left - width : left);
  const spotStyle: CSSProperties = hole
    ? { insetBlockStart: hole.top, insetInlineStart: inlineStart(hole.left, hole.width), inlineSize: hole.width, blockSize: hole.height }
    : { insetBlockStart: view.height / 2, insetInlineStart: view.width / 2, inlineSize: 0, blockSize: 0 };
  // The cursor points at what can be seen of its target; with nothing to point at it rests by the bubble; it
  // hides while its target is out of sight, while another screen loads and while someone else takes over.
  const hidden = finished || loading || switching || Boolean(pointer && !aim?.visible);
  const tip = aim?.visible ? pointerTip(aim.visible, rtl) : restingTip({ ...place, width: bubbleSize.width }, rtl);
  const offset = cursorOffset(tip, view, rtl);
  const cursorStyle: CSSProperties = { transform: `translate(${offset.x}px, ${offset.y}px)` };
  const rootStyle = { ...style, "--wd-tour-glide": `${Math.round(glideMs)}ms`, ...(persona ? { "--wd-tour-actor": persona.color } : {}) } as CSSProperties;
  const bubbleStyle: CSSProperties = { insetBlockStart: place.top, insetInlineStart: inlineStart(place.left, bubbleSize.width) };
  const nextSpeed = speeds[(speeds.indexOf(speed) + 1) % speeds.length] ?? 1;

  const trapTab = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !bubble.current) return;
    const focusable = Array.from(bubble.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href]"));
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === bubble.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return createPortal(
    <div className="wd-tour" data-actor={persona?.id} data-missing={note ? true : undefined} data-phase={finished ? "finished" : phase} data-react-aria-top-layer="true" data-rtl={rtl || undefined} data-step={step} dir={direction} style={rootStyle}>
      <div className="wd-tour-blocker" aria-hidden="true" onPointerDown={(event) => event.preventDefault()} onClick={(event) => event.preventDefault()} />
      <div className="wd-tour-spotlight" data-empty={!hole || undefined} key={spotKey} style={spotStyle} aria-hidden="true" />
      <div className="wd-tour-cursor" data-follow={!gliding || undefined} data-hidden={hidden || undefined} style={cursorStyle} aria-hidden="true">
        <svg className="wd-tour-pointer" viewBox="0 0 24 24" width="26" height="26">
          <path d="M3 2.5 20.5 10.2c.9.4.8 1.7-.1 2l-7 2.1-2.4 6.8c-.3.9-1.6 1-2 .1L2.1 3.4c-.3-.6.3-1.2.9-.9Z" />
        </svg>
        {persona ? <span className="wd-tour-actor">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand avatar from /public */}
          <img alt="" className="wd-tour-actor-avatar" decoding="async" draggable={false} height={20} src={persona.avatar} width={20} />
          <span className="wd-tour-actor-name">{persona.label}</span>
        </span> : <Woddy className="wd-tour-cursor-woddy" decorative pose="hello" size={24} />}
        {clicks ? <span className="wd-tour-ripple" key={clicks} /> : null}
      </div>
      {switching && persona ? <div className="wd-tour-switch" key={persona.id} role="status">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand avatar from /public */}
        <img alt="" className="wd-tour-switch-avatar" decoding="async" draggable={false} height={56} src={persona.avatar} width={56} />
        <span className="wd-tour-switch-line">{persona.switchLine}</span>
      </div> : null}
      <section
        aria-describedby="wd-tour-text"
        aria-label={title}
        className="wd-tour-bubble"
        onKeyDown={trapTab}
        ref={bubble}
        role="dialog"
        style={bubbleStyle}
        tabIndex={-1}
      >
        <Woddy className="wd-tour-woddy" decorative pose={loading ? "thinking" : pose} size={48} />
        <div className="wd-tour-copy">
          {loading ? <p className="wd-tour-loading" role="status"><span aria-hidden="true" className="wd-tour-dots"><span /><span /><span /></span>{t("Opening…")}</p>
            : <p className="wd-tour-text" dir="auto" id="wd-tour-text" aria-live="polite" data-note={note ? true : undefined}>{note ?? text}</p>}
          {finished ? <div className="wd-tour-finish">
            {nextTour ? <Button size="compact" variant="primary" onPress={nextTour.onStart}>{t("Next: {title}", { title: nextTour.title })}</Button> : null}
            <Button size="compact" onPress={onExit}>{t("Done")}</Button>
          </div> : <div className="wd-tour-controls">
            <span className="wd-tour-count">{t("{current} of {total}", { current: step, total })}</span>
            <IconButton aria-label={t("Previous step")} isDisabled={step <= 1} onPress={onBack} size="compact"><ChevronLeft aria-hidden="true" size={16} /></IconButton>
            <IconButton aria-label={playing ? t("Pause") : t("Play")} onPress={onToggle} size="compact">{playing ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}</IconButton>
            <IconButton aria-label={t("Next step")} onPress={onNext} size="compact"><ChevronRight aria-hidden="true" size={16} /></IconButton>
            <Button aria-label={t("Speed {speed}×", { speed })} className="wd-tour-speed" onPress={() => onSpeed(nextSpeed)} size="compact" variant="quiet">{t("{speed}×", { speed })}</Button>
            <IconButton aria-label={voice ? t("Turn voice off") : t("Turn voice on")} aria-pressed={voice} onPress={onVoice} size="compact">{voice ? <Volume2 aria-hidden="true" size={16} /> : <VolumeX aria-hidden="true" size={16} />}</IconButton>
            <IconButton aria-label={t("Exit tour")} onPress={onExit} size="compact"><X aria-hidden="true" size={16} /></IconButton>
          </div>}
        </div>
      </section>
    </div>,
    document.body,
  );
}
