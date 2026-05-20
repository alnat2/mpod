package app

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/cross/mpod/server/internal/config"
	httpapi "github.com/cross/mpod/server/internal/http"
	"github.com/cross/mpod/server/internal/podcasts"
	"github.com/cross/mpod/server/internal/remote"
	"github.com/cross/mpod/server/internal/scheduler"
	"github.com/cross/mpod/server/internal/settings"
	"github.com/cross/mpod/server/internal/storage"
)

type App struct {
	config    config.Config
	logger    *log.Logger
	server    *http.Server
	db        *storage.DB
	cancel    context.CancelFunc
	scheduler *scheduler.Service
}

func New(logger *log.Logger) (*App, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, err
	}

	db, err := storage.Open(cfg.DBPath)
	if err != nil {
		return nil, err
	}

	if err := storage.Migrate(db.SQL, "migrations"); err != nil {
		_ = db.Close()
		return nil, err
	}

	if err := storage.ReconcileDownloads(db.SQL, logger); err != nil {
		_ = db.Close()
		return nil, err
	}

	settingsService := settings.NewService(db.SQL, cfg.SOCKS5Host != "")
	client, err := remote.NewHTTPClientWithProxyDecider(cfg, func(ctx context.Context) bool {
		enabled, err := settingsService.ProxyEnabled(ctx)
		return err == nil && enabled
	})
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	podcastService := podcasts.NewService(db.SQL, client)
	schedulerService := scheduler.NewService(db.SQL, logger, settingsService, podcastService.RefreshAll)
	runCtx, cancel := context.WithCancel(context.Background())
	schedulerService.Start(runCtx)

	router := httpapi.NewRouter(logger, cfg, db.SQL, schedulerService)
	server := &http.Server{
		Addr:              fmt.Sprintf(":%s", cfg.Port),
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	return &App{
		config:    cfg,
		logger:    logger,
		server:    server,
		db:        db,
		cancel:    cancel,
		scheduler: schedulerService,
	}, nil
}

func (a *App) Run() error {
	a.logger.Printf("mpod backend listening on :%s", a.config.Port)
	defer func() {
		a.cancel()
		_ = a.db.Close()
	}()
	return a.server.ListenAndServe()
}

func (a *App) Shutdown(ctx context.Context) error {
	a.cancel()
	if err := a.server.Shutdown(ctx); err != nil {
		return err
	}
	return a.db.Close()
}
