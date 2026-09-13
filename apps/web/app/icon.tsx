import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Next renders and caches a small PNG instead of sending the full brand master
// for every browser-tab icon. The root icon also applies before sign-in.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
  const mark = await readFile(join(process.cwd(), "public/brand/wodana/woddy-mark-v4.png"));
  return new ImageResponse(
    // ImageResponse requires an embedded image, not the next/image component.
    <img alt="" src={`data:image/png;base64,${mark.toString("base64")}`} width={64} height={64} />,
    size,
  );
}
