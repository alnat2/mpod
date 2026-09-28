package http

// Temporary diagnostics for the test branch. Remove after investigating the
// rare playback-completion failure.
import (
	nethttp "net/http"
	"time"
)

type playbackDiagnosticEvent struct {
	ID                  string `json:"id"`
	TraceID             string `json:"traceId"`
	At                  string `json:"at"`
	Event               string `json:"event"`
	EpisodeID           int64  `json:"episodeId"`
	AudiobookID         int64  `json:"audiobookId"`
	TrackID             int64  `json:"trackId"`
	NextEpisodeID       int64  `json:"nextEpisodeId"`
	NextAudiobookID     int64  `json:"nextAudiobookId"`
	NextTrackID         int64  `json:"nextTrackId"`
	SourceGeneration    int64  `json:"sourceGeneration"`
	SelectionGeneration int64  `json:"selectionGeneration"`
	Status              int    `json:"status"`
	Code                string `json:"code"`
}

func validPlaybackTraceID(value string) bool {
	if len(value) < 3 || len(value) > 64 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') &&
			(character < '0' || character > '9') && character != '-' {
			return false
		}
	}
	return true
}

func validPlaybackDiagnosticCode(value string) bool {
	if len(value) > 64 {
		return false
	}
	for _, character := range value {
		if (character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') && character != '_' {
			return false
		}
	}
	return true
}

func validPlaybackDiagnosticEvent(value string) bool {
	switch value {
	case "ended", "predicted_next", "completion_request", "completion_response",
		"completion_error", "queue_refreshed", "transition_continued",
		"transition_stopped", "stale_completion", "audio_playing",
		"audio_error", "manual_play", "manual_pause", "selection_changed":
		return true
	default:
		return false
	}
}

func (r *Router) handlePlaybackDiagnostics(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}
	req.Body = nethttp.MaxBytesReader(w, req.Body, 16<<10)
	var payload struct {
		Events []playbackDiagnosticEvent `json:"events"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}
	if len(payload.Events) == 0 || len(payload.Events) > 20 {
		r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_DIAGNOSTICS", "Expected 1 to 20 events")
		return
	}
	for _, event := range payload.Events {
		if !validPlaybackTraceID(event.ID) || !validPlaybackTraceID(event.TraceID) ||
			!validPlaybackDiagnosticEvent(event.Event) ||
			!validPlaybackDiagnosticCode(event.Code) ||
			event.Status < 0 || event.Status > 599 {
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_DIAGNOSTICS", "Invalid event")
			return
		}
		if _, err := time.Parse(time.RFC3339Nano, event.At); err != nil {
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_DIAGNOSTICS", "Invalid event time")
			return
		}
	}
	for _, event := range payload.Events {
		r.logger.Printf(
			"playback_trace client trace=%q event_id=%q at=%q event=%q audiobook=%d track=%d episode=%d next_audiobook=%d next_track=%d next_episode=%d source_gen=%d selection_gen=%d status=%d code=%q",
			event.TraceID, event.ID, event.At, event.Event, event.AudiobookID,
			event.TrackID, event.EpisodeID, event.NextAudiobookID, event.NextTrackID,
			event.NextEpisodeID, event.SourceGeneration, event.SelectionGeneration,
			event.Status, event.Code,
		)
	}
	w.WriteHeader(nethttp.StatusNoContent)
}
