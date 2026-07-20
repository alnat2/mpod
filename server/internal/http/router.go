package http

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	nethttp "net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/cross/mpod/server/internal/auth"
	"github.com/cross/mpod/server/internal/config"
	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/episodes"
	"github.com/cross/mpod/server/internal/media"
	"github.com/cross/mpod/server/internal/pathutil"
	"github.com/cross/mpod/server/internal/playback"
	"github.com/cross/mpod/server/internal/playlist"
	"github.com/cross/mpod/server/internal/podcasts"
	"github.com/cross/mpod/server/internal/remote"
	"github.com/cross/mpod/server/internal/scheduler"
	"github.com/cross/mpod/server/internal/settings"
)

const (
	audioProxyUserAgent       = "mpod/1.0 (+self-hosted podcast client)"
	audioProxyAccept          = "audio/*, application/octet-stream;q=0.9, */*;q=0.1"
	maxJSONBodyBytes          = 1 << 20
	maxOPMLFileBytes          = 5_000_000
	maxOPMLMultipartBodyBytes = maxOPMLFileBytes + (1 << 20)
)

type Router struct {
	logger            *log.Logger
	config            config.Config
	db                *sql.DB
	auth              *auth.Service
	episodes          *episodes.Service
	episodeActions    *episodes.Actions
	playback          *playback.Service
	playlist          *playlist.Service
	playlistActions   *playlist.Actions
	downloads         *downloads.Service
	podcasts          *podcasts.Service
	remoteClient      *nethttp.Client
	audioClient       *nethttp.Client
	directAudioClient *nethttp.Client
	settings          *settings.Service
	scheduler         *scheduler.Service
}

type RouterServices struct {
	Auth              *auth.Service
	Episodes          *episodes.Service
	EpisodeActions    *episodes.Actions
	Playback          *playback.Service
	Playlist          *playlist.Service
	PlaylistActions   *playlist.Actions
	Downloads         *downloads.Service
	Podcasts          *podcasts.Service
	RemoteClient      *nethttp.Client
	AudioClient       *nethttp.Client
	DirectAudioClient *nethttp.Client
	Settings          *settings.Service
}

var (
	errRemoteAudioLoad        = errors.New("remote audio load failed")
	errRemoteAudioNotPlayable = errors.New("remote audio not playable")
)

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type errorResponse struct {
	Error apiError `json:"error"`
}

type trackedResponseWriter struct {
	nethttp.ResponseWriter
	wroteHeader bool
}

func (w *trackedResponseWriter) WriteHeader(statusCode int) {
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *trackedResponseWriter) Write(p []byte) (int, error) {
	if !w.wroteHeader {
		w.wroteHeader = true
	}
	return w.ResponseWriter.Write(p)
}

func (w *trackedResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(nethttp.Flusher); ok {
		flusher.Flush()
	}
}

func (w *trackedResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(nethttp.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("response writer does not support hijacking")
	}
	return hijacker.Hijack()
}

func (w *trackedResponseWriter) Push(target string, opts *nethttp.PushOptions) error {
	if pusher, ok := w.ResponseWriter.(nethttp.Pusher); ok {
		return pusher.Push(target, opts)
	}
	return nethttp.ErrNotSupported
}

func (w *trackedResponseWriter) Unwrap() nethttp.ResponseWriter {
	return w.ResponseWriter
}

