// Module-level singleton state coordinates SW updates across App, PlaybackProvider, and screens.
let updateWaiting = false;
let isPlaybackPlaying = false;
let isReloading = false;
let isInitialized = false;
let observedAppBuild: string | null = null;
let registeredUpdateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let visibilityListener: (() => void) | null = null;
let onlineListener: (() => void) | null = null;

export const LEGACY_API_CACHE_NAMES = [
  "api-session-cache",
  "api-playback-cache",
  "api-data-cache",
];

export async function cleanupLegacyCaches(
  cacheStorage?: CacheStorage
): Promise<string[]> {
  const storage =
    cacheStorage ??
    (typeof window !== "undefined" && "caches" in window
      ? window.caches
      : undefined);

  if (!storage) {
    return [];
  }

  try {
    const keys = await storage.keys();
    const deleted: string[] = [];
    await Promise.all(
      keys.map(async (key) => {
        if (LEGACY_API_CACHE_NAMES.includes(key)) {
          const success = await storage.delete(key);
          if (success) {
            deleted.push(key);
          }
        }
      })
    );
    return deleted;
  } catch (error) {
    console.warn("Failed to cleanup legacy caches", error);
    return [];
  }
}

export async function checkForAppUpdate(): Promise<boolean> {
  if (updateWaiting) {
    if (!isPlaybackPlaying) {
      applyAppUpdate();
      return true;
    }
    return true;
  }

  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      return false;
    }
    await reg.update().catch(() => {});
    if (reg.waiting) {
      handleNeedRefresh();
      return true;
    }
  } catch {
    // Ignore SW registration lookup failures (e.g. dev mode or restricted contexts)
  }

  return updateWaiting;
}

export function observeServerAppBuild(serverBuild: string | null | undefined) {
  const normalized = serverBuild?.trim();
  if (!normalized) {
    return;
  }
  if (observedAppBuild === null) {
    observedAppBuild = normalized;
    return;
  }
  if (observedAppBuild !== normalized) {
    observedAppBuild = normalized;
    void checkForAppUpdate();
  }
}

export function initPwaUpdate(updateFn?: (reloadPage?: boolean) => Promise<void>) {
  if (updateFn) {
    registeredUpdateSW = updateFn;
  }

  if (isInitialized) {
    return;
  }

  if (typeof document !== "undefined") {
    visibilityListener = () => {
      if (document.visibilityState === "visible") {
        if (updateWaiting && !isPlaybackPlaying) {
          applyAppUpdate();
        } else {
          void checkForAppUpdate();
        }
      }
    };

    document.addEventListener("visibilitychange", visibilityListener);
    isInitialized = true;
  }

  if (typeof window !== "undefined") {
    onlineListener = () => {
      if (updateWaiting && !isPlaybackPlaying) {
        applyAppUpdate();
      } else {
        void checkForAppUpdate();
      }
    };

    window.addEventListener("online", onlineListener);
  }
}

export function handleNeedRefresh(updateFn?: (reloadPage?: boolean) => Promise<void>) {
  if (isReloading) {
    return;
  }
  if (updateFn) {
    registeredUpdateSW = updateFn;
  }
  updateWaiting = true;
  if (!isPlaybackPlaying) {
    applyAppUpdate();
  }
}

export function setAudioPlaybackActive(playing: boolean) {
  if (isReloading) {
    return;
  }
  isPlaybackPlaying = playing;
  if (!playing && updateWaiting) {
    applyAppUpdate();
  }
}

export function isAudioPlaybackActive(): boolean {
  return isPlaybackPlaying;
}

export function isUpdateWaiting(): boolean {
  return updateWaiting;
}

export function applyAppUpdate() {
  if (isReloading) {
    return;
  }
  isReloading = true;
  updateWaiting = false;
  if (registeredUpdateSW) {
    void registeredUpdateSW(true);
    if (typeof window !== "undefined") {
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  } else if (typeof window !== "undefined") {
    window.location.reload();
  }
}

export function handleManualReload() {
  if (
    isPlaybackPlaying &&
    typeof window !== "undefined" &&
    !window.confirm("Audio is currently playing. Reload anyway?")
  ) {
    return;
  }
  applyAppUpdate();
}

export function _resetPwaUpdateStateForTesting() {
  if (visibilityListener && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityListener);
    visibilityListener = null;
  }
  if (onlineListener && typeof window !== "undefined") {
    window.removeEventListener("online", onlineListener);
    onlineListener = null;
  }
  updateWaiting = false;
  isPlaybackPlaying = false;
  isReloading = false;
  isInitialized = false;
  observedAppBuild = null;
  registeredUpdateSW = null;
}

export function _setUpdateWaitingForTesting(waiting: boolean) {
  updateWaiting = waiting;
}
