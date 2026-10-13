import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrefetchController } from "./audio-prefetch";
import type { QueueEpisode } from "./playback-context-types";

const episode = (id: number) => ({
  type: "episode", id, audioUrl: `/api/episodes/${id}/audio`, downloaded: false,
} as unknown as QueueEpisode);

const response = (status: number) => ({
  status, arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createPrefetchController", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => response(206));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requests only the first bytes with credentials and reads the body", async () => {
    const result = response(206);
    fetchMock.mockResolvedValue(result);
    createPrefetchController().prefetch(episode(2));
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/episodes/2/audio"), expect.objectContaining({
      credentials: "include", headers: { Range: "bytes=0-131071" },
    }));
    expect(result.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("does not repeat a finished or pending prefetch of the same source", async () => {
    const controller = createPrefetchController();
    controller.prefetch(episode(2));
    controller.prefetch(episode(2));
    await flush();
    controller.prefetch(episode(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts the previous source when the target changes and on cancel", () => {
    const controller = createPrefetchController();
    controller.prefetch(episode(2));
    const first = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
    controller.prefetch(episode(3));
    expect(first.aborted).toBe(true);
    const second = (fetchMock.mock.calls[1]![1] as RequestInit).signal!;
    controller.cancel();
    expect(second.aborted).toBe(true);
  });

  it.each([
    ["a network error", () => fetchMock.mockRejectedValueOnce(new TypeError("network"))],
    ["a server error", () => fetchMock.mockResolvedValueOnce(response(500))],
  ])("retries the same source after %s", async (_name, arrange) => {
    arrange();
    const controller = createPrefetchController();
    controller.prefetch(episode(2));
    await flush();
    controller.prefetch(episode(2));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops a full-file response without reading it", async () => {
    const full = response(200);
    fetchMock.mockResolvedValueOnce(full);
    const controller = createPrefetchController();
    controller.prefetch(episode(2));
    const signal = (fetchMock.mock.calls[0]![1] as RequestInit).signal!;
    await flush();
    expect(full.arrayBuffer).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(true);
  });
});
