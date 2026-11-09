import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetPwaUpdateStateForTesting,
  _setUpdateWaitingForTesting,
  applyAppUpdate,
  handleManualReload,
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
    _resetPwaUpdateStateForTesting();
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

  it("guards against double execution when reload is already in flight", () => {
    const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
    initPwaUpdate(mockUpdateSW);

    applyAppUpdate();
    expect(mockUpdateSW).toHaveBeenCalledTimes(1);

    // Second call while reloading is ignored
    applyAppUpdate();
    expect(mockUpdateSW).toHaveBeenCalledTimes(1);

    handleNeedRefresh();
    expect(mockUpdateSW).toHaveBeenCalledTimes(1);
  });

  it("applies update manually via applyAppUpdate", () => {
    const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
    initPwaUpdate(mockUpdateSW);

    applyAppUpdate();

    expect(mockUpdateSW).toHaveBeenCalledWith(true);
  });

  it("falls back to window.location.reload when registeredUpdateSW is null", () => {
    const originalLocation = window.location;
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    });

    try {
      applyAppUpdate();
      expect(reloadMock).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("applies waiting update on visibility change to visible", () => {
    const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
    initPwaUpdate(mockUpdateSW);

    // Directly set updateWaiting to true while playback is NOT active
    _setUpdateWaitingForTesting(true);

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(mockUpdateSW).toHaveBeenCalledWith(true);
  });

  it("checks for service worker updates on visibility change when no update is waiting", async () => {
    const updateMock = vi.fn().mockResolvedValue(undefined);
    const originalNavigator = navigator.serviceWorker;

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue({ update: updateMock }),
      },
    });

    try {
      initPwaUpdate();

      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));

      // Wait a tick for promise chain
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(updateMock).toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: originalNavigator,
      });
    }
  });

  it("is idempotent and removes visibility listener on reset", () => {
    const addEventSpy = vi.spyOn(document, "addEventListener");
    const removeEventSpy = vi.spyOn(document, "removeEventListener");

    initPwaUpdate();
    initPwaUpdate(); // Second call should not add another listener
    expect(addEventSpy).toHaveBeenCalledTimes(1);

    _resetPwaUpdateStateForTesting();
    expect(removeEventSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  describe("handleManualReload", () => {
    it("reloads immediately without confirmation when audio is paused", () => {
      const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
      initPwaUpdate(mockUpdateSW);
      setAudioPlaybackActive(false);

      const confirmSpy = vi.spyOn(window, "confirm");

      handleManualReload();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(mockUpdateSW).toHaveBeenCalledWith(true);
    });

    it("prompts confirmation when audio is playing and reloads if confirmed", () => {
      const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
      initPwaUpdate(mockUpdateSW);
      setAudioPlaybackActive(true);

      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

      handleManualReload();

      expect(confirmSpy).toHaveBeenCalledWith("Audio is currently playing. Reload anyway?");
      expect(mockUpdateSW).toHaveBeenCalledWith(true);
    });

    it("prompts confirmation when audio is playing and does not reload if cancelled", () => {
      const mockUpdateSW = vi.fn().mockResolvedValue(undefined);
      initPwaUpdate(mockUpdateSW);
      setAudioPlaybackActive(true);

      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

      handleManualReload();

      expect(confirmSpy).toHaveBeenCalledWith("Audio is currently playing. Reload anyway?");
      expect(mockUpdateSW).not.toHaveBeenCalled();
    });
  });
});
