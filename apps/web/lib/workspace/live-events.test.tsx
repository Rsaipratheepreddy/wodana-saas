import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { RELEASE_GRACE_MS, pollEvery, useLiveInvalidate } from "./live-events";

const workspaceId = "e56299c6-3da3-402a-a9ac-3995bb37b9d4";

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 1;
  closed = false;
  listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  constructor(readonly url: string) { FakeEventSource.instances.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  emit(type: string, data = "") { for (const listener of this.listeners.get(type) ?? []) listener({ data } as MessageEvent<string>); }
  close() { this.closed = true; }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeEventSource.instances = []; });

describe("live events (FD-4)", () => {
  it("shares one stream per workspace and re-reads a screen only for its scopes, debounced", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    const bell = vi.fn(), site = vi.fn();
    const first = renderHook(() => useLiveInvalidate(workspaceId, ["notifications", "workspace"], bell));
    const second = renderHook(() => useLiveInvalidate(workspaceId, ["project:p1"], site));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe(`/api/workspace/events?workspaceId=${workspaceId}`);
    const source = FakeEventSource.instances[0];
    await act(async () => { source.emit("open"); });
    expect(first.result.current).toBe(true);
    act(() => { source.emit("change", JSON.stringify({ scopes: ["workspace", "sales"] })); source.emit("change", JSON.stringify({ scopes: ["workspace"] })); });
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(bell).toHaveBeenCalledTimes(1);
    expect(site).not.toHaveBeenCalled();
    act(() => { source.emit("change", JSON.stringify({ scopes: ["workspace", "project:p1"] })); vi.advanceTimersByTime(1_000); });
    expect(site).toHaveBeenCalledTimes(1);
    first.unmount();
    expect(source.closed).toBe(false);
    second.unmount();
    expect(source.closed).toBe(false);
    act(() => { vi.advanceTimersByTime(RELEASE_GRACE_MS); });
    expect(source.closed).toBe(true);
  });

  it("keeps one connection through React's double effects and a page handing over to the next", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    const page = renderHook(() => useLiveInvalidate(workspaceId, ["sales"], vi.fn()), { wrapper: StrictMode });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].closed).toBe(false);
    page.unmount();
    const next = renderHook(() => useLiveInvalidate(workspaceId, ["projects"], vi.fn()), { wrapper: StrictMode });
    act(() => { vi.advanceTimersByTime(RELEASE_GRACE_MS * 2); });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].closed).toBe(false);
    next.unmount();
    act(() => { vi.advanceTimersByTime(RELEASE_GRACE_MS); });
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("does not ask again for a refused stream for 30 seconds, whoever mounts", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    const refusedWorkspace = "11111111-2222-4333-8444-555555555555";
    const first = renderHook(() => useLiveInvalidate(refusedWorkspace, ["workspace"], vi.fn()));
    const source = FakeEventSource.instances[0];
    source.readyState = FakeEventSource.CLOSED;
    act(() => { source.emit("error"); });
    first.unmount();
    renderHook(() => useLiveInvalidate(refusedWorkspace, ["notifications"], vi.fn()));
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("does nothing without the stream, and polling slows to a minute only while it is live", () => {
    const { result } = renderHook(() => useLiveInvalidate(workspaceId, ["workspace"], vi.fn()));
    expect(result.current).toBe(false);
    expect(pollEvery(false, 8_000)).toBe(8_000);
    expect(pollEvery(true, 8_000)).toBe(60_000);
  });
});
