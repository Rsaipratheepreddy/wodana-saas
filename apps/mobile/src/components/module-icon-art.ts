/** Shared vector geometry for native rendering and the exported SVG assets. */
export type ModuleIconShape = {
  tag: 'path' | 'rect' | 'circle';
  attributes: Record<string, string | number>;
  fill?: 'brand' | 'soft' | 'ink';
};
type ModuleIconDefinition = { label: string; group: 'module' | 'shortcut'; shapes: readonly ModuleIconShape[] };

export const moduleIconArt = {
  workspace: { label: 'Workspace', group: 'module', shapes: [
    { tag: 'rect', attributes: { x: 3, y: 3, width: 7, height: 7, rx: 1.8 }, fill: 'brand' },
    { tag: 'rect', attributes: { x: 14, y: 3, width: 7, height: 7, rx: 1.8 } },
    { tag: 'rect', attributes: { x: 3, y: 14, width: 7, height: 7, rx: 1.8 } },
    { tag: 'rect', attributes: { x: 14, y: 14, width: 7, height: 7, rx: 1.8 }, fill: 'soft' },
  ] },
  crm: { label: 'CRM', group: 'module', shapes: [
    { tag: 'rect', attributes: { x: 3, y: 7, width: 18, height: 14, rx: 2.5 }, fill: 'soft' },
    { tag: 'path', attributes: { d: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a21 21 0 0 0 7 2m4 0a21 21 0 0 0 7-2' } },
    { tag: 'rect', attributes: { x: 10, y: 12, width: 4, height: 4, rx: 1 }, fill: 'brand' },
  ] },
  'pre-project': { label: 'Pre-project', group: 'module', shapes: [
    { tag: 'rect', attributes: { x: 3, y: 3, width: 18, height: 18, rx: 2 }, fill: 'soft' },
    { tag: 'path', attributes: { d: 'M10 3v7h11M3 14h7v7M15 15h2v2' } },
  ] },
  projects: { label: 'Projects', group: 'module', shapes: [
    { tag: 'path', attributes: { d: 'M3 7V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z' }, fill: 'soft' },
    { tag: 'path', attributes: { d: 'M7 11v6M12 11v3M17 11v5' } },
  ] },
  hrms: { label: 'HRMS', group: 'module', shapes: [
    { tag: 'circle', attributes: { cx: 12, cy: 7, r: 3 }, fill: 'brand' },
    { tag: 'path', attributes: { d: 'M7 21v-3a5 5 0 0 1 10 0v3H7Z' }, fill: 'soft' },
    { tag: 'path', attributes: { d: 'M4 6a3 3 0 0 0 0 6m16-6a3 3 0 0 1 0 6M2 21v-3a4 4 0 0 1 2-3.46M22 21v-3a4 4 0 0 0-2-3.46' } },
  ] },
  'my-work': { label: 'My work', group: 'shortcut', shapes: [
    { tag: 'rect', attributes: { x: 4, y: 4, width: 16, height: 18, rx: 2.5 }, fill: 'soft' },
    { tag: 'rect', attributes: { x: 8, y: 2, width: 8, height: 4, rx: 1.5 }, fill: 'brand' },
    { tag: 'path', attributes: { d: 'm8 12 2 2 5-5M8 18h8' } },
  ] },
  calendar: { label: 'Calendar', group: 'shortcut', shapes: [
    { tag: 'rect', attributes: { x: 3, y: 5, width: 18, height: 16, rx: 2.5 }, fill: 'soft' },
    { tag: 'path', attributes: { d: 'M8 3v4M16 3v4M3 11h18' } },
    { tag: 'rect', attributes: { x: 7, y: 14, width: 3, height: 3, rx: 0.7 }, fill: 'brand' },
    { tag: 'path', attributes: { d: 'M14 15h2' } },
  ] },
  approvals: { label: 'Approvals', group: 'shortcut', shapes: [
    { tag: 'path', attributes: { d: 'm12 2 2.8 2.3 3.6.3.8 3.5L22 11l-1.8 3.1-.8 3.5-3.6.3L12 21l-3.8-3.1-3.6-.3-.8-3.5L2 11l2.8-2.9.8-3.5 3.6-.3L12 2Z' }, fill: 'soft' },
    { tag: 'path', attributes: { d: 'm8 11 3 3 5-5' } },
  ] },
  inbox: { label: 'Inbox', group: 'shortcut', shapes: [
    { tag: 'path', attributes: { d: 'M7 3h10a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4H9l-6 4V7a4 4 0 0 1 4-4Z' }, fill: 'soft' },
    { tag: 'circle', attributes: { cx: 8, cy: 10.5, r: 0.8 }, fill: 'ink' },
    { tag: 'circle', attributes: { cx: 12, cy: 10.5, r: 0.8 }, fill: 'ink' },
    { tag: 'circle', attributes: { cx: 16, cy: 10.5, r: 0.8 }, fill: 'ink' },
  ] },
  files: { label: 'Files', group: 'shortcut', shapes: [
    { tag: 'path', attributes: { d: 'M3 7v13a2 2 0 0 0 2 2h10' } },
    { tag: 'path', attributes: { d: 'M8 2h7l5 5v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z' }, fill: 'soft' },
    { tag: 'path', attributes: { d: 'M15 2v5h5M10 12h6M10 16h4' } },
  ] },
  'site-visits': { label: 'Site visits', group: 'shortcut', shapes: [
    { tag: 'path', attributes: { d: 'M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 0 1 16 0Z' }, fill: 'soft' },
    { tag: 'circle', attributes: { cx: 12, cy: 10, r: 3 }, fill: 'brand' },
  ] },
} as const satisfies Record<string, ModuleIconDefinition>;

export type ModuleIconName = keyof typeof moduleIconArt;
export const moduleIconNames = Object.keys(moduleIconArt) as ModuleIconName[];
