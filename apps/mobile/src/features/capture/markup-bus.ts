import type { LocalPhoto } from '../../core/media';

/** Hands a drawn-on photo back to the screen that opened the editor (keyed by the photo it replaces). */
const listeners = new Map<string, (photo: LocalPhoto) => void>();
export const markupBus = {
  listen(key: string, receive: (photo: LocalPhoto) => void) {
    listeners.set(key, receive);
    return () => { if (listeners.get(key) === receive) listeners.delete(key); };
  },
  deliver(key: string, photo: LocalPhoto) {
    const receive = listeners.get(key);
    listeners.delete(key);
    receive?.(photo);
    return !!receive;
  },
};
