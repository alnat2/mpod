import type { PlaybackSpeedLabel } from "@/components/mpod/playback";

type AudioSourceEpisode = {
  id: number;
};

export function playbackRateFromLabel(label: PlaybackSpeedLabel) {
  return Number(label.replace("Speed ", "").replace("x", "")) || 1;
}

export function applyPlaybackRate(
  audio: HTMLAudioElement,
  speedLabel: PlaybackSpeedLabel
) {
  const nextRate = playbackRateFromLabel(speedLabel);
  audio.defaultPlaybackRate = nextRate;
  audio.playbackRate = nextRate;
}

export function clampPosition(
  positionSeconds: number,
  durationSeconds?: number | null
) {
  const nonNegativePosition = Math.max(0, positionSeconds);
  if (!durationSeconds) {
    return nonNegativePosition;
  }
  return Math.min(durationSeconds, nonNegativePosition);
}

export function getPositiveDuration(...values: Array<number | null | undefined>) {
  return (
    values.find(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value > 0
    ) ?? 0
  );
}

export function readAudioDuration(audio: HTMLAudioElement) {
  return getPositiveDuration(audio.duration);
}

export async function attemptAudioPlay(
  audio: HTMLAudioElement,
  onFailure: (error: unknown) => void
) {
  try {
    await audio.play();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    onFailure(error);
  }
}

export function describeAudioError(error: unknown) {
  if (error instanceof DOMException) {
    return `${error.name}: ${error.message || "Playback was blocked."}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Playback failed.";
}

export function describeMediaError(error: MediaError | null) {
  if (!error) {
    return "Media failed to load.";
  }

  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "Media loading was aborted.";
    case MediaError.MEDIA_ERR_NETWORK:
      return "Network error while loading audio.";
    case MediaError.MEDIA_ERR_DECODE:
      return "Audio could not be decoded.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "Audio source is not supported.";
    default:
      return error.message || "Media failed to load.";
  }
}

export function setAudioPosition(
  audio: HTMLAudioElement,
  positionSeconds: number
) {
  try {
    audio.currentTime = positionSeconds;
    return true;
  } catch {
    return false;
  }
}

export function reloadAudioSourceAtPosition(
  audio: HTMLAudioElement,
  positionSeconds: number,
  setPositionSeconds: (positionSeconds: number) => void,
  onReady: () => void,
  onFailure: () => void
) {
  let settled = false;
  let positionApplied = false;

  const cleanup = () => {
    audio.removeEventListener("loadedmetadata", applyPosition);
    audio.removeEventListener("canplay", handleCanPlay);
    audio.removeEventListener("seeked", handleSeeked);
    audio.removeEventListener("error", handleError);
  };

  const cancel = () => {
    settled = true;
    cleanup();
  };

  const finish = () => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    onReady();
  };

  const fail = () => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    onFailure();
  };

  function applyPosition() {
    if (settled || audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      return;
    }
    positionApplied = setAudioPosition(audio, positionSeconds);
    setPositionSeconds(positionApplied ? positionSeconds : 0);
  }

  function handleCanPlay() {
    applyPosition();
    if (positionApplied) {
      finish();
    } else {
      fail();
    }
  }

  function handleSeeked() {
    if (positionApplied) {
      finish();
    }
  }

  function handleError() {
    fail();
  }

  audio.addEventListener("loadedmetadata", applyPosition);
  audio.addEventListener("canplay", handleCanPlay);
  audio.addEventListener("seeked", handleSeeked);
  audio.addEventListener("error", handleError);
  audio.load();

  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    queueMicrotask(() => {
      applyPosition();
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        finish();
      }
    });
  }

  return cancel;
}

export function primeAudioSource(
  audio: HTMLAudioElement,
  episode: AudioSourceEpisode,
  speedLabel: PlaybackSpeedLabel,
  positionSeconds: number,
  setPositionSeconds: (positionSeconds: number) => void,
  markPrimed: () => void,
  onReady: () => void
) {
  const targetSrc = `${window.location.origin}/api/episodes/${episode.id}/audio`;
  const sourceChanged = !audio.src.includes(targetSrc);
  let settled = false;

  const cleanup = () => {
    audio.removeEventListener("loadedmetadata", applyPosition);
    audio.removeEventListener("canplay", applyPosition);
    audio.removeEventListener("error", cleanup);
  };

  const applyPosition = () => {
    if (settled || !audio.src.includes(targetSrc)) {
      return;
    }

    settled = true;
    cleanup();
    const positionApplied = setAudioPosition(audio, positionSeconds);
    setPositionSeconds(positionApplied ? positionSeconds : 0);
    onReady();
  };

  if (sourceChanged) {
    audio.pause();
    audio.src = targetSrc;
    markPrimed();
    applyPlaybackRate(audio, speedLabel);
    audio.addEventListener("loadedmetadata", applyPosition);
    audio.addEventListener("canplay", applyPosition);
    audio.addEventListener("error", cleanup);
    return;
  }

  applyPlaybackRate(audio, speedLabel);

  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
    applyPosition();
    return;
  }

  audio.addEventListener("loadedmetadata", applyPosition);
  audio.addEventListener("canplay", applyPosition);
  audio.addEventListener("error", cleanup);
}
