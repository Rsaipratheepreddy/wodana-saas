import { describe, expect, it } from "vitest";
import { deviceDetails } from "./device-details";

describe("signed-in device names", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Safari", "Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0", "Microsoft Edge", "Windows computer"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1", "Google Chrome", "iPhone"],
    ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36", "Samsung Internet", "Android phone"],
    ["okhttp/4.12.0", "Wodana app", null],
  ])("reads %s", (agent, browser, device) => {
    expect(deviceDetails(agent)).toMatchObject({ browser, device });
  });

  it("says nothing rather than 'Unknown' when the agent doesn't tell", () => {
    expect(deviceDetails("node")).toMatchObject({ browser: null, device: null });
    expect(deviceDetails(null)).toMatchObject({ browser: null, device: null, mobile: false });
  });
});
