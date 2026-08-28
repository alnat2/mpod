package http

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"math"
	nethttp "net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/episodes"
	"github.com/cross/mpod/server/internal/media"
)

const (
	audioProxyUserAgent = "mpod/1.0 (+self-hosted podcast client)"
	audioProxyAccept    = "audio/*, application/octet-stream;q=0.9, */*;q=0.1"
	minimumStreamRate   = 32 * 1024
	streamRateHeadroom  = 1.5
	streamInitialBurst  = 2 * time.Second
)

var (
	errRemoteAudioLoad        = errors.New("remote audio load failed")
	errRemoteAudioNotPlayable = errors.New("remote audio not playable")
)

func (r *Router) handleEpisodeGet(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	episodeID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	episode, err := r.episodes.GetByID(req.Context(), episodeID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			r.writeAPIError(w, nethttp.StatusNotFound, "EPISODE_NOT_FOUND", "Episode was not found")
			return
		}
		r.writeAPIError(w, nethttp.StatusInternalServerError, "EPISODE_GET_FAILED", "Failed to load episode")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"episode": episode})
}

func (r *Router) handleEpisodePatch(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	episodeID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	var payload struct {
		IsListened *bool `json:"isListened"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}
	if payload.IsListened == nil {
		r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_EPISODE_PATCH", "isListened is required")
		return
	}

	if err := r.episodeActions.SetListened(req.Context(), episodeID, *payload.IsListened); err != nil {
		switch err {
		case episodes.ErrEpisodeNotFound:
			r.writeAPIError(w, nethttp.StatusNotFound, "EPISODE_NOT_FOUND", "Episode was not found")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "EPISODE_PATCH_FAILED", "Failed to update episode")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"episode": map[string]any{
			"id":         episodeID,
			"isListened": *payload.IsListened,
		},
	})
}

func (r *Router) handleEpisodeDownload(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	episodeID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	item, err := r.downloads.Download(req.Context(), episodeID)
	if err != nil {
		switch err {
		case downloads.ErrEpisodeNotFound:
			r.writeAPIError(w, nethttp.StatusNotFound, "EPISODE_NOT_FOUND", "Episode was not found")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "DOWNLOAD_FAILED", "Failed to download episode")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"success": true,
		"episode": item,
	})
}

func (r *Router) handleEpisodeDownloadDelete(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	episodeID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	item, err := r.downloads.Delete(req.Context(), episodeID)
	if err != nil {
		switch err {
		case downloads.ErrEpisodeNotFound:
			r.writeAPIError(w, nethttp.StatusNotFound, "EPISODE_NOT_FOUND", "Episode was not found")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "DOWNLOAD_DELETE_FAILED", "Failed to delete downloaded file")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"success": true,
		"episode": item,
	})
}

func (r *Router) handleEpisodeAudio(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	episodeID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	path, err := r.downloads.GetLocalPath(req.Context(), episodeID)
	if err != nil && err != downloads.ErrEpisodeNotFound {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "AUDIO_LOAD_FAILED", "Failed to check local audio")
		return
	}

	if path != "" {
		nethttp.ServeFile(w, req, path)
		return
	}

	episode, err := r.episodes.GetByID(req.Context(), episodeID)
	if err != nil {
		r.writeAPIError(w, nethttp.StatusNotFound, "EPISODE_NOT_FOUND", "Episode was not found")
		return
	}

	audioResp, err := r.openRemoteEpisodeAudio(req, episode.AudioURL, r.audioClient)
	if err != nil {
		if r.shouldRetryAudioDirect(req.Context()) {
			r.logger.Printf("proxy episode audio failed, retrying direct path: %v", err)
			audioResp, err = r.openRemoteEpisodeAudio(req, episode.AudioURL, r.directAudioClient)
		}
		if err != nil {
			if errors.Is(err, errRemoteAudioNotPlayable) {
				r.writeAPIError(w, nethttp.StatusBadGateway, "AUDIO_LOAD_FAILED", "Audio source is not playable")
				return
			}
			r.writeAPIError(w, nethttp.StatusBadGateway, "AUDIO_LOAD_FAILED", "Failed to load audio")
			return
		}
	}
	defer audioResp.response.Body.Close()

	resp := audioResp.response
	resolvedContentType := media.PreferredPlayableContentType(audioResp.contentType, audioResp.prefix)
	if resolvedContentType != "" {
		w.Header().Set("Content-Type", resolvedContentType)
	}
	if acceptRanges := strings.TrimSpace(resp.Header.Get("Accept-Ranges")); acceptRanges != "" {
		w.Header().Set("Accept-Ranges", acceptRanges)
	}
	if contentRange := strings.TrimSpace(resp.Header.Get("Content-Range")); contentRange != "" {
		w.Header().Set("Content-Range", contentRange)
	}
	if contentLength := strings.TrimSpace(resp.Header.Get("Content-Length")); contentLength != "" {
		w.Header().Set("Content-Length", contentLength)
	}
	if contentDisposition := strings.TrimSpace(resp.Header.Get("Content-Disposition")); contentDisposition != "" {
		w.Header().Set("Content-Disposition", contentDisposition)
	}
	w.Header().Set("Cache-Control", "private, max-age=0")
	w.WriteHeader(resp.StatusCode)
	stream := io.Reader(io.MultiReader(bytes.NewReader(audioResp.prefix), resp.Body))
	if episode.Duration != nil {
		if bytesPerSecond := streamBytesPerSecond(audioResp.totalLength, *episode.Duration); bytesPerSecond > 0 {
			stream = newPacedReader(req.Context(), stream, bytesPerSecond)
		}
	}
	if _, err := io.Copy(w, stream); err != nil {
		r.logger.Printf("copy episode audio failed: %v", err)
	}
}

type remoteEpisodeAudio struct {
	response    *nethttp.Response
	prefix      []byte
	contentType string
	totalLength int64
}

func (r *Router) openRemoteEpisodeAudio(sourceReq *nethttp.Request, audioURL string, client *nethttp.Client) (*remoteEpisodeAudio, error) {
	if client == nil {
		return nil, errRemoteAudioLoad
	}

	audioReq, err := nethttp.NewRequestWithContext(sourceReq.Context(), nethttp.MethodGet, audioURL, nil)
	if err != nil {
		return nil, errRemoteAudioLoad
	}
	audioReq.Header.Set("User-Agent", audioProxyUserAgent)
	audioReq.Header.Set("Accept", audioProxyAccept)

	if rangeHeader := strings.TrimSpace(sourceReq.Header.Get("Range")); rangeHeader != "" {
		audioReq.Header.Set("Range", rangeHeader)
	}

	resp, err := client.Do(audioReq)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errRemoteAudioLoad, err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		resp.Body.Close()
		return nil, fmt.Errorf("%w: upstream status %d", errRemoteAudioLoad, resp.StatusCode)
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if !media.IsPlayableContentType(contentType) {
		resp.Body.Close()
		return nil, fmt.Errorf("%w: content type %q", errRemoteAudioNotPlayable, contentType)
	}
	prefix, err := media.ReadBodyPrefix(resp.Body)
	if err != nil {
		resp.Body.Close()
		return nil, fmt.Errorf("%w: %v", errRemoteAudioLoad, err)
	}
	if media.LooksLikeNonPlayableBody(prefix) {
		resp.Body.Close()
		return nil, errRemoteAudioNotPlayable
	}

	return &remoteEpisodeAudio{
		response:    resp,
		prefix:      prefix,
		contentType: contentType,
		totalLength: responseTotalLength(resp),
	}, nil
}

func responseTotalLength(resp *nethttp.Response) int64 {
	contentRange := strings.TrimSpace(resp.Header.Get("Content-Range"))
	if _, total, ok := strings.Cut(contentRange, "/"); ok {
		if parsed, err := strconv.ParseInt(strings.TrimSpace(total), 10, 64); err == nil && parsed > 0 {
			return parsed
		}
	}
	if resp.ContentLength > 0 {
		return resp.ContentLength
	}
	if parsed, err := strconv.ParseInt(strings.TrimSpace(resp.Header.Get("Content-Length")), 10, 64); err == nil && parsed > 0 {
		return parsed
	}
	return 0
}

func streamBytesPerSecond(contentLength, durationSeconds int64) int64 {
	if contentLength <= 0 || durationSeconds <= 0 {
		return 0
	}
	rate := int64(math.Ceil(float64(contentLength) / float64(durationSeconds) * streamRateHeadroom))
	if rate < minimumStreamRate {
		return minimumStreamRate
	}
	return rate
}

type pacedReader struct {
	ctx            context.Context
	reader         io.Reader
	bytesPerSecond int64
	burstBytes     int64
	startedAt      time.Time
	bytesRead      int64
	now            func() time.Time
	wait           func(context.Context, time.Duration) error
}

func newPacedReader(ctx context.Context, reader io.Reader, bytesPerSecond int64) *pacedReader {
	return &pacedReader{
		ctx:            ctx,
		reader:         reader,
		bytesPerSecond: bytesPerSecond,
		burstBytes:     int64(streamInitialBurst.Seconds()) * bytesPerSecond,
		startedAt:      time.Now(),
		now:            time.Now,
		wait:           waitContext,
	}
}

func (r *pacedReader) Read(buffer []byte) (int, error) {
	n, err := r.reader.Read(buffer)
	if n == 0 {
		return n, err
	}
	r.bytesRead += int64(n)
	throttledBytes := r.bytesRead - r.burstBytes
	if throttledBytes <= 0 || r.bytesPerSecond <= 0 {
		return n, err
	}

	targetElapsed := time.Duration(float64(throttledBytes) / float64(r.bytesPerSecond) * float64(time.Second))
	if delay := targetElapsed - r.now().Sub(r.startedAt); delay > 0 {
		if waitErr := r.wait(r.ctx, delay); waitErr != nil {
			return n, waitErr
		}
	}
	return n, err
}

func waitContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (r *Router) shouldRetryAudioDirect(ctx context.Context) bool {
	if r.directAudioClient == nil || r.directAudioClient == r.audioClient || r.settings == nil || r.config.SOCKS5Host == "" {
		return false
	}
	enabled, err := r.settings.ProxyEnabled(ctx)
	return err == nil && enabled
}
