import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Each test starts on a clean device: forms keep drafts and remembered choices in local storage.
afterEach(() => {
  cleanup();
  try { globalThis.localStorage?.clear(); } catch { /* no storage in this environment */ }
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverMock, writable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), writable: true });
