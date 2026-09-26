import { describe, expect, it } from "vitest";
import { sendMedia } from "./gallery.controller";

const response = () => { const headers: Record<string, string> = {}; let code = 200; return { headers, get code() { return code; }, setHeader: (key: string, value: string) => { headers[key] = value; }, status: (value: number) => { code = value; } }; };

describe("gallery media", () => {
  it("answers byte ranges for videos", async () => {
    const res = response();
    const file = sendMedia({ body: Buffer.from("0123456789"), contentType: "video/mp4" }, { headers: { range: "bytes=2-5" } } as never, res as never);
    expect(res.code).toBe(206);
    expect(res.headers["Content-Range"]).toBe("bytes 2-5/10");
    const chunks: Buffer[] = []; for await (const chunk of file.getStream()) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("2345");
  });
  it("sends the whole file without a range, and refuses a range past the end", () => {
    const whole = response();
    sendMedia({ body: Buffer.from("abc"), contentType: "image/png" }, { headers: {} } as never, whole as never);
    expect(whole.code).toBe(200);
    const past = response();
    sendMedia({ body: Buffer.from("abc"), contentType: "video/mp4" }, { headers: { range: "bytes=9-" } } as never, past as never);
    expect(past.code).toBe(416);
  });
});
