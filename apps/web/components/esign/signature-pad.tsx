"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./esign.module.css";

/**
 * A drawn signature (R8): pointer, touch or pen on a canvas, exported as a PNG data URL. The ink follows the
 * theme's text colour; the exported image is always dark ink on a transparent background so it prints on paper.
 * Keyboard users sign by typing their name instead (the pad's sibling).
 */
export function SignaturePad({ onChange, label }: { onChange: (png: string | null) => void; label: string }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const strokes = useRef(0);
  const [empty, setEmpty] = useState(true);

  const context = useCallback(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return null;
    return { element, ctx };
  }, []);

  // The bitmap matches the box at the device's pixel ratio, so lines stay sharp on phones.
  useEffect(() => {
    const target = context();
    if (!target) return;
    const ratio = window.devicePixelRatio || 1;
    const box = target.element.getBoundingClientRect();
    target.element.width = Math.max(1, Math.round(box.width * ratio));
    target.element.height = Math.max(1, Math.round(box.height * ratio));
    target.ctx.scale(ratio, ratio);
    target.ctx.lineCap = "round";
    target.ctx.lineJoin = "round";
    target.ctx.lineWidth = 2.2;
    // Paper ink: the pad is always a paper surface (light in both themes), so the ink is the darkest neutral.
    target.ctx.strokeStyle = getComputedStyle(target.element).getPropertyValue("--wd-neutral-900").trim() || "black";
  }, [context]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = point(event);
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const target = context();
    if (!drawing.current || !target || !last.current) return;
    const next = point(event);
    target.ctx.beginPath();
    target.ctx.moveTo(last.current.x, last.current.y);
    target.ctx.lineTo(next.x, next.y);
    target.ctx.stroke();
    last.current = next;
    strokes.current += 1;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const target = context();
    // A dot or a stray tap is not a signature.
    if (!target || strokes.current < 8) return;
    setEmpty(false);
    onChange(target.element.toDataURL("image/png"));
  };
  const clear = () => {
    const target = context();
    if (target) target.ctx.clearRect(0, 0, target.element.width, target.element.height);
    strokes.current = 0;
    setEmpty(true);
    onChange(null);
  };

  return <div className={styles.pad}>
    <canvas ref={canvas} className={styles.canvas} aria-label={label} role="img" data-empty={empty || undefined}
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onPointerLeave={end} />
    <div className={styles.padFoot}>
      <span className={styles.hint}>{empty ? t("Sign with your finger, pen or mouse") : t("Signed")}</span>
      <Button size="compact" variant="quiet" isDisabled={empty} onPress={clear}><Eraser aria-hidden="true" size={14} />{t("Clear")}</Button>
    </div>
  </div>;
}
