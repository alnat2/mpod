let updateWaiting = false;
let isPlaybackPlaying = false;
let isReloading = false;
let isInitialized = false;
let registeredUpdateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let visibilityListener: (() => void) | null = null;

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
        } else if ("serviceWorker" in navigator) {
          void navigator.serviceWorker.getRegistration().then((reg) => {
            void reg?.update().catch(() => {});
          });
        }
      }
    };

    document.addEventListener("visibilitychange", visibilityListener);
    isInitialized = true;
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
  updateWaiting = false;
  isPlaybackPlaying = false;
  isReloading = false;
  isInitialized = false;
  registeredUpdateSW = null;
}

export function _setUpdateWaitingForTesting(waiting: boolean) {
  updateWaiting = waiting;
}
