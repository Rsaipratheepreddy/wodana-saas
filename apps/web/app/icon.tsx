import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp from "sharp";

// Next renders and caches a small PNG instead of sending the full brand master
// for every browser-tab icon. The root icon also applies before sign-in.
export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default async function Icon() {
  const mark = await readFile(join(process.cwd(), "public/brand/wodana/wodana-mark-v5.png"));
  const { data, info } = await sharp(mark).resize(size.width, size.height).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += info.channels) {
    if (data[index + 3] === 0) continue;
    const [red, green, blue] = [data[index], data[index + 1], data[index + 2]];
    const lightness = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
    const step = Math.max(0, Math.min(1, (lightness - 0.25) / 0.5));
    data[index] = Math.round(45 + 45 * step);
    data[index + 1] = Math.round(38 + 42 * step);
    data[index + 2] = Math.round(125 + 118 * step);
  }
  const recolored = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
  return new ImageResponse(
    // ImageResponse requires an embedded image, not the next/image component.
    <img alt="" src={`data:image/png;base64,${recolored.toString("base64")}`} width={64} height={64} />,
    size,
  );
}
