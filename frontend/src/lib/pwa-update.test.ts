import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetPwaUpdateStateForTesting,
  applyAppUpdate,
  handleNeedRefresh,
  initPwaUpdate,
  isAudioPlaybackActive,
  isUpdateWaiting,
  setAudioPlaybackActive,
} from "./pwa-update";

describe("pwa-update", () => {
  beforeEach(() => {
    _resetPwaUpdateStateForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies update immediately when audio is not playing", () => {
    const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
    setAudioPlaybackActive(false);

    handleNeedRefresh(mockUpdateSW);

    expect(mockUpdateSW).toHaveBeenCalledWith(true);
    expect(isUpdateWaiting()).toBe(false);
  });

  it("defers update when audio is playing", () => {
    const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
    setAudioPlaybackActive(true);

    handleNeedRefresh(mockUpdateSW);

    expect(mockUpdateSW).not.toHaveBeenCalled();
    expect(isUpdateWaiting()).toBe(true);
    expect(isAudioPlaybackActive()).toBe(true);
  });

  it("applies waiting update as soon as audio pauses", () => {
    const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
    setAudioPlaybackActive(true);

    handleNeedRefresh(mockUpdateSW);
    expect(mockUpdateSW).not.toHaveBeenCalled();

    setAudioPlaybackActive(false);
    expect(mockUpdateSW).toHaveBeenCalledWith(true);
    expect(isUpdateWaiting()).toBe(false);
  });

  it("applies update manually via applyAppUpdate", () => {
    const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
    initPwaUpdate(mockUpdateSW);

    applyAppUpdate();

    expect(mockUpdateSW).toHaveBeenCalledWith(true);
  });

  it("checks for updates on visibility change to visible", () => {
    const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
    initPwaUpdate(mockUpdateSW);
    setAudioPlaybackActive(true);
    handleNeedRefresh();

    expect(mockUpdateSW).not.toHaveBeenCalled();
    expect(isUpdateWaiting()).toBe(true);

    setAudioPlaybackActive(false);
    // Visibility change when update is waiting and audio is paused
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(mockUpdateSW).toHaveBeenCalledWith(true);
  });
});
