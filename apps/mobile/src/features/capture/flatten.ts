import type { RefObject } from 'react';
import { PixelRatio, Platform, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { captureSize, type Mark } from './markup-model';

/** The photo with its marks drawn in, as a JPEG at the photo's own size (capped at 2048px on its long edge). */
export async function flattenMarkup(input: { ref: RefObject<View | null>; uri: string; width: number; height: number; marks: Mark[] }) {
  const { request, output } = captureSize(input.width, input.height, PixelRatio.get(), Platform.OS);
  const uri = await captureRef(input.ref, { format: 'jpg', quality: 0.9, result: 'tmpfile', width: request.width, height: request.height });
  return { uri, width: output.width, height: output.height };
}
