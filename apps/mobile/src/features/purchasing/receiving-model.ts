import type { T } from '../../core/i18n';
import type { Place } from './api';

/**
 * A place goods can be received at, as a choice in the "Delivered to" list, without native code (node tests
 * import it). The value is the place's key, the one the server resolves (a location id, or `site:<project>`,
 * `warehouse` or `factory` for one made on first use), so the choice is found again once made. A place made
 * on first use has no name yet: a site reads "Site · <project name>", a store reads its kind.
 */
export function placeOption(place: Place, t: T): { value: string; label: string; detail?: string } {
  const label = place.name
    ?? (place.kind === 'site' ? t('Site · {name}', { name: place.projectName ?? place.projectReference ?? '' })
      : place.kind === 'warehouse' ? t('Warehouse') : place.kind === 'factory' ? t('Factory') : t('Other'));
  // The project's reference under a site, unless the site's own name already carries it.
  const detail = place.kind === 'site' && place.projectReference && !label.includes(place.projectReference) ? place.projectReference : undefined;
  return detail ? { value: place.key, label, detail } : { value: place.key, label };
}
