package playlist

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/cross/mpod/server/internal/downloads"
)

type Actions struct {
	db        *sql.DB
	downloads *downloads.Service
	service   *Service
}

func NewActions(db *sql.DB, downloads *downloads.Service) *Actions {
	return &Actions{
		db:        db,
		downloads: downloads,
		service:   NewService(db),
	}
}

func (a *Actions) Remove(ctx context.Context, episodeID int64) error {
	if _, err := a.downloads.Delete(ctx, episodeID); err != nil && err != downloads.ErrEpisodeNotFound {
		return fmt.Errorf("delete playlist episode download: %w", err)
	}

	if err := a.service.Remove(ctx, episodeID); err != nil {
		return fmt.Errorf("remove playlist item: %w", err)
	}

	return nil
}
