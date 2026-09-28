import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Episode } from "@/lib/api";

import {
  resetAudioMetadataQueueForTesting,
  useAudioMetadataDurations,
} from "./use-audio-metadata-durations";

type FakeAudioListener = () => void;

class FakeAudio {
  static instances: FakeAudio[] = [];

  static get first() {
    return FakeAudio.at(0);
  }

  static at(index: number): FakeAudio {
    const audio = FakeAudio.instances[index];
    if (!audio) {
      throw new Error(`Expected audio instance at index ${index}`);
    }
    return audio;
  }

  duration = 0;
  preload = "";
  src = "";
  private listeners = new Map<string, Set<FakeAudioListener>>();

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, listener: FakeAudioListener) {
    const listeners = this.listeners.get(type) ?? new Set<FakeAudioListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakeAudioListener) {
    this.listeners.get(type)?.delete(listener);
  }

  pause() {}

  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}

type HarnessItem = Pick<Episode, "id" | "duration"> & {
  type?: "episode" | "audiobook";
  audioUrl?: string;
};

function Harness({
  episodes,
  prefix = "",
}: {
  episodes: HarnessItem[];
  prefix?: string;
}) {
  const durationForEpisode = useAudioMetadataDurations(episodes);

  return (
    <div>
      {episodes.map((episode) => {
        const key = `${episode.type || "episode"}:${episode.id}`;
        const testId = prefix
          ? `${prefix}-duration-${episode.id}`
          : `duration-${episode.id}`;
        return (
          <span data-testid={testId} key={key}>
            {durationForEpisode(episode) ?? "missing"}
          </span>
        );
      })}
    </div>
  );
}