func NewRouterServicesForRuntime(cfg config.Config, db *sql.DB) (*RouterServices, error) {
	settingsService := settings.NewService(db, cfg.SOCKS5Host != "", cfg.AppBuild)
	proxyEnabled := func(ctx context.Context) bool {
		enabled, err := settingsService.ProxyEnabled(ctx)
		return err == nil && enabled
	}
	client, err := remote.NewHTTPClientWithProxyDecider(cfg, proxyEnabled)
	if err != nil {
		return nil, err
	}
	audioClient, err := remote.NewStreamingHTTPClientWithProxyDecider(cfg, proxyEnabled)
	if err != nil {
		return nil, err
	}
	directAudioCfg := cfg
	directAudioCfg.SOCKS5Host = ""
	directAudioCfg.SOCKS5Port = ""
	directAudioCfg.SOCKS5Username = ""
	directAudioCfg.SOCKS5Password = ""
	directAudioClient, err := remote.NewStreamingHTTPClientWithProxyDecider(directAudioCfg, nil)
	if err != nil {
		return nil, err
	}
	settingsService = settings.NewServiceWithProxyStatusLookup(db, cfg.SOCKS5Host != "", cfg.AppBuild, func(ctx context.Context) (settings.ProxyLookupResult, error) {
		return fetchObservedProxyStatus(ctx, client)
	})

	playlistService := playlist.NewService(db)
	downloadsService := downloads.NewService(db, client, cfg.DownloadsDir)
	episodeActions := episodes.NewActions(db, downloadsService)

	return &RouterServices{
		Auth:              auth.NewService(db),
		Episodes:          episodes.NewService(db),
		EpisodeActions:    episodeActions,
		Playback:          playback.NewService(db, episodeActions, playlistService),
		Playlist:          playlistService,
		PlaylistActions:   playlist.NewActions(db, downloadsService),
		Downloads:         downloadsService,
		Podcasts:          podcasts.NewService(db, client),
		RemoteClient:      client,
		AudioClient:       audioClient,
		DirectAudioClient: directAudioClient,
		Settings:          settingsService,
	}, nil
}

func NewRouter(logger *log.Logger, cfg config.Config, db *sql.DB, schedulerService *scheduler.Service) (nethttp.Handler, error) {
	services, err := NewRouterServicesForRuntime(cfg, db)
	if err != nil {
		return nil, err
	}
	return NewRouterWithServices(logger, cfg, db, schedulerService, services), nil
}

func NewRouterWithServices(logger *log.Logger, cfg config.Config, db *sql.DB, schedulerService *scheduler.Service, services *RouterServices) nethttp.Handler {
	r := &Router{
		logger:            logger,
		config:            cfg,
		db:                db,
		auth:              services.Auth,
		episodes:          services.Episodes,
		episodeActions:    services.EpisodeActions,
		playback:          services.Playback,
		playlist:          services.Playlist,
		playlistActions:   services.PlaylistActions,
		downloads:         services.Downloads,
		podcasts:          services.Podcasts,
		remoteClient:      services.RemoteClient,
		audioClient:       services.AudioClient,
		directAudioClient: services.DirectAudioClient,
		settings:          services.Settings,
		scheduler:         schedulerService,
	}
	if r.directAudioClient == nil {
		r.directAudioClient = r.audioClient
	}

	mux := nethttp.NewServeMux()
	mux.HandleFunc("GET /api/health", r.handleHealth)
	mux.HandleFunc("GET /api/auth/session", r.handleSession)
	mux.HandleFunc("POST /api/auth/register", r.handleRegister)
	mux.HandleFunc("POST /api/auth/login", r.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", r.handleLogout)
	mux.HandleFunc("GET /api/podcasts", r.handlePodcastsList)
	mux.HandleFunc("POST /api/podcasts", r.handlePodcastsCreate)
	mux.HandleFunc("GET /api/podcasts/{id}", r.handlePodcastGet)
	mux.HandleFunc("GET /api/podcasts/{id}/image", r.handlePodcastImage)
	mux.HandleFunc("DELETE /api/podcasts/{id}", r.handlePodcastDelete)
	mux.HandleFunc("POST /api/podcasts/{id}/refresh", r.handlePodcastRefresh)
	mux.HandleFunc("POST /api/podcasts/{id}/mark-all-listened", r.handlePodcastMarkAllListened)
	mux.HandleFunc("GET /api/podcasts/{id}/episodes", r.handlePodcastEpisodesList)
	mux.HandleFunc("POST /api/podcasts/import-opml", r.handlePodcastsImportOPML)
	mux.HandleFunc("GET /api/podcasts/export-opml", r.handlePodcastsExportOPML)
	mux.HandleFunc("POST /api/podcasts/refresh-all", r.handlePodcastsRefreshAll)
	mux.HandleFunc("GET /api/jobs/status", r.handleJobsStatus)
	mux.HandleFunc("GET /api/playback/queue", r.handlePlaybackQueue)
	mux.HandleFunc("PUT /api/playback/active", r.handlePlaybackActivePut)
	mux.HandleFunc("GET /api/playback/{episodeId}", r.handlePlaybackGet)
	mux.HandleFunc("POST /api/playback", r.handlePlaybackPost)
	mux.HandleFunc("GET /api/playlist", r.handlePlaylistList)
	mux.HandleFunc("POST /api/playlist", r.handlePlaylistAdd)
	mux.HandleFunc("DELETE /api/playlist/{episodeId}", r.handlePlaylistRemove)
	mux.HandleFunc("PATCH /api/playlist/reorder", r.handlePlaylistReorder)
	mux.HandleFunc("GET /api/episodes", r.handleEpisodesList)
	mux.HandleFunc("GET /api/episodes/{id}", r.handleEpisodeGet)
	mux.HandleFunc("PATCH /api/episodes/{id}", r.handleEpisodePatch)
	mux.HandleFunc("POST /api/episodes/{id}/download", r.handleEpisodeDownload)
	mux.HandleFunc("DELETE /api/episodes/{id}/download", r.handleEpisodeDownloadDelete)
	mux.HandleFunc("GET /api/settings", r.handleSettingsGet)
	mux.HandleFunc("PATCH /api/settings", r.handleSettingsPatch)
	mux.HandleFunc("GET /api/proxy/status", r.handleProxyStatus)
	mux.HandleFunc("GET /api/episodes/{id}/audio", r.handleEpisodeAudio)

	staticDir := pathutil.FirstExistingDir("frontend/dist", "../frontend/dist")
	fs := nethttp.FileServer(nethttp.Dir(staticDir))
	mux.Handle("/", nethttp.HandlerFunc(func(w nethttp.ResponseWriter, req *nethttp.Request) {
		cleanPath := filepath.Clean(strings.TrimPrefix(req.URL.Path, "/"))
		if cleanPath != "." {
			if _, err := os.Stat(filepath.Join(staticDir, cleanPath)); err == nil {
				fs.ServeHTTP(w, req)
				return
			}
		}
		nethttp.ServeFile(w, req, filepath.Join(staticDir, "index.html"))
	}))

	return r.recoverAndLog(mux)
}

func (r *Router) handleHealth(w nethttp.ResponseWriter, req *nethttp.Request) {
	r.writeJSON(w, nethttp.StatusOK, map[string]any{"ok": true})
}

func (r *Router) handleSession(w nethttp.ResponseWriter, req *nethttp.Request) {
	count, err := r.auth.UserCount(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "SESSION_CHECK_FAILED", "Failed to load session state")
		return
	}

	user, err := r.auth.CurrentUser(req.Context(), auth.SessionIDFromRequest(req, r.config.SessionSecret))
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "SESSION_CHECK_FAILED", "Failed to load session state")
		return
	}

	authenticated := user != nil
	var payloadUser any
	if authenticated {
		payloadUser = user
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"authenticated": authenticated,
		"user":          payloadUser,
		"setupRequired": count == 0,
	})
}

