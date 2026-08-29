package http

import (
	nethttp "net/http"
	"strconv"
	"time"

	"github.com/cross/mpod/server/internal/playback"
	"github.com/cross/mpod/server/internal/playlist"
)

func (r *Router) handlePlaybackGet(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	episodeValue := req.URL.Query().Get("episodeId")
	audiobookValue := req.URL.Query().Get("audiobookId")
	if (episodeValue == "") == (audiobookValue == "") {
		r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_PLAYBACK_TARGET", "Provide exactly one of episodeId or audiobookId")
		return
	}

	var state *playback.State
	var err error
	if episodeValue != "" {
		episodeID, parseErr := strconv.ParseInt(episodeValue, 10, 64)
		if parseErr != nil || episodeID <= 0 {
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_PLAYBACK_TARGET", "episodeId must be a positive integer")
			return
		}
		state, err = r.playback.GetEpisode(req.Context(), episodeID)
	} else {
		audiobookID, parseErr := strconv.ParseInt(audiobookValue, 10, 64)
		if parseErr != nil || audiobookID <= 0 {
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_PLAYBACK_TARGET", "audiobookId must be a positive integer")
			return
		}
		var trackID *int64
		if trackValue := req.URL.Query().Get("trackId"); trackValue != "" {
			parsedTrackID, trackErr := strconv.ParseInt(trackValue, 10, 64)
			if trackErr != nil || parsedTrackID <= 0 {
				r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_PLAYBACK_TARGET", "trackId must be a positive integer")
				return
			}
			trackID = &parsedTrackID
		}
		state, err = r.playback.GetAudiobook(req.Context(), audiobookID, trackID)
	}
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYBACK_LOAD_FAILED", "Failed to load playback state")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"playback": state})
}

func (r *Router) handlePlaybackQueue(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	queue, err := r.playback.ListQueue(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYBACK_QUEUE_LOAD_FAILED", "Failed to load playback queue")
		return
	}
	active, err := r.playback.GetActive(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYBACK_QUEUE_LOAD_FAILED", "Failed to load playback queue")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"queue":          queue,
		"activePlayback": active,
	})
}

func (r *Router) handlePlaybackActivePut(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	var payload struct {
		EpisodeID   *int64 `json:"episodeId"`
		AudiobookID *int64 `json:"audiobookId"`
		TrackID     *int64 `json:"trackId"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}

	active, err := r.playback.SetActiveItem(req.Context(), payload.EpisodeID, payload.AudiobookID, payload.TrackID)
	if err != nil {
		switch err {
		case playback.ErrEpisodeNotFound:
			r.writeAPIError(w, nethttp.StatusNotFound, "EPISODE_NOT_FOUND", "Episode was not found")
		case playback.ErrEpisodeNotInPlaylist:
			r.writeAPIError(w, nethttp.StatusBadRequest, "EPISODE_NOT_IN_PLAYLIST", "Episode is not in the playlist")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYBACK_ACTIVE_UPDATE_FAILED", "Failed to update active playback")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"activePlayback": active})
}

func (r *Router) handlePlaybackPost(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	var payload struct {
		EpisodeID       *int64 `json:"episodeId"`
		AudiobookID     *int64 `json:"audiobookId"`
		TrackID         *int64 `json:"trackId"`
		PositionSeconds int64  `json:"positionSeconds"`
		DurationSeconds int64  `json:"durationSeconds"`
		Completed       bool   `json:"completed"`
		DidSeek         bool   `json:"didSeek"`
		ClientUpdatedAt string `json:"clientUpdatedAt"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}
	if (payload.EpisodeID == nil) == (payload.AudiobookID == nil) || (payload.AudiobookID != nil && payload.TrackID == nil) {
		r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_PLAYBACK_TARGET", "Provide an episodeId or an audiobookId with trackId")
		return
	}

	var clientUpdatedAt *time.Time
	if payload.ClientUpdatedAt != "" {
		parsed, err := time.Parse(time.RFC3339, payload.ClientUpdatedAt)
		if err != nil {
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_CLIENT_UPDATED_AT", "clientUpdatedAt must be RFC3339")
			return
		}
		clientUpdatedAt = &parsed
	}

	result, err := r.playback.Update(req.Context(), playback.UpdateInput{
		EpisodeID:       valueOrZero(payload.EpisodeID),
		AudiobookID:     payload.AudiobookID,
		TrackID:         payload.TrackID,
		PositionSeconds: payload.PositionSeconds,
		DurationSeconds: payload.DurationSeconds,
		Completed:       payload.Completed,
		DidSeek:         payload.DidSeek,
		ClientUpdatedAt: clientUpdatedAt,
	})
	if err != nil {
		switch err {
		case playback.ErrEpisodeNotFound:
			r.writeAPIError(w, nethttp.StatusNotFound, "EPISODE_NOT_FOUND", "Episode was not found")
		case playback.ErrInvalidPosition:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_POSITION", "positionSeconds must be zero or greater")
		case playback.ErrInvalidTarget:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_PLAYBACK_TARGET", "Invalid playback target")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYBACK_UPDATE_FAILED", "Failed to update playback")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, result)
}

func valueOrZero(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func (r *Router) handlePlaylistList(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	items, err := r.playlist.List(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYLIST_LIST_FAILED", "Failed to load playlist")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"items": items})
}

func (r *Router) handlePlaylistAdd(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	var payload struct {
		EpisodeID   int64 `json:"episodeId"`
		AudiobookID int64 `json:"audiobookId"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}

	if payload.AudiobookID <= 0 && payload.EpisodeID <= 0 {
		r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_REQUEST", "Either episodeId or audiobookId must be provided")
		return
	}

	if payload.AudiobookID > 0 {
		if err := r.playlist.AddAudiobook(req.Context(), payload.AudiobookID); err != nil {
			switch err {
			case playlist.ErrAudiobookNotFound:
				r.writeAPIError(w, nethttp.StatusNotFound, "AUDIOBOOK_NOT_FOUND", "Audiobook was not found")
			default:
				r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYLIST_ADD_FAILED", "Failed to add audiobook to playlist")
			}
			return
		}
		r.writeJSON(w, nethttp.StatusOK, map[string]any{"success": true})
		return
	}

	if err := r.playlist.Add(req.Context(), payload.EpisodeID); err != nil {
		switch err {
		case playlist.ErrEpisodeNotFound:
			r.writeAPIError(w, nethttp.StatusNotFound, "EPISODE_NOT_FOUND", "Episode was not found")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYLIST_ADD_FAILED", "Failed to add episode to playlist")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"success": true})
}

func (r *Router) handlePlaylistRemove(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	episodeID, ok := r.pathInt64(w, req, "episodeId")
	if !ok {
		return
	}

	if err := r.playlistActions.Remove(req.Context(), episodeID); err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYLIST_REMOVE_FAILED", "Failed to remove episode download")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"success": true})
}

func (r *Router) handlePlaylistReorder(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	var payload struct {
		Items []playlist.ReorderItem `json:"items"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}

	if err := r.playlist.Reorder(req.Context(), payload.Items); err != nil {
		switch err {
		case playlist.ErrInvalidReorder:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_PLAYLIST_ORDER", "items must match the full playlist contents")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYLIST_REORDER_FAILED", "Failed to reorder playlist")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"success": true})
}
