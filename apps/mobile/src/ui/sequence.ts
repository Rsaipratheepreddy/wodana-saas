/**
 * Why sheets, modals and the camera take turns: the camera, the photo library and a full-screen screen are
 * each presented on top of whatever is showing. iOS presents them on the top-most view controller, so while
 * a sheet (a Modal) is still being dismissed they land on the sheet, go down with it, and UIKit is left with an
 * orphaned presentation whose transition view swallows every tap: the camera "breaks" and the screens go dead.
 * So a sheet closes first, says it has gone (`onClosed`), and only then does the next thing open.
 */

/** One action kept until a sheet or modal has really gone, then run once. */
export function deferred() {
  let pending: (() => void) | null = null;
  return {
    set(run: () => void) { pending = run; },
    clear() { pending = null; },
    /** Runs what was set, once; says whether there was anything to run. */
    run() {
      const next = pending;
      pending = null;
      if (next) next();
      return next !== null;
    },
    get waiting() { return pending !== null; },
  };
}

/** How long a close animation gets before the sheet is taken off the screen regardless. */
export const closeFallbackMs = (animationMs: number) => animationMs + 120;

/**
 * How long after the modal view goes before it counts as dismissed when the phone never says so. iOS reports
 * the dismissal (`onDismiss`), so it gets a generous fallback; Android and the web dismiss at once.
 */
export const dismissFallbackMs = (os: string) => (os === 'ios' ? 450 : 0);

type TransitionEvent = { data?: { closing?: boolean } };
type TransitionNavigation = { addListener(event: never, listener: (event: TransitionEvent) => void): () => void };

/**
 * Runs `run` once the screen's push animation has finished (the stack's `transitionEnd`), or after
 * `fallbackMs` where no such event comes (the web, a screen that was already there). Returns a cleanup.
 */
export function afterTransition(navigation: TransitionNavigation, run: () => void, fallbackMs = 700) {
  let done = false;
  let unsubscribe = () => undefined as void;
  const once = () => {
    if (done) return;
    done = true;
    unsubscribe();
    clearTimeout(timer);
    run();
  };
  const timer = setTimeout(once, fallbackMs);
  unsubscribe = navigation.addListener('transitionEnd' as never, (event) => { if (!event?.data?.closing) once(); });
  return () => { done = true; unsubscribe(); clearTimeout(timer); };
}
