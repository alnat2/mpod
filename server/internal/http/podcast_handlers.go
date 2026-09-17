package http

import (
	"context"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	nethttp "net/http"
	"strconv"
	"strings"
	"time"

	"github.com/cross/mpod/server/internal/episodes"
	"github.com/cross/mpod/server/internal/podcasts"
	"github.com/cross/mpod/server/internal/scheduler"
)

const (
	maxPodcastImageBytes      = 5 * 1024 * 1024
	podcastImageCacheTTL      = 24 * time.Hour
	maxPodcastImageCacheItems = 100
)

type cachedImage struct {
	data        []byte
	contentType string
	etag        string
	fetchedAt   time.Time
}

func (r *Router) handlePodcastsList(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	items, err := r.podcasts.List(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PODCAST_LIST_FAILED", "Failed to load podcasts")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"podcasts": items,
	})
}

func (r *Router) handlePodcastsCreate(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	var payload struct {
		RSSURL string `json:"rssUrl"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}

	podcast, err := r.podcasts.CreateFromFeed(req.Context(), payload.RSSURL)
	if err != nil {
		r.logger.Printf("podcast create failed for %q: %v", payload.RSSURL, err)
		switch {
		case errors.Is(err, podcasts.ErrInvalidFeedURL):
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_FEED_URL", "RSS URL is invalid")
		case errors.Is(err, podcasts.ErrDuplicateSubscription):
			r.writeAPIError(w, nethttp.StatusBadRequest, "DUPLICATE_SUBSCRIPTION", "Podcast is already subscribed")
		case errors.Is(err, podcasts.ErrFeedFetchFailed):
			r.writeAPIError(w, nethttp.StatusBadRequest, "FEED_FETCH_FAILED", "Failed to fetch feed")
		case errors.Is(err, podcasts.ErrFeedParseFailed):
			r.writeAPIError(w, nethttp.StatusBadRequest, "FEED_PARSE_FAILED", "Feed could not be parsed")
		case errors.Is(err, podcasts.ErrNoPlayableEpisodesFound):
			r.writeAPIError(w, nethttp.StatusBadRequest, "NO_PLAYABLE_EPISODES", "Feed does not contain playable episodes")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PODCAST_CREATE_FAILED", "Failed to create podcast")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"podcast": podcast,
	})
}

func (r *Router) handlePodcastGet(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	podcastID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	podcast, err := r.podcasts.GetByID(req.Context(), podcastID)
	if err != nil {
		switch err {
		case podcasts.ErrPodcastNotFound:
			r.writeAPIError(w, nethttp.StatusNotFound, "PODCAST_NOT_FOUND", "Podcast was not found")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PODCAST_GET_FAILED", "Failed to load podcast")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"podcast": podcast})
}

func (r *Router) getCachedPodcastImage(podcastID int64) (cachedImage, bool) {
	r.imageMu.RLock()
	defer r.imageMu.RUnlock()

	img, ok := r.imageCache[podcastID]
	if !ok {
		return cachedImage{}, false
	}
	if time.Since(img.fetchedAt) >= podcastImageCacheTTL {
		return cachedImage{}, false
	}
	return img, true
}

func (r *Router) setCachedPodcastImage(podcastID int64, img cachedImage) {
	r.imageMu.Lock()
	defer r.imageMu.Unlock()

	if r.imageCache == nil {
		r.imageCache = make(map[int64]cachedImage)
	}

	if len(r.imageCache) >= maxPodcastImageCacheItems {
		now := time.Now()
		for id, item := range r.imageCache {
			if now.Sub(item.fetchedAt) >= podcastImageCacheTTL {
				delete(r.imageCache, id)
			}
		}
	}

	if len(r.imageCache) >= maxPodcastImageCacheItems {
		var oldestID int64
		var oldestTime time.Time
		first := true
		for id, item := range r.imageCache {
			if first || item.fetchedAt.Before(oldestTime) {
				oldestID = id
				oldestTime = item.fetchedAt
				first = false
			}
		}
		if !first {
			delete(r.imageCache, oldestID)
		}
	}

	r.imageCache[podcastID] = img
}

func (r *Router) evictCachedPodcastImage(podcastID int64) {
	r.imageMu.Lock()
	defer r.imageMu.Unlock()
	delete(r.imageCache, podcastID)
}

func computeImageETag(payload []byte) string {
	checksum := crc32.ChecksumIEEE(payload)
	return fmt.Sprintf(`"%08x-%x"`, checksum, len(payload))
}

func matchETag(ifNoneMatch, etag string) bool {
	if ifNoneMatch == "" {
		return false
	}
	if ifNoneMatch == "*" {
		return true
	}
	parts := strings.Split(ifNoneMatch, ",")
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		trimmed = strings.TrimPrefix(trimmed, "W/")
		target := strings.TrimPrefix(etag, "W/")
		if trimmed == target {
			return true
		}
	}
	return false
}

func (r *Router) handlePodcastImage(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	podcastID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	if img, ok := r.getCachedPodcastImage(podcastID); ok {
		w.Header().Set("Cache-Control", "private, max-age=604800")
		w.Header().Set("ETag", img.etag)

		if matchETag(req.Header.Get("If-None-Match"), img.etag) {
			w.WriteHeader(nethttp.StatusNotModified)
			return
		}

		w.Header().Set("Content-Type", img.contentType)
		w.Header().Set("Content-Length", strconv.Itoa(len(img.data)))
		if _, err := w.Write(img.data); err != nil {
			r.logger.Printf("write cached podcast image failed: %v", err)
		}
		return
	}

	podcast, err := r.podcasts.GetByID(req.Context(), podcastID)
	if err != nil {
		r.writeAPIError(w, nethttp.StatusNotFound, "PODCAST_NOT_FOUND", "Podcast was not found")
		return
	}
	if podcast.ImageURL == nil || strings.TrimSpace(*podcast.ImageURL) == "" {
		r.writeAPIError(w, nethttp.StatusNotFound, "PODCAST_IMAGE_NOT_FOUND", "Podcast image was not found")
		return
	}

	imageReq, err := nethttp.NewRequestWithContext(req.Context(), nethttp.MethodGet, *podcast.ImageURL, nil)
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PODCAST_IMAGE_LOAD_FAILED", "Failed to load podcast image")
		return
	}

	resp, err := r.remoteClient.Do(imageReq)
	if err != nil {
		r.writeAPIError(w, nethttp.StatusBadGateway, "PODCAST_IMAGE_LOAD_FAILED", "Failed to load podcast image")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		r.writeAPIError(w, nethttp.StatusBadGateway, "PODCAST_IMAGE_LOAD_FAILED", "Failed to load podcast image")
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		r.writeAPIError(w, nethttp.StatusBadGateway, "PODCAST_IMAGE_LOAD_FAILED", "Failed to load podcast image")
		return
	}

	if resp.ContentLength > maxPodcastImageBytes {
		r.writeAPIError(w, nethttp.StatusBadGateway, "PODCAST_IMAGE_LOAD_FAILED", "Failed to load podcast image")
		return
	}

	// LimitReader bounds the read to protect against chunked or unbounded streams exceeding the limit.
	// For responses with positive Content-Length, net/http.Transport frames and bounds resp.Body to that size.
	payload, err := io.ReadAll(io.LimitReader(resp.Body, maxPodcastImageBytes+1))
	if err != nil {
		r.logger.Printf("read podcast image failed: %v", err)
		r.writeAPIError(w, nethttp.StatusBadGateway, "PODCAST_IMAGE_LOAD_FAILED", "Failed to load podcast image")
		return
	}
	if int64(len(payload)) > maxPodcastImageBytes {
		r.writeAPIError(w, nethttp.StatusBadGateway, "PODCAST_IMAGE_LOAD_FAILED", "Failed to load podcast image")
		return
	}

	img := cachedImage{
		data:        payload,
		contentType: contentType,
		etag:        computeImageETag(payload),
		fetchedAt:   time.Now(),
	}
	r.setCachedPodcastImage(podcastID, img)

	w.Header().Set("Cache-Control", "private, max-age=604800")
	w.Header().Set("ETag", img.etag)

	if matchETag(req.Header.Get("If-None-Match"), img.etag) {
		w.WriteHeader(nethttp.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(payload)))
	if _, err := w.Write(payload); err != nil {
		r.logger.Printf("write podcast image failed: %v", err)
	}
}

func (r *Router) handlePodcastDelete(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	podcastID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	if err := r.podcasts.Delete(req.Context(), podcastID); err != nil {
		switch err {
		case podcasts.ErrPodcastNotFound:
			r.writeAPIError(w, nethttp.StatusNotFound, "PODCAST_NOT_FOUND", "Podcast was not found")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PODCAST_DELETE_FAILED", "Failed to delete podcast")
		}
		return
	}

	r.evictCachedPodcastImage(podcastID)
	r.writeJSON(w, nethttp.StatusOK, map[string]any{"success": true})
}

func (r *Router) handlePodcastRefresh(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	podcastID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	newEpisodes, checkedAt, err := r.podcasts.Refresh(req.Context(), podcastID)
	if err != nil {
		r.logger.Printf("podcast refresh failed for id=%d: %v", podcastID, err)
		switch {
		case errors.Is(err, podcasts.ErrPodcastNotFound):
			r.writeAPIError(w, nethttp.StatusNotFound, "PODCAST_NOT_FOUND", "Podcast was not found")
		case errors.Is(err, podcasts.ErrFeedFetchFailed):
			r.writeAPIError(w, nethttp.StatusBadRequest, "FEED_FETCH_FAILED", "Failed to fetch feed")
		case errors.Is(err, podcasts.ErrFeedParseFailed):
			r.writeAPIError(w, nethttp.StatusBadRequest, "FEED_PARSE_FAILED", "Feed could not be parsed")
		case errors.Is(err, podcasts.ErrRefreshAlreadyRunning):
			r.writeAPIError(w, nethttp.StatusConflict, "REFRESH_ALREADY_RUNNING", "Podcast refresh is already running")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PODCAST_REFRESH_FAILED", "Failed to refresh podcast")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"success":     true,
		"newEpisodes": newEpisodes,
		"lastChecked": checkedAt,
	})
}

func (r *Router) handlePodcastMarkAllListened(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	podcastID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	result, err := r.episodeActions.MarkPodcastListened(req.Context(), podcastID)
	if err != nil {
		switch err {
		case episodes.ErrPodcastNotFound:
			r.writeAPIError(w, nethttp.StatusNotFound, "PODCAST_NOT_FOUND", "Podcast was not found")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PODCAST_MARK_ALL_LISTENED_FAILED", "Failed to mark podcast episodes listened")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"success":        true,
		"markedEpisodes": result.MarkedEpisodes,
	})
}

func (r *Router) handlePodcastEpisodesList(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	podcastID, ok := r.pathInt64(w, req, "id")
	if !ok {
		return
	}

	items, err := r.episodes.ListByPodcast(req.Context(), podcastID)
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "EPISODE_LIST_FAILED", "Failed to load episodes")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"episodes": items,
	})
}

func (r *Router) handleEpisodesList(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	items, err := r.episodes.List(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "EPISODE_LIST_FAILED", "Failed to load episodes")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"episodes": items})
}

func (r *Router) handlePodcastsImportOPML(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	req.Body = nethttp.MaxBytesReader(w, req.Body, maxOPMLMultipartBodyBytes)
	if err := req.ParseMultipartForm(maxOPMLMultipartBodyBytes); err != nil {
		var maxBytesErr *nethttp.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			r.writeAPIError(w, nethttp.StatusRequestEntityTooLarge, "OPML_TOO_LARGE", "OPML file is too large")
			return
		}
		r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_MULTIPART", "OPML upload must use multipart/form-data")
		return
	}

	file, header, err := req.FormFile("file")
	if err != nil {
		r.writeAPIError(w, nethttp.StatusBadRequest, "OPML_FILE_REQUIRED", "OPML file is required")
		return
	}
	defer file.Close()
	if header.Size > maxOPMLFileBytes {
		r.writeAPIError(w, nethttp.StatusRequestEntityTooLarge, "OPML_TOO_LARGE", "OPML file is too large")
		return
	}

	result, err := r.podcasts.ImportOPML(req.Context(), file)
	if err != nil {
		switch err {
		case podcasts.ErrInvalidOPML:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_OPML", "OPML file could not be parsed")
		case podcasts.ErrOPMLTooManyFeeds:
			r.writeAPIError(w, nethttp.StatusBadRequest, "OPML_TOO_MANY_FEEDS", "OPML file contains too many podcast feeds")
		case podcasts.ErrOPMLImportAlreadyRunning:
			r.writeAPIError(w, nethttp.StatusConflict, "OPML_IMPORT_ALREADY_RUNNING", "An OPML import is already running")
		default:
			r.logger.Printf("opml import failed: %v", err)
			r.writeAPIError(w, nethttp.StatusInternalServerError, "OPML_IMPORT_FAILED", "Failed to import OPML")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"success":  true,
		"imported": result.Imported,
		"skipped":  result.Skipped,
	})
}

func (r *Router) handlePodcastsExportOPML(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	payload, err := r.podcasts.ExportOPML(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "OPML_EXPORT_FAILED", "Failed to export OPML")
		return
	}

	w.Header().Set("Content-Type", "text/x-opml; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="mpod-subscriptions.opml"`)
	w.WriteHeader(nethttp.StatusOK)
	_, _ = w.Write(payload)
}

func (r *Router) handleJobsStatus(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	status, err := r.scheduler.GetStatus(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "JOBS_STATUS_FAILED", "Failed to load job status")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"scheduler": status})
}

func (r *Router) handlePodcastsRefreshAll(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	if err := r.scheduler.StartRunNow(context.WithoutCancel(req.Context())); err != nil {
		r.logger.Printf("podcasts refresh all failed: %v", err)
		if errors.Is(err, scheduler.ErrAlreadyRunning) || errors.Is(err, podcasts.ErrRefreshAlreadyRunning) {
			r.writeAPIError(w, nethttp.StatusConflict, "REFRESH_ALREADY_RUNNING", "One or more podcast refreshes are already running")
			return
		}
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PODCASTS_REFRESH_ALL_FAILED", "Failed to refresh all podcasts")
		return
	}

	r.writeJSON(w, nethttp.StatusAccepted, map[string]any{"success": true, "state": "running"})
}
