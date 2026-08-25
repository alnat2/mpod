package http

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
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

	"github.com/cross/mpod/server/internal/audiobooks"
	"github.com/cross/mpod/server/internal/auth"
	"github.com/cross/mpod/server/internal/config"
	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/episodes"
	"github.com/cross/mpod/server/internal/pathutil"
	"github.com/cross/mpod/server/internal/playback"
	"github.com/cross/mpod/server/internal/playlist"
	"github.com/cross/mpod/server/internal/podcasts"
	"github.com/cross/mpod/server/internal/remote"
	"github.com/cross/mpod/server/internal/scheduler"
	"github.com/cross/mpod/server/internal/settings"
)

const (
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
	audiobooks        *audiobooks.Service
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
	Audiobooks        *audiobooks.Service
	RemoteClient      *nethttp.Client
	AudioClient       *nethttp.Client
	DirectAudioClient *nethttp.Client
	Settings          *settings.Service
}

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
	audiobooksService := audiobooks.NewService(db, cfg.AudiobooksDir)

	return &RouterServices{
		Auth:              auth.NewService(db),
		Episodes:          episodes.NewService(db),
		EpisodeActions:    episodeActions,
		Playback:          playback.NewService(db, episodeActions, playlistService),
		Playlist:          playlistService,
		PlaylistActions:   playlist.NewActions(db, downloadsService),
		Downloads:         downloadsService,
		Podcasts:          podcasts.NewService(db, client),
		Audiobooks:        audiobooksService,
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
		audiobooks:        services.Audiobooks,
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

	// Audiobook routes
	mux.HandleFunc("GET /api/audiobooks", r.handleAudiobooksList)
	mux.HandleFunc("GET /api/audiobooks/{id}", r.handleAudiobookGet)
	mux.HandleFunc("GET /api/audiobooks/{id}/cover", r.handleAudiobookCover)
	mux.HandleFunc("POST /api/audiobooks/rescan", r.handleAudiobooksRescan)
	mux.HandleFunc("DELETE /api/audiobooks/{id}", r.handleAudiobookDelete)
	mux.HandleFunc("GET /api/audiobooks/{id}/tracks/{trackId}/audio", r.handleAudiobookTrackAudio)
	mux.HandleFunc("POST /api/audiobooks/{id}/playlist", r.handleAudiobookPlaylistAdd)
	mux.HandleFunc("DELETE /api/audiobooks/{id}/playlist", r.handleAudiobookPlaylistRemove)
	mux.HandleFunc("POST /api/audiobooks/playback", r.handleAudiobookPlaybackPost)

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

	return r.securityHeaders(r.recoverAndLog(r.requireSameOrigin(mux)))
}

func (r *Router) handleHealth(w nethttp.ResponseWriter, req *nethttp.Request) {
	r.writeJSON(w, nethttp.StatusOK, map[string]any{"ok": true})
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
