import type { RefObject } from 'react';
import type { View } from 'react-native';
import { arrowHead, type Mark } from './markup-model';

/** In the browser: draw the photo and its marks on a canvas and keep the JPEG. */
export async function flattenMarkup(input: { ref: RefObject<View | null>; uri: string; width: number; height: number; marks: Mark[] }) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.crossOrigin = 'anonymous';
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = input.uri;
  });
  const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0, width, height);
  context.lineCap = 'round'; context.lineJoin = 'round';
  for (const mark of input.marks) {
    context.strokeStyle = mark.color; context.fillStyle = mark.color;
    if (mark.kind === 'pen') {
      context.lineWidth = mark.width * width;
      context.beginPath();
      mark.points.forEach((point, index) => (index ? context.lineTo(point.x * width, point.y * height) : context.moveTo(point.x * width, point.y * height)));
      context.stroke();
    } else if (mark.kind === 'arrow') {
      const [left, right] = arrowHead(mark.from, mark.to, width, height);
      context.lineWidth = mark.width * width;
      context.beginPath();
      context.moveTo(mark.from.x * width, mark.from.y * height); context.lineTo(mark.to.x * width, mark.to.y * height);
      context.moveTo(left.x * width, left.y * height); context.lineTo(mark.to.x * width, mark.to.y * height); context.lineTo(right.x * width, right.y * height);
      context.stroke();
    } else {
      const size = mark.size * width;
      context.font = `600 ${size}px sans-serif`;
      context.lineWidth = size / 6; context.strokeStyle = mark.color === '#111111' ? '#FFFFFF' : '#000000';
      context.strokeText(mark.text, mark.at.x * width, mark.at.y * height);
      context.fillText(mark.text, mark.at.x * width, mark.at.y * height);
    }
  }
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/jpeg', 0.9));
  return { uri: URL.createObjectURL(blob), width, height };
}
