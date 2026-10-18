import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import type { LocalPhoto } from '../../core/media';
import { markupBus } from './markup-bus';

/** Open the drawing editor on a local photo; `done` receives the drawn-on copy. */
export function useMarkup() {
  const router = useRouter();
  return useCallback((photo: Pick<LocalPhoto, 'id' | 'uri' | 'width' | 'height'>, done: (drawn: LocalPhoto) => void) => {
    markupBus.listen(photo.id, done);
    router.push({ pathname: '/capture/markup', params: { uri: photo.uri, key: photo.id, width: String(photo.width || ''), height: String(photo.height || '') } });
  }, [router]);
}
