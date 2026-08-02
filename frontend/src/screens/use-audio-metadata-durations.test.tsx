import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Episode } from "@/lib/api";

import { useAudioMetadataDurations } from "./use-audio-metadata-durations";

type FakeAudioListener = () => void;

class FakeAudio {
  static instances: FakeAudio[] = [];

  static get first() {
    const audio = FakeAudio.instances[0];
    if (!audio) {
      throw new Error("Expected an audio instance");
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

function Harness({ episodes }: { episodes: Array<Pick<Episode, "id" | "duration">> }) {
  const durationForEpisode = useAudioMetadataDurations(episodes);

  return (
    <div>
      {episodes.map((episode) => (
        <span data-testid={`duration-${episode.id}`} key={episode.id}>
          {durationForEpisode(episode) ?? "missing"}
        </span>
      ))}
    </div>
  );
}

describe("useAudioMetadataDurations", () => {
  beforeEach(() => {
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

    FakeAudio.first.emit("error");

    expect(screen.getByTestId("duration-42")).toHaveTextContent("missing");
  });
});
