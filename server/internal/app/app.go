package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/cross/mpod/server/internal/config"
	httpapi "github.com/cross/mpod/server/internal/http"
	"github.com/cross/mpod/server/internal/pathutil"
	"github.com/cross/mpod/server/internal/scheduler"
	"github.com/cross/mpod/server/internal/smartlistening"
	"github.com/cross/mpod/server/internal/storage"
)

const defaultShutdownTimeout = 10 * time.Second

type App struct {
	config          config.Config
	logger          *log.Logger
	server          *http.Server
	db              io.Closer
	cancel          context.CancelFunc
	scheduler       *scheduler.Service
	smartListening  *smartlistening.Service
	listen          func(network, address string) (net.Listener, error)
	shutdownTimeout time.Duration
	stopOnce        sync.Once
	closeOnce       sync.Once
	closeErr        error
}

func New(logger *log.Logger) (*App, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}
	if cfg.SessionSecret == "change-me" {
		logger.Printf("WARNING: SESSION_SECRET is set to default placeholder 'change-me'. Please change it for secure deployments.")
	}
	if err := storage.EnsureWritableDirectory(cfg.DownloadsDir); err != nil {
		return nil, fmt.Errorf("prepare downloads directory: %w", err)
	}
	db, err := storage.Open(cfg.DBPath)
	if err != nil {
		return nil, err
	}

	if err := storage.Migrate(db.SQL, pathutil.FirstExistingDir("migrations", "server/migrations")); err != nil {
		_ = db.Close()
		return nil, err
	}

	if err := storage.ReconcileDownloads(db.SQL, logger); err != nil {
		_ = db.Close()
		return nil, err
	}

	routerServices, err := httpapi.NewRouterServicesForRuntime(cfg, db.SQL)
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	if _, err := routerServices.Auth.CleanupExpiredSessions(context.Background()); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("cleanup expired sessions: %w", err)
	}
	if err := routerServices.Downloads.CleanupPartialFiles(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("cleanup partial downloads: %w", err)
	}

	// Initial scan of audiobooks
	if err := routerServices.Audiobooks.Rescan(context.Background()); err != nil {
		logger.Printf("initial audiobooks scan: %v", err)
	}

	schedulerService, err := scheduler.NewService(db.SQL, logger, routerServices.Settings, routerServices.Podcasts.RefreshAll, cfg.TZ)
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	runCtx, cancel := context.WithCancel(context.Background())
	schedulerService.Start(runCtx)
	smartListeningService := smartlistening.NewService(db.SQL, logger, routerServices.Downloads)
	smartListeningService.Start(runCtx)

	// Start inotify watcher for audiobooks
	if err := routerServices.Audiobooks.StartWatcher(runCtx); err != nil {
		logger.Printf("start audiobooks watcher: %v", err)
	}

	router := httpapi.NewRouterWithServices(logger, cfg, db.SQL, schedulerService, routerServices)
	server := &http.Server{
		Addr:              fmt.Sprintf(":%s", cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	return &App{
		config:          cfg,
		logger:          logger,
		server:          server,
		db:              db,
		cancel:          cancel,
		scheduler:       schedulerService,
		smartListening:  smartListeningService,
		listen:          net.Listen,
		shutdownTimeout: defaultShutdownTimeout,
	}, nil
}

func (a *App) Run(ctx context.Context) error {
	a.logger.Printf("mpod backend listening on :%s", a.config.Port)

	listener, err := a.listen("tcp", a.server.Addr)
	if err != nil {
		return errors.Join(fmt.Errorf("listen for HTTP requests: %w", err), a.closeResources())
	}

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- a.server.Serve(listener)
	}()

	select {
	case err := <-serveErr:
		return errors.Join(normalizeServeError(err), a.closeResources())
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), a.shutdownTimeout)
		defer cancel()

		shutdownErr := a.Shutdown(shutdownCtx)
		return errors.Join(shutdownErr, normalizeServeError(<-serveErr))
	}
}

func (a *App) Shutdown(ctx context.Context) error {
	a.stopBackground()
	if err := a.server.Shutdown(ctx); err != nil {
		closeErr := a.server.Close()
		return errors.Join(
			fmt.Errorf("gracefully shut down HTTP server: %w", err),
			wrapError("force close HTTP server", closeErr),
			a.closeResources(),
		)
	}
	return a.closeResources()
}

func (a *App) closeResources() error {
	a.closeOnce.Do(func() {
		a.stopBackground()
		if a.db != nil {
			a.closeErr = wrapError("close database", a.db.Close())
		}
	})
	return a.closeErr
}

func (a *App) stopBackground() {
	a.stopOnce.Do(func() {
		if a.cancel != nil {
			a.cancel()
		}
	})
}

func normalizeServeError(err error) error {
	if err == nil || errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return fmt.Errorf("serve HTTP requests: %w", err)
}

func wrapError(operation string, err error) error {
	if err == nil || errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return fmt.Errorf("%s: %w", operation, err)
}
