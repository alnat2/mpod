import { vi } from "vitest";

// Media events are emitted only by the test. Registration, load and play never
// synthesize readiness or playing events; playImpl can return a deferred Promise.
type FakeMediaError = {
  code: number;
  message?: string;
};

export class FakeAudio {
  static instances: FakeAudio[] = [];

  static get first() {
    const audio = FakeAudio.instances[0];
    if (!audio) {
      throw new Error("Expected an audio instance");
    }
    return audio;
  }

  private srcValue = "";
  private currentSrcValue = "";

  get src() {
    return this.srcValue;
  }

  set src(value: string) {
    this.srcValue = value;
    this.currentSrcValue = value;
    this.duration = 0;
    this.readyState = 0;
  }

  get currentSrc() {
    return this.currentSrcValue || this.srcValue;
  }

  set currentSrc(value: string) {
    this.currentSrcValue = value;
  }

  private currentTimeValue = 0;
  onCurrentTimeSet: ((value: number) => void) | null = null;
  throwOnCurrentTimeSet = false;
  duration = 0;
  readyState = 0;
  seeking = false;
  preload = "";
  buffered: TimeRanges = { length: 0, start: () => 0, end: () => 0 };
  playbackRate = 1;
  defaultPlaybackRate = 1;
  paused = true;
  ended = false;
  error: FakeMediaError | null = null;
  private listeners = new Map<string, Set<() => void>>();
  throwOnPlay = false;
  playImpl = vi.fn(async () => {
    if (this.throwOnPlay) {
      throw new DOMException("The element has no supported sources.", "NotSupportedError");
    }
    this.paused = false;
  });
  pauseImpl = vi.fn(() => {
    this.paused = true;
  });
  loadImpl = vi.fn(() => {
    this.currentTimeValue = 0;
    this.paused = true;
  });

  constructor() {
    FakeAudio.instances.push(this);
  }

  get currentTime() {
    return this.currentTimeValue;
  }

  set currentTime(value: number) {
    if (this.throwOnCurrentTimeSet) {
      throw new DOMException("Seek is not ready", "NotSupportedError");
    }
    this.currentTimeValue = value;
    this.onCurrentTimeSet?.(value);
  }

  addEventListener(type: string, listener: () => void) {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }

  async play() {
    this.ended = false;
    return this.playImpl();
  }

  pause() {
    this.pauseImpl();
  }

  load() {
    this.loadImpl();
    this.readyState = 0;
  }

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }

  // Freeze handlers to simulate an already queued callback from an older source.
  captureEvent(type: string) {
    const listeners = [...(this.listeners.get(type) ?? [])];
    return () => listeners.forEach((listener) => listener());
  }

  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener());
  }
}
