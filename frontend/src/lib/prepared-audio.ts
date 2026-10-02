import type { PlaybackSpeedLabel } from "@/components/mpod/playback";
import { applyPlaybackRate, getAudioSourceUrl, setAudioPosition } from "./playback-audio";
import type { QueueEpisode } from "./playback-context-types";

// One silent reserve element. Metadata alone does not mean that it can play.
export function prepareNextAudio(
  episode: QueueEpisode,
  speed: PlaybackSpeedLabel,
  onReady: () => void,
  onError: () => void,
) {
  const audio = new Audio();
  const position = Math.max(0, episode.playback?.positionSeconds ?? 0);
  let disposed = false;
  let positionApplied = false;
  let reportedReady = false;

  const isReady = () => {
    if (disposed || !positionApplied || audio.error || audio.seeking ||
      audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA ||
      Math.abs(audio.currentTime - position) > 0.25) return false;
    const buffered = audio.buffered;
    if (!buffered) return false;
    const end = Number.isFinite(audio.duration)
      ? Math.min(position + 0.25, audio.duration) : position + 0.25;
    for (let index = 0; index < buffered.length; index += 1) {
      if (buffered.start(index) <= position && buffered.end(index) >= end && end > position) return true;
    }
    return false;
  };

  const check = () => {
    if (disposed) return;
    if (!positionApplied && audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      positionApplied = position === 0 || setAudioPosition(audio, position);
    }
    if (!reportedReady && isReady()) {
      reportedReady = true;
      onReady();
    }
  };
  const fail = () => {
    if (!disposed) onError();
  };
  const readinessEvents = ["loadedmetadata", "canplay", "progress", "seeked"];
  const detach = () => {
    readinessEvents.forEach((event) => audio.removeEventListener(event, check));
    audio.removeEventListener("error", fail);
  };
  const cancel = () => {
    if (disposed) return;
    disposed = true;
    detach();
    audio.pause();
    if (typeof audio.removeAttribute === "function") audio.removeAttribute("src");
    else audio.src = "";
    audio.load();
  };
  readinessEvents.forEach((event) => audio.addEventListener(event, check));
  audio.addEventListener("error", fail);
  audio.preload = "auto";
  audio.src = getAudioSourceUrl(episode);
  applyPlaybackRate(audio, speed);
  audio.load();

  return {
    audio,
    position,
    isReady,
    cancel,
    take: () => {
      if (!isReady()) return null;
      disposed = true;
      detach();
      return audio;
    },
  };
}
