"use client";

import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button, type ButtonProps } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { CAPTURE_MAX_BYTES, shrinkPhoto, waitForReading, type CaptureApi, type CaptureState } from "@/lib/books/capture-client";

/**
 * "From photo": the bill's photo (the camera on a phone, a file picker on a desktop) or its PDF goes to Woddy, who
 * reads it into a draft invoice. The caller opens the result for the person to check beside the original.
 */
export function FromPhotoButton({ api, onCaptured, onError, size = "compact", variant = "secondary" }: {
  api: Pick<CaptureApi, "upload" | "get">; onCaptured: (state: CaptureState) => void; onError: (message: string) => void;
  size?: ButtonProps["size"]; variant?: ButtonProps["variant"];
}) {
  const t = useT();
  const picker = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"idle" | "uploading" | "reading">("idle");
  // Phones take the photo there and then; desktops choose a file (a photo or a PDF).
  const camera = typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches);

  const send = async (chosen: File) => {
    setStep("uploading"); onError("");
    try {
      const file = await shrinkPhoto(chosen);
      if (file.size > CAPTURE_MAX_BYTES) throw new Error(t("Choose a photo or PDF up to 6 MB."));
      let state = await api.upload(file);
      if (state.capture.status === "reading") { setStep("reading"); state = await waitForReading(api, state); }
      onCaptured(state);
    } catch (cause) {
      onError(cause instanceof Error && cause.message ? translateKnown(t, cause.message) : t("The bill could not be read."));
    } finally { setStep("idle"); }
  };

  const label = step === "uploading" ? t("Uploading the bill…") : step === "reading" ? t("Woddy is reading…") : t("From photo");
  return <>
    <Button isLoading={step !== "idle"} onPress={() => picker.current?.click()} size={size} variant={variant}>
      <Camera aria-hidden="true" size={14} />{label}
    </Button>
    <span className="wd-visually-hidden" role="status">{step === "idle" ? "" : label}</span>
    <input accept="image/*,application/pdf" aria-label={t("Photo or PDF of the bill")} capture={camera ? "environment" : undefined} className="wd-visually-hidden"
      onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void send(file); }} ref={picker} tabIndex={-1} type="file" />
  </>;
}
