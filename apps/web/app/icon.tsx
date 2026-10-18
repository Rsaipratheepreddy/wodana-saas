import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

// Next renders and caches a small PNG of the house mark for the browser tab. The root icon also applies before sign-in.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
  const mark = await readFile(join(process.cwd(), "public/brand/logo/wodana-mark.svg"));
  const png = await sharp(mark, { density: 300 })
    .resize(size.width, size.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return new ImageResponse(
    // ImageResponse requires an embedded image, not the next/image component.
    <img alt="" src={`data:image/png;base64,${png.toString("base64")}`} width={64} height={64} />,
    size,
  );
}
