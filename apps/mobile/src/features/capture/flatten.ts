import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import type { Mark } from './markup-model';

/** The photo with its marks drawn in, as a JPEG at the photo's own size (capped at 2048px). */
export async function flattenMarkup(input: { ref: RefObject<View | null>; uri: string; width: number; height: number; marks: Mark[] }) {
  const scale = Math.min(1, 2048 / Math.max(input.width, input.height));
  const width = Math.round(input.width * scale);
  const height = Math.round(input.height * scale);
  const uri = await captureRef(input.ref, { format: 'jpg', quality: 0.9, result: 'tmpfile', width, height });
  return { uri, width, height };
}
