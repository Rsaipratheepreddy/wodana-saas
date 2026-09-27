"use client";

/* eslint-disable @next/next/no-img-element -- static brand files from /public; no optimisation needed */
import { woddyPath, type WoddyPose } from "@wodana/contracts/brand";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";

const poseLabels = {
  main: tKey("Woddy"),
  hello: tKey("Woddy says hello"),
  thinking: tKey("Woddy is thinking"),
  working: tKey("Woddy is working on it"),
  celebrating: tKey("Woddy is celebrating"),
  oops: tKey("Woddy could not do it"),
  idle: tKey("Woddy"),
} as const;

/** The pose for an AI task's state: welcome or empty, loading, running, done, error. */
export const woddyPoseFor = { empty: "hello", loading: "thinking", running: "working", done: "celebrating", error: "oops", idle: "idle" } as const satisfies Record<string, WoddyPose>;

/**
 * Woddy, the assistant. `main` is the large portrait (451×512); every other pose is square.
 * Purely decorative next to Woddy's name? Pass `decorative` and the picture is hidden from assistive tech.
 * `motion="idle"` adds a subtle bob (none under reduced motion); nothing else moves.
 */
export function Woddy({ pose = "idle", size = 32, decorative = false, motion, className }: { pose?: WoddyPose; size?: number; decorative?: boolean; motion?: "idle"; className?: string }) {
  const t = useT();
  const width = pose === "main" ? Math.round(size * 451 / 512) : size;
  return <img
    alt={decorative ? "" : t(poseLabels[pose])}
    aria-hidden={decorative || undefined}
    className={["wd-woddy", className].filter(Boolean).join(" ")}
    data-motion={motion}
    data-pose={pose}
    decoding="async"
    draggable={false}
    height={size}
    src={woddyPath(pose)}
    width={width}
  />;
}
