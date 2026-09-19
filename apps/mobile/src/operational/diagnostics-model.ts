export type DeviceDiagnostic = {
  at: string;
  environment: string;
  version: string;
  code: 'render_crash' | 'startup_slow' | 'update_failed';
  durationMs?: number;
};

export function mergeDiagnostics(rows: DeviceDiagnostic[], next: DeviceDiagnostic) {
  return [...rows, next].slice(-20);
}