describe("useAudioMetadataDurations", () => {
  beforeEach(() => {
    resetAudioMetadataQueueForTesting();
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
  });

  it("loads audio metadata for episodes without stored duration", async () => {
    render(<Harness episodes={[{ id: 42, duration: null }]} />);

    expect(screen.getByTestId("duration-42")).toHaveTextContent("missing");
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.first.src).toBe("/api/episodes/42/audio");

    FakeAudio.first.duration = 3390;
    FakeAudio.first.emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("duration-42")).toHaveTextContent("3390");
    });
  });

  it("keeps existing episode duration without loading audio metadata", () => {
    render(<Harness episodes={[{ id: 42, duration: 1800 }]} />);

    expect(screen.getByTestId("duration-42")).toHaveTextContent("1800");
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("silently ignores metadata probe errors", () => {
    render(<Harness episodes={[{ id: 42, duration: null }]} />);

    expect(FakeAudio.instances).toHaveLength(1);
    FakeAudio.first.emit("error");

    expect(screen.getByTestId("duration-42")).toHaveTextContent("missing");
  });

  it("enforces shared limit of max two active probes across multiple hook instances", async () => {
    render(
      <>
        <Harness
          episodes={[
            { id: 101, duration: null },
            { id: 102, duration: null },
            { id: 103, duration: null },
          ]}
          prefix="a"
        />
        <Harness
          episodes={[
            { id: 201, duration: null },
            { id: 202, duration: null },
            { id: 203, duration: null },
          ]}
          prefix="b"
        />
      </>
    );

    // Initial render across BOTH instances must only launch 2 concurrent probes
    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.at(0).src).toBe("/api/episodes/101/audio");
    expect(FakeAudio.at(1).src).toBe("/api/episodes/102/audio");

    // Completing first probe frees a slot and starts the next queued item (103)
    FakeAudio.at(0).duration = 1010;
    FakeAudio.at(0).emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("a-duration-101")).toHaveTextContent("1010");
    });
    expect(FakeAudio.instances).toHaveLength(3);
    expect(FakeAudio.at(2).src).toBe("/api/episodes/103/audio");

    // Completing second probe frees another slot and starts 201
    FakeAudio.at(1).duration = 1020;
    FakeAudio.at(1).emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("a-duration-102")).toHaveTextContent("1020");
    });
    expect(FakeAudio.instances).toHaveLength(4);
    expect(FakeAudio.at(3).src).toBe("/api/episodes/201/audio");

    // Completing third probe starts 202
    FakeAudio.at(2).duration = 1030;
    FakeAudio.at(2).emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("a-duration-103")).toHaveTextContent("1030");
    });
    expect(FakeAudio.instances).toHaveLength(5);
    expect(FakeAudio.at(4).src).toBe("/api/episodes/202/audio");

    // Completing fourth probe starts 203
    FakeAudio.at(3).duration = 2010;
    FakeAudio.at(3).emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("b-duration-201")).toHaveTextContent("2010");
    });
    expect(FakeAudio.instances).toHaveLength(6);
    expect(FakeAudio.at(5).src).toBe("/api/episodes/203/audio");

    // Completing remaining probes
    FakeAudio.at(4).duration = 2020;
    FakeAudio.at(4).emit("loadedmetadata");
    FakeAudio.at(5).duration = 2030;
    FakeAudio.at(5).emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("b-duration-202")).toHaveTextContent("2020");
      expect(screen.getByTestId("b-duration-203")).toHaveTextContent("2030");
    });
  });

  it("deduplicates requests across multiple consumers and avoids redundant probes", async () => {
    const { rerender } = render(
      <>
        <Harness episodes={[{ id: 42, duration: null }]} prefix="a" />
        <Harness episodes={[{ id: 42, duration: null }]} prefix="b" />
      </>
    );

    // Only one probe created for episode 42 across both consumers
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.first.src).toBe("/api/episodes/42/audio");

    FakeAudio.first.duration = 4200;
    FakeAudio.first.emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("a-duration-42")).toHaveTextContent("4200");
      expect(screen.getByTestId("b-duration-42")).toHaveTextContent("4200");
    });

    // Mount another consumer asking for episode 42
    rerender(
      <>
        <Harness episodes={[{ id: 42, duration: null }]} prefix="a" />
        <Harness episodes={[{ id: 42, duration: null }]} prefix="b" />
        <Harness episodes={[{ id: 42, duration: null }]} prefix="c" />
      </>
    );

    // Should immediately get cached duration without creating new Audio
    expect(screen.getByTestId("c-duration-42")).toHaveTextContent("4200");
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it("continues queue after probe error and frees the slot", async () => {
    render(
      <Harness
        episodes={[
          { id: 1, duration: null },
          { id: 2, duration: null },
          { id: 3, duration: null },
        ]}
      />
    );

    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.at(0).src).toBe("/api/episodes/1/audio");
    expect(FakeAudio.at(1).src).toBe("/api/episodes/2/audio");

    // Probe 1 errors out
    FakeAudio.at(0).emit("error");

    // Slot freed -> probe 3 immediately started
    expect(FakeAudio.instances).toHaveLength(3);
    expect(FakeAudio.at(2).src).toBe("/api/episodes/3/audio");

    // Probes 2 and 3 resolve successfully
    FakeAudio.at(1).duration = 200;
    FakeAudio.at(1).emit("loadedmetadata");
    FakeAudio.at(2).duration = 300;
    FakeAudio.at(2).emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("duration-1")).toHaveTextContent("missing");
      expect(screen.getByTestId("duration-2")).toHaveTextContent("200");
      expect(screen.getByTestId("duration-3")).toHaveTextContent("300");
    });
  });

  it("frees slot and continues queue when an active consumer unmounts", async () => {
    const { rerender } = render(
      <div>
        <Harness key="a" episodes={[{ id: 1, duration: null }]} prefix="a" />
        <Harness
          key="b"
          episodes={[
            { id: 2, duration: null },
            { id: 3, duration: null },
          ]}
          prefix="b"
        />
      </div>
    );

    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.at(0).src).toBe("/api/episodes/1/audio");
    expect(FakeAudio.at(1).src).toBe("/api/episodes/2/audio");

    // Unmount Harness A (which owns active probe 1)
    rerender(
      <div>
        <Harness
          key="b"
          episodes={[
            { id: 2, duration: null },
            { id: 3, duration: null },
          ]}
          prefix="b"
        />
      </div>
    );

    // Slot 1 freed by unmount -> probe 3 immediately starts
    expect(FakeAudio.instances).toHaveLength(3);
    expect(FakeAudio.at(2).src).toBe("/api/episodes/3/audio");

    // Probes 2 and 3 resolve
    FakeAudio.at(1).duration = 222;
    FakeAudio.at(1).emit("loadedmetadata");
    FakeAudio.at(2).duration = 333;
    FakeAudio.at(2).emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("b-duration-2")).toHaveTextContent("222");
      expect(screen.getByTestId("b-duration-3")).toHaveTextContent("333");
    });
  });

  it("removes unmounted consumer from queue without launching probe when slot opens", async () => {
    const { rerender } = render(
      <div>
        <Harness episodes={[{ id: 1, duration: null }]} prefix="a" />
        <Harness episodes={[{ id: 2, duration: null }]} prefix="b" />
        <Harness episodes={[{ id: 3, duration: null }]} prefix="c" />
        <Harness episodes={[{ id: 4, duration: null }]} prefix="d" />
      </div>
    );

    // Active: 1, 2. Queued: 3, 4.
    expect(FakeAudio.instances).toHaveLength(2);

    // Unmount consumer C (episode 3 was queued, not active)
    rerender(
      <div>
        <Harness episodes={[{ id: 1, duration: null }]} prefix="a" />
        <Harness episodes={[{ id: 2, duration: null }]} prefix="b" />
        <Harness episodes={[{ id: 4, duration: null }]} prefix="d" />
      </div>
    );

    // Finish probe 1 -> slot opens -> episode 3 was removed from queue, so episode 4 starts!
    FakeAudio.at(0).duration = 100;
    FakeAudio.at(0).emit("loadedmetadata");

    expect(FakeAudio.instances).toHaveLength(3);
    expect(FakeAudio.at(2).src).toBe("/api/episodes/4/audio");

    FakeAudio.at(2).duration = 400;
    FakeAudio.at(2).emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("d-duration-4")).toHaveTextContent("400");
    });
  });

  it("preserves support for audiobooks with audioUrl as well as podcast episodes", async () => {
    render(
      <Harness
        episodes={[
          {
            id: 10,
            type: "audiobook",
            audioUrl: "https://cdn.example.com/audiobook-part1.mp3",
            duration: null,
          },
          {
            id: 20,
            type: "episode",
            duration: null,
          },
        ]}
      />
    );

    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.at(0).src).toBe(
      "https://cdn.example.com/audiobook-part1.mp3"
    );
    expect(FakeAudio.at(1).src).toBe("/api/episodes/20/audio");

    FakeAudio.at(0).duration = 5400;
    FakeAudio.at(0).emit("loadedmetadata");
    FakeAudio.at(1).duration = 1800;
    FakeAudio.at(1).emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("duration-10")).toHaveTextContent("5400");
      expect(screen.getByTestId("duration-20")).toHaveTextContent("1800");
    });
  });

  it("does not probe audiobook without audioUrl", () => {
    render(
      <Harness
        episodes={[
          {
            id: 10,
            type: "audiobook",
            duration: null,
          },
        ]}
      />
    );

    expect(FakeAudio.instances).toHaveLength(0);
    expect(screen.getByTestId("duration-10")).toHaveTextContent("missing");
  });

  it("caches successful durations in tab memory across unmounts", async () => {
    const { unmount } = render(
      <Harness episodes={[{ id: 99, duration: null }]} prefix="first" />
    );

    expect(FakeAudio.instances).toHaveLength(1);
    FakeAudio.first.duration = 999;
    FakeAudio.first.emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("first-duration-99")).toHaveTextContent("999");
    });

    // Unmount first component
    unmount();

    // Mount completely new component with the same episode
    render(
      <Harness episodes={[{ id: 99, duration: null }]} prefix="second" />
    );

    // Immediately has the cached duration without new Audio instance
    expect(screen.getByTestId("second-duration-99")).toHaveTextContent("999");
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it("allows retry after all consumers unmount but prevents infinite retry loop while mounted", async () => {
    // 1. Initial mount of consumer
    const { rerender, unmount } = render(
      <Harness episodes={[{ id: 77, duration: null }]} prefix="attempt1" />
    );

    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.at(0).src).toBe("/api/episodes/77/audio");

    // Probe fails
    FakeAudio.at(0).emit("error");
    expect(screen.getByTestId("attempt1-duration-77")).toHaveTextContent("missing");

    // Re-rendering or re-evaluating the consumer while it stays mounted must NOT trigger another probe
    rerender(
      <Harness episodes={[{ id: 77, duration: null }]} prefix="attempt1" />
    );
    expect(FakeAudio.instances).toHaveLength(1);

    // 2. Unmount the last consumer
    unmount();

    // 3. New consumer mounts with the same episode
    render(
      <Harness episodes={[{ id: 77, duration: null }]} prefix="attempt2" />
    );

    // New probe must be launched for the newly mounted consumer
    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.at(1).src).toBe("/api/episodes/77/audio");

    // This new probe can now succeed
    FakeAudio.at(1).duration = 7700;
    FakeAudio.at(1).emit("loadedmetadata");

    await waitFor(() => {
      expect(screen.getByTestId("attempt2-duration-77")).toHaveTextContent("7700");
    });
  });

  it("keeps failed state while at least one consumer remains mounted and retries only after all unmount", () => {
    const { rerender } = render(
      <div>
        <Harness key="a" episodes={[{ id: 88, duration: null }]} prefix="a" />
        <Harness key="b" episodes={[{ id: 88, duration: null }]} prefix="b" />
      </div>
    );

    expect(FakeAudio.instances).toHaveLength(1);
    FakeAudio.at(0).emit("error");

    // Unmount only consumer A, consumer B remains mounted
    rerender(
      <div>
        <Harness key="b" episodes={[{ id: 88, duration: null }]} prefix="b" />
      </div>
    );
    // Should NOT launch new probe because consumer B is still mounted
    expect(FakeAudio.instances).toHaveLength(1);

    // Unmount consumer B as well
    rerender(<div />);

    // Now mount consumer C -> launches new probe
    render(
      <Harness episodes={[{ id: 88, duration: null }]} prefix="c" />
    );
    expect(FakeAudio.instances).toHaveLength(2);
  });
});
