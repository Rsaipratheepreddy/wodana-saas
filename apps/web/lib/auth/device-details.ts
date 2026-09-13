export function deviceDetails(userAgent: string | null) {
  const value = userAgent ?? "";
  const browser = /Edg\//.test(value) ? "Microsoft Edge"
    : /Chrome\//.test(value) ? "Google Chrome"
      : /Firefox\//.test(value) ? "Firefox"
        : /Safari\//.test(value) ? "Safari"
          : "Unknown browser";
  const device = /iPhone|iPad/.test(value) ? "iPhone or iPad"
    : /Android/.test(value) ? "Android device"
      : /Windows/.test(value) ? "Windows computer"
        : /Macintosh|Mac OS X/.test(value) ? "Mac"
          : /Linux/.test(value) ? "Linux computer"
            : "Unknown device";
  return { browser, device, mobile: /iPhone|iPad|Android/.test(value) };
}

