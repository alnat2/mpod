import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudio } from "../test/fake-audio";
import { prepareNextAudio } from "./prepared-audio";
import type { QueueEpisode } from "./playback-context-types";

const episode = (position = 0): QueueEpisode => ({
  id: 2, title: "Next", podcastId: 1, podcastTitle: "Podcast", duration: 100,
  audioUrl: "/api/episodes/2/audio", downloaded: true, isListened: false, publishedAt: null,
  playback: { episodeId: 2, positionSeconds: position, lastUpdated: "2026-10-02T09:00:00Z" },
});

describe("prepared audio", () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
  });

  it.each([0, 1])("checks a zero-position reserve with actual currentTime %s without an extra seek", (actualPosition) => {
    const prepared = prepareNextAudio(episode(), "Speed 1x");
    const audio = FakeAudio.first;
    audio.currentTime = actualPosition;
    const seek = vi.fn();
    audio.onCurrentTimeSet = seek;
    audio.duration = 100;
    audio.readyState = 4;
    audio.buffered = { length: 1, start: () => 0, end: () => 5 };
    audio.emit("loadedmetadata");
    audio.emit("canplay");
    expect(seek).not.toHaveBeenCalled();
    expect(prepared.isReady()).toBe(actualPosition === 0);

    expect(prepared.take()).toBe(actualPosition === 0 ? prepared.audio : null);
    expect(audio.playImpl).not.toHaveBeenCalled();
    prepared.cancel();
  });

  it("waits for a seek to finish and for data at the saved position", () => {
    const prepared = prepareNextAudio(episode(23), "Speed 1x");
    const audio = FakeAudio.first;
    audio.duration = 100;
    audio.readyState = 1;
    audio.emit("loadedmetadata");
    expect(audio.currentTime).toBe(23);
    expect(prepared.isReady()).toBe(false);
    audio.readyState = 4;
    audio.buffered = { length: 1, start: () => 0, end: () => 10 };
    audio.emit("canplay");

    audio.buffered = { length: 1, start: () => 23, end: () => 28 };
    audio.seeking = true;
    audio.emit("progress");
    expect(prepared.isReady()).toBe(false);
    audio.seeking = false;
    audio.emit("seeked");

    expect(prepared.isReady()).toBe(true);
    expect(prepared.take()).toBe(prepared.audio);
    expect(prepared.take()).toBeNull();
    expect(audio.loadImpl).toHaveBeenCalledTimes(1);
    expect(audio.playImpl).not.toHaveBeenCalled();
    prepared.cancel();
    expect(audio.src).toContain("/episodes/2/audio");
  });

  it("does not treat a failed seek as a source ready at zero", () => {
    const prepared = prepareNextAudio(episode(23), "Speed 1x");
    const audio = FakeAudio.first;
    audio.throwOnCurrentTimeSet = true;
    audio.readyState = 4;
    audio.duration = 100;
    audio.buffered = { length: 1, start: () => 0, end: () => 100 };
    audio.emit("canplay");
    expect(prepared.isReady()).toBe(false);
    expect(prepared.take()).toBeNull();

  });

  it("aborts the reserve once and ignores already queued callbacks", () => {
    const prepared = prepareNextAudio(episode(), "Speed 1x");
    const audio = FakeAudio.first;
    const lateReady = audio.captureEvent("canplay");
    const lateError = audio.captureEvent("error");
    prepared.cancel(); prepared.cancel();
    audio.readyState = 4;
    lateReady(); lateError();
    expect(audio.src).toBe("");
    expect(audio.loadImpl).toHaveBeenCalledTimes(2);

    expect(prepared.take()).toBeNull();
  });
});
