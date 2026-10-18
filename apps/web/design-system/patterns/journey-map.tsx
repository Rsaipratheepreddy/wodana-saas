"use client";

import Link from "next/link";
import { Check, ChevronDown, Circle, CircleDot, Minus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/i18n-provider";
import { Switch } from "../components/forms";

export type JourneyMapStepState = "done" | "now" | "next" | "upcoming" | "skipped";
export type JourneyMapStep = { key: string; band: string; lane: string; label: string; state: JourneyMapStepState; detail?: string | null; href?: string | null; late?: boolean };
export type JourneyMapBand = { key: string; label: string; state: "done" | "now" | "upcoming" | "skipped"; done: number; total: number; hue?: 1 | 2 | 3 | 4 | 5 | 6 };

const ICON: Record<JourneyMapStepState, ReactNode> = {
  done: <Check aria-hidden="true" size={10} strokeWidth={3} />,
  now: <CircleDot aria-hidden="true" size={10} />,
  next: <Circle aria-hidden="true" size={10} />,
  upcoming: <Circle aria-hidden="true" size={10} />,
  skipped: <Minus aria-hidden="true" size={10} />,
};

/**
 * §0.3 P2: the job's map. On a wide screen a swimlane grid: columns are the chapters (Win · Design · Price · Make ·
 * Install · Care), rows are who does the work; each cell holds that seat's steps in that chapter, in order. When the map
 * is narrow the chapters stack, each with its steps and who does them. It opens on the chapter now, with the step now marked
 * and late steps flagged; steps that aren't part of this job stay out of the way until asked for.
 */
export function JourneyMap({ label, bands, lanes, steps, stateLabel }: {
  label: string;
  bands: JourneyMapBand[];
  lanes: Array<{ key: string; label: string }>;
  steps: JourneyMapStep[];
  stateLabel: (state: JourneyMapStepState) => string;
}) {
  const t = useT();
  const [showSkipped, setShowSkipped] = useState(false);
  const [narrow, setNarrow] = useState(false);
  // Stacked, a finished chapter folds to its header until opened.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const frame = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // One layout at a time, by the map's own width (stacked under 40rem).
  useEffect(() => {
    const box = frame.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width) setNarrow(width < parseFloat(getComputedStyle(document.documentElement).fontSize || "16") * 40);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const skipped = steps.filter((step) => step.state === "skipped").length;
  const visible = showSkipped ? steps : steps.filter((step) => step.state !== "skipped");
  const shown = bands.filter((band) => visible.some((step) => step.band === band.key));
  const usedLanes = lanes.filter((lane) => visible.some((step) => step.lane === lane.key));
  const laneName = new Map(lanes.map((lane) => [lane.key, lane.label]));
  // Open on the chapter now: scroll the grid sideways only (never the page).
  useEffect(() => {
    const box = scroller.current;
    const band = box?.querySelector<HTMLElement>(".wd-journey-band[data-state='now']");
    if (!box || !band || box.scrollWidth <= box.clientWidth) return;
    const lane = box.querySelector<HTMLElement>(".wd-journey-corner")?.offsetWidth ?? 0;
    const rtl = getComputedStyle(box).direction === "rtl";
    const start = rtl ? box.scrollWidth - band.offsetLeft - band.offsetWidth : band.offsetLeft;
    box.scrollLeft = (rtl ? -1 : 1) * Math.max(0, start - lane);
  }, [shown.length, narrow]);
  const node = (step: JourneyMapStep, withLane = false) => {
    const who = withLane ? laneName.get(step.lane) : null;
    const line = [who, step.late ? t("Late") : null, step.detail].filter(Boolean).join(" · ");
    const body = <><span className="wd-journey-mark">{ICON[step.state]}</span><span className="wd-journey-text"><span className="wd-journey-label">{step.label}</span>
      {line ? <span className="wd-journey-detail">{line}</span> : null}</span></>;
    const name = [step.label, stateLabel(step.state), step.late ? t("Late") : null, step.detail].filter(Boolean).join(" · ");
    return <li key={step.key}>{step.href && step.state !== "skipped"
      ? <Link className="wd-journey-step" data-state={step.state} data-late={step.late || undefined} href={step.href} aria-label={name} aria-current={step.state === "now" ? "step" : undefined}>{body}</Link>
      : <span className="wd-journey-step" data-state={step.state} data-late={step.late || undefined} aria-label={name}>{body}</span>}</li>;
  };
  const head = (band: JourneyMapBand) => <>
    <span className="wd-journey-band-label">{band.label}</span>
    <span className="wd-journey-band-count">{band.state === "done" ? <Check aria-hidden="true" size={11} strokeWidth={3} /> : null}
      {band.total ? t("{done} of {total}", { done: band.done, total: band.total }) : stateLabel("skipped")}</span>
  </>;
  return <section className="wd-journey" aria-label={label} ref={frame}>
    {skipped ? <div className="wd-journey-tools">
      <Switch isSelected={showSkipped} onChange={setShowSkipped}>{t("Steps not in this job ({count})", { count: skipped })}</Switch>
    </div> : null}
    <div className="wd-journey-frame">
      {narrow ? <div className="wd-journey-stack">
        {shown.map((band) => {
          const folds = band.state === "done";
          const open = !folds || opened.has(band.key);
          const header = <div className="wd-journey-band" data-state={band.state} data-hue={band.hue}>{head(band)}</div>;
          return <section key={band.key} className="wd-journey-chapter" data-state={band.state} aria-label={band.label}>
            {folds ? <button type="button" className="wd-journey-fold" aria-expanded={open}
              onClick={() => setOpened((current) => { const next = new Set(current); if (next.has(band.key)) next.delete(band.key); else next.add(band.key); return next; })}>
              {header}<ChevronDown aria-hidden="true" size={14} /></button> : header}
            {open ? <ol>{visible.filter((step) => step.band === band.key).map((step) => node(step, true))}</ol> : null}
          </section>;
        })}
      </div> : <div className="wd-journey-scroll" ref={scroller}>
        <div className="wd-journey-grid" style={{ gridTemplateColumns: `var(--wd-journey-lane) repeat(${shown.length}, minmax(var(--wd-journey-step), 1fr))` }}>
          <span className="wd-journey-corner" aria-hidden="true" />
          {shown.map((band) => <div key={band.key} className="wd-journey-band" data-state={band.state} data-hue={band.hue}>{head(band)}</div>)}
          {usedLanes.map((lane) => <div key={lane.key} className="wd-journey-row">
            <div className="wd-journey-lane">{lane.label}</div>
            {shown.map((band) => {
              const inCell = visible.filter((step) => step.band === band.key && step.lane === lane.key);
              return <div key={band.key} className="wd-journey-cell" data-band-state={band.state}>
                {inCell.length ? <ol aria-label={`${lane.label} · ${band.label}`}>{inCell.map((step) => node(step))}</ol> : null}
              </div>;
            })}
          </div>)}
        </div>
      </div>}
    </div>
  </section>;
}
