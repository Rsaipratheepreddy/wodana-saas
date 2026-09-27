import type { MessageKey } from "@/lib/i18n/messages";

/**
 * The browser (a product name, shown as is) and the kind of device (a label to translate) a
 * session signed in from. Either is null when the user agent doesn't say; callers then show
 * "Browser" alone rather than "Unknown …".
 */
export function deviceDetails(userAgent: string | null): { browser: string | null; device: MessageKey | null; mobile: boolean } {
  const value = userAgent ?? "";
  const app = /\bExpo\b|okhttp|CFNetwork|Dalvik|\bWodana\//i.test(value);
  const browser = app ? "Wodana app"
    : /Edg(?:e|A|iOS)?\//.test(value) ? "Microsoft Edge"
      : /OPR\/|Opera/.test(value) ? "Opera"
        : /SamsungBrowser\//.test(value) ? "Samsung Internet"
          : /Firefox\/|FxiOS\//.test(value) ? "Firefox"
            : /Chrome\/|CriOS\/|Chromium\//.test(value) ? "Google Chrome"
              : /Version\/[\d.]+.*Safari\/|Safari\//.test(value) ? "Safari"
                : null;
  const device: MessageKey | null = /iPad/.test(value) ? "iPad"
    : /iPhone|iPod/.test(value) ? "iPhone"
      : /Android/.test(value) ? (/Mobile/.test(value) ? "Android phone" : "Android tablet")
        : /CrOS/.test(value) ? "Chromebook"
          : /Windows/.test(value) ? "Windows computer"
            : /Macintosh|Mac OS X|Darwin/.test(value) ? "Mac"
              : /Linux|X11/.test(value) ? "Linux computer"
                : null;
  return { browser, device, mobile: /iPhone|iPad|iPod|Android/.test(value) };
}
