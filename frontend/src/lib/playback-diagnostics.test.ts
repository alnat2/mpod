import { beforeEach, describe, expect, it, vi } from "vitest";

describe("temporary playback diagnostics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("keeps a failed event on the phone and sends it after connectivity returns", async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    const diagnostics = await import("./playback-diagnostics");
    diagnostics.recordPlaybackDiagnostic("trace-123", "completion_error", {
      audiobookId: 10, trackId: 19, code: "NETWORK_OR_CLIENT_ERROR",
    });

    await diagnostics.flushPlaybackDiagnostics();
    expect(JSON.parse(localStorage.getItem("mpod:temporary-playback-diagnostics") ?? "[]"))
      .toEqual([expect.objectContaining({ traceId: "trace-123", event: "completion_error", trackId: 19 })]);
    await diagnostics.flushPlaybackDiagnostics();
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem("mpod:temporary-playback-diagnostics") ?? "[]"))
      .toEqual([]);
  });

  it("flushes a stored event when the application starts again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));
    const first = await import("./playback-diagnostics");
    first.recordPlaybackDiagnostic("trace-456", "ended", { audiobookId: 10, trackId: 20 });
    await first.flushPlaybackDiagnostics();

    vi.resetModules();
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    const restarted = await import("./playback-diagnostics");
    restarted.initializePlaybackDiagnostics();
    await restarted.flushPlaybackDiagnostics();

    expect(send).toHaveBeenCalledWith("/api/playback/diagnostics", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      body: expect.stringContaining('"traceId":"trace-456"'),
    }));
    expect(JSON.parse(localStorage.getItem("mpod:temporary-playback-diagnostics") ?? "[]"))
      .toEqual([]);
  });

  it("puts the same trace ID on the completion request", async () => {
    const send = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      playback: { audiobookId: 10, trackId: 20, positionSeconds: 100, lastUpdated: "2026-09-28T09:32:04Z" },
      nextEpisodeId: null,
      nextTrackId: 21,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", send);
    const { api } = await import("./api");
    await api.playback.update({ audiobookId: 10, trackId: 20, positionSeconds: 100, completed: true }, "trace-789");
    const options = send.mock.calls[0]![1] as RequestInit;
    expect(new Headers(options.headers).get("X-Playback-Trace-ID")).toBe("trace-789");
  });

  it("records actual visibility for events without audio details and identifies the client bundle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Offline")));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      const diagnostics = await import("./playback-diagnostics");
      const code = diagnostics.playbackClientCode();
      expect(code).toMatch(/^CLIENT_[A-F0-9]{12}_[A-Z_]+$/);
      diagnostics.recordPlaybackDiagnostic("trace-123", "ended", { code });
      expect(JSON.parse(localStorage.getItem("mpod:temporary-playback-diagnostics") ?? "[]"))
        .toEqual([expect.objectContaining({ code, documentHidden: true })]);
    } finally {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    }
  });
});
