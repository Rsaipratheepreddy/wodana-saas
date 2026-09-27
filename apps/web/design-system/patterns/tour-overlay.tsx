"use client";

import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import type { WoddyPose } from "@wodana/contracts/brand";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n/i18n-provider";
import { Button, IconButton } from "../components/actions";
import { Woddy } from "../components/woddy";

type Box = { top: number; left: number; width: number; height: number };

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
  /** Where the step is (seeking, moving, acting, speaking, resting); exposed for replay scripts. */
  phase?: string;
};

const SPOT_PADDING = 8;
const GAP = 16;
const EDGE = 16;

function boxOf(element: HTMLElement | null): Box | null {
  if (!element?.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  // A field's open suggestions belong to it: keep them in the spotlight and out from under the bubble.
  const controlled = element.getAttribute("aria-controls");
  const list = controlled && element.getAttribute("aria-expanded") === "true" ? document.getElementById(controlled)?.getBoundingClientRect() : null;
  if (!list || (!list.width && !list.height)) return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  const top = Math.min(rect.top, list.top), left = Math.min(rect.left, list.left);
  return { top, left, width: Math.max(rect.right, list.right) - left, height: Math.max(rect.bottom, list.bottom) - top };
}

function sameBox(a: Box | null, b: Box | null) {
  if (!a || !b) return a === b;
  return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/** Keeps a live viewport box for an element (it scrolls, resizes and moves with the page). */
function useLiveBox(element: HTMLElement | null) {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    let frame = 0;
    let last: Box | null = null;
    const tick = () => {
      const next = boxOf(element);
      if (!sameBox(last, next)) { last = next; setBox(next); }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [element]);
  return box;
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function viewport() {
  return { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
}

/** Where the bubble goes: beside the target, never on it; pinned to the bottom when the target fills the screen. */
function placeBubble(target: Box | null, bubble: { width: number; height: number }, view: { width: number; height: number }) {
  const clampLeft = (left: number) => Math.min(Math.max(EDGE, left), view.width - bubble.width - EDGE);
  const clampTop = (top: number) => Math.min(Math.max(EDGE, top), view.height - bubble.height - EDGE);
  if (!target) return { top: view.height - bubble.height - EDGE * 2, left: (view.width - bubble.width) / 2 };
  const below = view.height - (target.top + target.height);
  if (below >= bubble.height + GAP * 2) return { top: target.top + target.height + GAP, left: clampLeft(target.left) };
  if (target.top >= bubble.height + GAP * 2) return { top: target.top - bubble.height - GAP, left: clampLeft(target.left) };
  const after = view.width - (target.left + target.width);
  if (after >= bubble.width + GAP * 2) return { top: clampTop(target.top), left: target.left + target.width + GAP };
  if (target.left >= bubble.width + GAP * 2) return { top: clampTop(target.top), left: target.left - bubble.width - GAP };
  return { top: view.height - bubble.height - EDGE, left: clampLeft(view.width - bubble.width - EDGE) };
}

/**
 * Woddy explains: a soft spotlight on the part being explained, Woddy's cursor gliding there and clicking,
 * and a caption bubble with the line, the step count and the player controls. Rendered in the top layer so
 * app dialogs neither hide nor dismiss it; the page underneath is not interactive while it shows.
 */
export function TourOverlay(props: TourOverlayProps) {
  const t = useT();
  const { title, step, total, text, note, pose, pointer, spotlight, clicks, glideMs, playing, finished, speed, speeds, onSpeed, voice, onVoice, onToggle, onBack, onNext, onExit, nextTour, direction = "ltr", style, phase } = props;
  const bubble = useRef<HTMLElement>(null);
  const [bubbleSize, setBubbleSize] = useState({ width: 352, height: 160 });
  const [mounted, setMounted] = useState(false);
  const spot = useLiveBox(spotlight);
  const aim = useLiveBox(pointer);
  const rtl = direction === "rtl";
  // A new spotlight target remounts the cut-out, so under reduced motion it fades in instead of sliding.
  const [spotKey, setSpotKey] = useState(0);
  const [spotFor, setSpotFor] = useState<HTMLElement | null>(null);
  if (spotFor !== spotlight) { setSpotFor(spotlight); if (reducedMotion()) setSpotKey((key) => key + 1); }

  useEffect(() => { setMounted(true); }, []);

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
      const typing = (event.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']");
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
  const hole = spot ? {
    top: Math.max(0, spot.top - SPOT_PADDING),
    left: Math.max(0, spot.left - SPOT_PADDING),
    width: Math.min(view.width, spot.width + SPOT_PADDING * 2),
    height: Math.min(view.height - Math.max(0, spot.top - SPOT_PADDING), spot.height + SPOT_PADDING * 2),
  } : null;
  const place = placeBubble(hole, bubbleSize, view);
  // Logical offsets: inline-start is the right edge in right-to-left.
  const inlineStart = (left: number, width: number) => (rtl ? view.width - left - width : left);
  const spotStyle: CSSProperties = hole
    ? { insetBlockStart: hole.top, insetInlineStart: inlineStart(hole.left, hole.width), inlineSize: hole.width, blockSize: hole.height }
    : { insetBlockStart: view.height / 2, insetInlineStart: view.width / 2, inlineSize: 0, blockSize: 0 };
  // The cursor tip rests near the target's start, or beside the bubble when nothing is pointed at.
  const tip = aim
    ? { x: rtl ? aim.left + aim.width - Math.min(aim.width / 2, 56) : aim.left + Math.min(aim.width / 2, 56), y: aim.top + Math.min(aim.height / 2, 28) }
    : { x: rtl ? place.left + bubbleSize.width - 24 : place.left + 24, y: place.top - 12 };
  const cursorStyle: CSSProperties = { transform: `translate(${rtl ? tip.x - view.width : tip.x}px, ${tip.y}px)` };
  const rootStyle = { ...style, "--wd-tour-glide": `${Math.round(glideMs)}ms` } as CSSProperties;
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
    <div className="wd-tour" data-missing={note ? true : undefined} data-phase={finished ? "finished" : phase} data-react-aria-top-layer="true" data-rtl={rtl || undefined} data-step={step} dir={direction} style={rootStyle}>
      <div className="wd-tour-blocker" aria-hidden="true" onPointerDown={(event) => event.preventDefault()} onClick={(event) => event.preventDefault()} />
      <div className="wd-tour-spotlight" data-empty={!hole || undefined} key={spotKey} style={spotStyle} aria-hidden="true" />
      <div className="wd-tour-cursor" data-hidden={finished || undefined} style={cursorStyle} aria-hidden="true">
        <svg className="wd-tour-pointer" viewBox="0 0 24 24" width="26" height="26">
          <path d="M3 2.5 20.5 10.2c.9.4.8 1.7-.1 2l-7 2.1-2.4 6.8c-.3.9-1.6 1-2 .1L2.1 3.4c-.3-.6.3-1.2.9-.9Z" />
        </svg>
        <Woddy className="wd-tour-cursor-woddy" decorative pose="hello" size={24} />
        {clicks ? <span className="wd-tour-ripple" key={clicks} /> : null}
      </div>
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
        <Woddy className="wd-tour-woddy" decorative pose={pose} size={48} />
        <div className="wd-tour-copy">
          <p className="wd-tour-text" dir="auto" id="wd-tour-text" aria-live="polite" data-note={note ? true : undefined}>{note ?? text}</p>
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