func (r *Router) handleRegister(w nethttp.ResponseWriter, req *nethttp.Request) {
	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if !r.decodeJSON(w, req, &payload) {
		return
	}

	user, sessionID, err := r.auth.RegisterInitial(req.Context(), payload.Username, payload.Password)
	if err != nil {
		switch err {
		case auth.ErrInvalidRegistration:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_REGISTRATION", "Username and password are required")
		case auth.ErrSetupDisabled:
			r.writeAPIError(w, nethttp.StatusBadRequest, "SETUP_ALREADY_COMPLETE", "Initial registration is no longer available")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "REGISTER_FAILED", "Failed to create initial user")
		}
		return
	}

	auth.SetSessionCookie(w, sessionID, r.config.SessionSecret, auth.SessionCookieSecure(req))
	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"user": user,
	})
}

func (r *Router) handleLogin(w nethttp.ResponseWriter, req *nethttp.Request) {
	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if !r.decodeJSON(w, req, &payload) {
		return
	}

	user, sessionID, err := r.auth.Login(req.Context(), payload.Username, payload.Password)
	if err != nil {
		switch err {
		case auth.ErrInvalidCredentials:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_CREDENTIALS", "Username or password is incorrect")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "LOGIN_FAILED", "Failed to log in")
		}
		return
	}

	auth.SetSessionCookie(w, sessionID, r.config.SessionSecret, auth.SessionCookieSecure(req))
	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"user": user,
	})
}

func (r *Router) handleLogout(w nethttp.ResponseWriter, req *nethttp.Request) {
	if err := r.auth.Logout(req.Context(), auth.SessionIDFromRequest(req, r.config.SessionSecret)); err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "LOGOUT_FAILED", "Failed to log out")
		return
	}

	auth.ClearSessionCookie(w, auth.SessionCookieSecure(req))
	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"success": true,
	})
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

