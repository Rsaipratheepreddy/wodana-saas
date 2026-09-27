import { tKey } from "@/lib/i18n/keys";

/** Browser and device names; the descriptive ones are en.json keys, so callers show them with `t()`. */
export function deviceDetails(userAgent: string | null) {
  const value = userAgent ?? "";
  const browser = /Edg\//.test(value) ? "Microsoft Edge"
    : /Chrome\//.test(value) ? "Google Chrome"
      : /Firefox\//.test(value) ? "Firefox"
        : /Safari\//.test(value) ? "Safari"
          : tKey("Unknown browser");
  const device = /iPhone|iPad/.test(value) ? tKey("iPhone or iPad")
    : /Android/.test(value) ? tKey("Android device")
      : /Windows/.test(value) ? tKey("Windows computer")
        : /Macintosh|Mac OS X/.test(value) ? "Mac"
          : /Linux/.test(value) ? tKey("Linux computer")
            : tKey("Unknown device");
  return { browser, device, mobile: /iPhone|iPad|Android/.test(value) };
}

