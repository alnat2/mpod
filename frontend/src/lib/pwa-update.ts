let updateWaiting = false;
let isPlaybackPlaying = false;
let registeredUpdateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

export function initPwaUpdate(updateFn?: (reloadPage?: boolean) => Promise<void>) {
  if (updateFn) {
    registeredUpdateSW = updateFn;
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (updateWaiting && !isPlaybackPlaying) {
          applyAppUpdate();
        } else if ("serviceWorker" in navigator) {
          void navigator.serviceWorker.getRegistration().then((reg) => {
            void reg?.update().catch(() => {});
          });
        }
      }
    });
  }
}

export function handleNeedRefresh(updateFn?: (reloadPage?: boolean) => Promise<void>) {
  if (updateFn) {
    registeredUpdateSW = updateFn;
  }
  updateWaiting = true;
  if (!isPlaybackPlaying) {
    applyAppUpdate();
  }
}

export function setAudioPlaybackActive(playing: boolean) {
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
  updateWaiting = false;
  if (registeredUpdateSW) {
    void registeredUpdateSW(true);
  } else if (typeof window !== "undefined") {
    window.location.reload();
  }
}

export function _resetPwaUpdateStateForTesting() {
  updateWaiting = false;
  isPlaybackPlaying = false;
  registeredUpdateSW = null;
}
