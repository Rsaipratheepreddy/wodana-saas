import type { LocalPhoto } from '../../core/media';

/** Photos taken in the capture flow, handed to the form that files them (a snag, a report). Read once. */
let waiting: LocalPhoto[] = [];
export const photoHandoff = {
  give(photos: LocalPhoto[]) { waiting = photos; },
  take() { const photos = waiting; waiting = []; return photos; },
};