func (r *Router) handlePodcastImage(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	podcastID, ok := r.pathInt64(w, req, "id")
	if !ok {
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

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=604800")
	if resp.ContentLength > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(resp.ContentLength, 10))
	}
	if _, err := io.Copy(w, resp.Body); err != nil {
		r.logger.Printf("copy podcast image failed: %v", err)
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

func (r *Router) handlePlaybackGet(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	episodeID, ok := r.pathInt64(w, req, "episodeId")
	if !ok {
		return
	}

	state, err := r.playback.Get(req.Context(), episodeID)
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
		EpisodeID int64 `json:"episodeId"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}

	active, err := r.playback.SetActive(req.Context(), payload.EpisodeID)
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
		EpisodeID       int64  `json:"episodeId"`
		PositionSeconds int64  `json:"positionSeconds"`
		DurationSeconds int64  `json:"durationSeconds"`
		Completed       bool   `json:"completed"`
		DidSeek         bool   `json:"didSeek"`
		ClientUpdatedAt string `json:"clientUpdatedAt"`
	}
	if !r.decodeJSON(w, req, &payload) {
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
		EpisodeID:       payload.EpisodeID,
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
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYBACK_UPDATE_FAILED", "Failed to update playback")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, result)
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
		EpisodeID int64 `json:"episodeId"`
	}
	if !r.decodeJSON(w, req, &payload) {
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
		EpisodeIDs []int64 `json:"episodeIds"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}

	if err := r.playlist.Reorder(req.Context(), payload.EpisodeIDs); err != nil {
		switch err {
		case playlist.ErrInvalidReorder:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_PLAYLIST_ORDER", "episodeIds must match the full playlist contents")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "PLAYLIST_REORDER_FAILED", "Failed to reorder playlist")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{"success": true})
}

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
		if err == sql.ErrNoRows {
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
	if _, err := io.Copy(w, io.MultiReader(bytes.NewReader(audioResp.prefix), resp.Body)); err != nil {
		r.logger.Printf("copy episode audio failed: %v", err)
	}
}

type remoteEpisodeAudio struct {
	response    *nethttp.Response
	prefix      []byte
	contentType string
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
	}, nil
}

func (r *Router) shouldRetryAudioDirect(ctx context.Context) bool {
	if r.directAudioClient == nil || r.directAudioClient == r.audioClient || r.settings == nil || r.config.SOCKS5Host == "" {
		return false
	}
	enabled, err := r.settings.ProxyEnabled(ctx)
	return err == nil && enabled
}

func (r *Router) handleSettingsGet(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	values, err := r.settings.Get(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "SETTINGS_LOAD_FAILED", "Failed to load settings")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"settings": values,
	})
}

func (r *Router) handleSettingsPatch(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	var payload struct {
		DailyRefreshTime *string `json:"dailyRefreshTime"`
		PlaybackSpeed    *string `json:"playbackSpeed"`
		ProxyEnabled     *bool   `json:"proxyEnabled"`
	}
	if !r.decodeJSON(w, req, &payload) {
		return
	}

	values, err := r.settings.Update(req.Context(), settings.UpdateInput{
		DailyRefreshTime: payload.DailyRefreshTime,
		PlaybackSpeed:    payload.PlaybackSpeed,
		ProxyEnabled:     payload.ProxyEnabled,
	})
	if err != nil {
		switch err {
		case settings.ErrInvalidSettingsUpdate:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_SETTINGS", "At least one settings field must be provided")
		case settings.ErrInvalidDailyRefreshTime:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_SETTINGS", "dailyRefreshTime must use HH:MM format")
		case settings.ErrInvalidPlaybackSpeed:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_SETTINGS", "playbackSpeed must use an approved speed label")
		case settings.ErrProxyNotConfigured:
			r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_SETTINGS", "Proxy cannot be enabled without runtime configuration")
		default:
			r.writeAPIError(w, nethttp.StatusInternalServerError, "SETTINGS_UPDATE_FAILED", "Failed to update settings")
		}
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"settings": values,
	})
}

