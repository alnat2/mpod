import { describe, expect, it, vi } from "vitest";

import { FakeAudio } from "./fake-audio";

describe("controlled FakeAudio contract", () => {
  it("does not replay a readiness event when a listener is registered later", async () => {
    const audio = new FakeAudio();
    audio.readyState = 4;
    audio.emit("canplay");
    const ready = vi.fn();
    audio.addEventListener("loadedmetadata", ready);
    audio.addEventListener("canplay", ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    audio.emit("canplay");
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("load resets the source state without inventing media events", async () => {
    const audio = new FakeAudio();
    const event = vi.fn();
    audio.addEventListener("loadedmetadata", event);
    audio.addEventListener("canplay", event);
    audio.readyState = 4;
    audio.currentTime = 42;
    audio.load();
    await Promise.resolve();
    expect(audio.readyState).toBe(0);
    expect(audio.currentTime).toBe(0);
    expect(event).not.toHaveBeenCalled();
  });

  it("allows play to reject after metadata and canplay have already arrived", async () => {
    const audio = new FakeAudio();
    let rejectPlay!: (reason: Error) => void;
    const pending = new Promise<void>((_, reject) => { rejectPlay = reject; });
    audio.playImpl.mockReturnValueOnce(pending);
    const playing = vi.fn();
    audio.addEventListener("playing", playing);
    const result = audio.play();
    const error = new DOMException("Unsupported source", "NotSupportedError");
    const rejected = expect(result).rejects.toBe(error);
    audio.readyState = 1;
    audio.emit("loadedmetadata");
    audio.readyState = 4;
    audio.emit("canplay");
    expect(audio.paused).toBe(true);
    expect(playing).not.toHaveBeenCalled();
    rejectPlay(error);
    await rejected;
  });

  it("can remain failed without any later readiness event", async () => {
    const audio = new FakeAudio();
    const ready = vi.fn();
    const error = vi.fn();
    audio.addEventListener("canplay", ready);
    audio.addEventListener("error", error);
    audio.error = { code: 4 };
    audio.emit("error");
    await Promise.resolve();
    expect(error).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
    expect(audio.readyState).toBe(0);
  });

  it("separates a resolved play Promise from an explicitly emitted playing event", async () => {
    const audio = new FakeAudio();
    const playing = vi.fn();
    audio.addEventListener("playing", playing);
    await audio.play();
    expect(audio.paused).toBe(false);
    expect(playing).not.toHaveBeenCalled();
    audio.emit("playing");
    expect(playing).toHaveBeenCalledTimes(1);
  });
  it("can deliver a captured old callback without invoking new source listeners", () => {
    const audio = new FakeAudio();
    const oldReady = vi.fn();
    const newReady = vi.fn();
    audio.addEventListener("canplay", oldReady);
    const delayed = audio.captureEvent("canplay");
    audio.removeEventListener("canplay", oldReady);
    audio.addEventListener("canplay", newReady);
    delayed();
    expect(oldReady).toHaveBeenCalledTimes(1);
    expect(newReady).not.toHaveBeenCalled();
  });

});
