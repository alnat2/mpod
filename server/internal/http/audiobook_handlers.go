package http

import (
	"errors"
	"mime"
	nethttp "net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/cross/mpod/server/internal/audiobooks"
	"github.com/cross/mpod/server/internal/playlist"
)

func (r *Router) handleAudiobooksList(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	books, err := r.audiobooks.List(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "AUDIOBOOKS_LIST_FAILED", "Failed to list audiobooks")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"audiobooks": books})
}

func (r *Router) handleAudiobookGet(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	id, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	book, err := r.audiobooks.Get(req.Context(), id)
	if err != nil {
		if errors.Is(err, audiobooks.ErrBookNotFound) {
			r.writeAPIError(w, nethttp.StatusNotFound, "AUDIOBOOK_NOT_FOUND", "Audiobook not found")
			return
		}
		r.writeAPIError(w, nethttp.StatusInternalServerError, "AUDIOBOOK_GET_FAILED", "Failed to get audiobook")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"audiobook": book})
}

func (r *Router) handleAudiobookCover(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	id, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	coverPath, err := r.audiobooks.GetCoverPath(req.Context(), id)
	if err != nil {
		if errors.Is(err, audiobooks.ErrBookNotFound) || errors.Is(err, audiobooks.ErrNoCover) {
			r.writeAPIError(w, nethttp.StatusNotFound, "COVER_NOT_FOUND", "Audiobook cover not found")
			return
		}
		r.writeAPIError(w, nethttp.StatusInternalServerError, "COVER_GET_FAILED", "Failed to get audiobook cover")
		return
	}

	ext := strings.ToLower(filepath.Ext(coverPath))
	switch ext {
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	}

	nethttp.ServeFile(w, req, coverPath)
}

func (r *Router) handleAudiobooksRescan(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	if err := r.audiobooks.Rescan(req.Context()); err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "RESCAN_FAILED", "Failed to rescan audiobooks")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"success": true})
}

func (r *Router) handleAudiobookDelete(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	id, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	deleteDiskFiles := req.URL.Query().Get("deleteFiles") == "true"
	if err := r.audiobooks.Delete(req.Context(), id, deleteDiskFiles); err != nil {
		if errors.Is(err, audiobooks.ErrBookNotFound) {
			r.writeAPIError(w, nethttp.StatusNotFound, "AUDIOBOOK_NOT_FOUND", "Audiobook not found")
			return
		}
		r.writeAPIError(w, nethttp.StatusInternalServerError, "DELETE_FAILED", "Failed to delete audiobook")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"success": true})
}

func (r *Router) handleAudiobookTrackAudio(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	trackID, ok := r.pathInt64(w, req, "trackId")
	if !ok {
		return
	}

	track, err := r.audiobooks.GetTrack(req.Context(), trackID)
	if err != nil {
		if errors.Is(err, audiobooks.ErrTrackNotFound) {
			r.writeAPIError(w, nethttp.StatusNotFound, "TRACK_NOT_FOUND", "Audiobook track not found")
			return
		}
		r.writeAPIError(w, nethttp.StatusInternalServerError, "TRACK_GET_FAILED", "Failed to get audiobook track")
		return
	}

	if _, err := os.Stat(track.FilePath); err != nil {
		r.writeAPIError(w, nethttp.StatusNotFound, "FILE_NOT_FOUND", "Audio file not found on disk")
		return
	}

	ext := strings.ToLower(filepath.Ext(track.FilePath))
	switch ext {
	case ".mp3":
		w.Header().Set("Content-Type", "audio/mpeg")
	case ".m4a", ".m4b":
		w.Header().Set("Content-Type", "audio/mp4")
	default:
		if ctype := mime.TypeByExtension(ext); ctype != "" {
			w.Header().Set("Content-Type", ctype)
		}
	}
	w.Header().Set("Accept-Ranges", "bytes")

	nethttp.ServeFile(w, req, track.FilePath)
}

func (r *Router) handleAudiobookPlaylistAdd(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	id, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	if err := r.playlist.AddAudiobook(req.Context(), id); err != nil {
		if errors.Is(err, playlist.ErrAudiobookNotFound) {
			r.writeAPIError(w, nethttp.StatusNotFound, "AUDIOBOOK_NOT_FOUND", "Audiobook not found")
			return
		}
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYLIST_ADD_FAILED", "Failed to add audiobook to playlist")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"success": true})
}

func (r *Router) handleAudiobookPlaylistRemove(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	id, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	if err := r.playlist.RemoveAudiobook(req.Context(), id); err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYLIST_REMOVE_FAILED", "Failed to remove audiobook from playlist")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"success": true})
}

func (r *Router) handleAudiobookPlaybackPost(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	var payload struct {
		TrackID         int64 `json:"trackId"`
		PositionSeconds int64 `json:"positionSeconds"`
		Completed       bool  `json:"completed"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}

	nextTrackID, err := r.audiobooks.SaveTrackProgress(req.Context(), payload.TrackID, payload.PositionSeconds, payload.Completed)
	if err != nil {
		if errors.Is(err, audiobooks.ErrTrackNotFound) {
			r.writeAPIError(w, nethttp.StatusNotFound, "TRACK_NOT_FOUND", "Track not found")
			return
		}
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYBACK_UPDATE_FAILED", "Failed to save track progress")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"playback": map[string]any{
			"trackId":         payload.TrackID,
			"positionSeconds": payload.PositionSeconds,
		},
		"nextTrackId": nextTrackID,
	})
}