func (r *Router) handleProxyStatus(w nethttp.ResponseWriter, req *nethttp.Request) {
	if _, ok := r.requireUser(w, req); !ok {
		return
	}

	status, err := r.settings.GetProxyStatus(req.Context())
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "PROXY_STATUS_FAILED", "Failed to load proxy status")
		return
	}

	r.writeJSON(w, nethttp.StatusOK, map[string]any{
		"proxy": status,
	})
}

func (r *Router) notImplemented(code string) nethttp.HandlerFunc {
	return func(w nethttp.ResponseWriter, req *nethttp.Request) {
		r.writeAPIError(w, nethttp.StatusNotImplemented, code, "Endpoint scaffolded but not implemented yet")
	}
}

func (r *Router) recoverAndLog(next nethttp.Handler) nethttp.Handler {
	return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, req *nethttp.Request) {
		trackedWriter := &trackedResponseWriter{ResponseWriter: w}
		start := time.Now()
		defer func() {
			if rec := recover(); rec != nil {
				r.logger.Printf("panic: %v", rec)
				if !trackedWriter.wroteHeader {
					r.writeAPIError(trackedWriter, nethttp.StatusInternalServerError, "INTERNAL_ERROR", "Internal server error")
				}
			}
			r.logger.Printf("%s %s %s", req.Method, req.URL.Path, time.Since(start))
		}()
		next.ServeHTTP(trackedWriter, req)
	})
}

func (r *Router) requireUser(w nethttp.ResponseWriter, req *nethttp.Request) (*auth.User, bool) {
	user, err := r.auth.CurrentUser(req.Context(), auth.SessionIDFromRequest(req, r.config.SessionSecret))
	if err != nil {
		r.writeAPIError(w, nethttp.StatusInternalServerError, "AUTH_CHECK_FAILED", "Failed to load current session")
		return nil, false
	}
	if user == nil {
		r.writeAPIError(w, nethttp.StatusUnauthorized, "UNAUTHORIZED", "Authentication is required")
		return nil, false
	}
	return user, true
}

func (r *Router) pathInt64(w nethttp.ResponseWriter, req *nethttp.Request, key string) (int64, bool) {
	raw := req.PathValue(key)
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_PATH_PARAM", "Path parameter must be a positive integer")
		return 0, false
	}
	return value, true
}

func (r *Router) decodeJSON(w nethttp.ResponseWriter, req *nethttp.Request, dest any) bool {
	req.Body = nethttp.MaxBytesReader(w, req.Body, maxJSONBodyBytes)
	decoder := json.NewDecoder(req.Body)
	if err := decoder.Decode(dest); err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			r.writeAPIError(w, nethttp.StatusRequestEntityTooLarge, "REQUEST_TOO_LARGE", "Request body is too large")
			return false
		}
		r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_JSON", "Request body must be valid JSON")
		return false
	}

	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		r.writeAPIError(w, nethttp.StatusBadRequest, "INVALID_JSON", "Request body must be valid JSON")
		return false
	}

	return true
}

func (r *Router) writeJSON(w nethttp.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (r *Router) writeAPIError(w nethttp.ResponseWriter, status int, code, message string) {
	r.writeJSON(w, status, errorResponse{
		Error: apiError{
			Code:    code,
			Message: message,
		},
	})
}

func fetchObservedProxyStatus(ctx context.Context, client *nethttp.Client) (settings.ProxyLookupResult, error) {
	req, err := nethttp.NewRequestWithContext(ctx, nethttp.MethodGet, "https://ipwho.is/", nil)
	if err != nil {
		return settings.ProxyLookupResult{}, fmt.Errorf("build proxy status request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return settings.ProxyLookupResult{}, fmt.Errorf("request proxy status: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != nethttp.StatusOK {
		return settings.ProxyLookupResult{}, fmt.Errorf("request proxy status: unexpected status %d", resp.StatusCode)
	}

	var payload struct {
		Success bool   `json:"success"`
		IP      string `json:"ip"`
		Country string `json:"country"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return settings.ProxyLookupResult{}, fmt.Errorf("decode proxy status: %w", err)
	}
	if !payload.Success {
		if strings.TrimSpace(payload.Message) != "" {
			return settings.ProxyLookupResult{}, fmt.Errorf("request proxy status: %s", strings.TrimSpace(payload.Message))
		}
		return settings.ProxyLookupResult{}, fmt.Errorf("request proxy status: external identity lookup failed")
	}

	return settings.ProxyLookupResult{
		ExternalIP: payload.IP,
		Country:    payload.Country,
	}, nil
}
