package app

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/cross/mpod/server/internal/config"
	httpapi "github.com/cross/mpod/server/internal/http"
	"github.com/cross/mpod/server/internal/pathutil"
	"github.com/cross/mpod/server/internal/scheduler"
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
	schedulerService, err := scheduler.NewService(db.SQL, logger, routerServices.Settings, routerServices.Podcasts.RefreshAll, cfg.TZ)
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	runCtx, cancel := context.WithCancel(context.Background())
	schedulerService.Start(runCtx)

	router := httpapi.NewRouterWithServices(logger, cfg, db.SQL, schedulerService, routerServices)
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
