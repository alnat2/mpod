package episodes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/cross/mpod/server/internal/downloads"
)

var ErrEpisodeNotFound = errors.New("episode not found")

type Actions struct {
	db        *sql.DB
	downloads *downloads.Service
}

func NewActions(db *sql.DB, downloads *downloads.Service) *Actions {
	return &Actions{
		db:        db,
		downloads: downloads,
	}
}

func (a *Actions) SetListened(ctx context.Context, episodeID int64, listened bool) error {
	result, err := a.db.ExecContext(ctx, `UPDATE episodes SET is_listened = ? WHERE id = ?`, listened, episodeID)
	if err != nil {
		return fmt.Errorf("update listened state: %w", err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check listened update rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return ErrEpisodeNotFound
	}

	if listened {
		if _, err := a.downloads.Delete(ctx, episodeID); err != nil && err != downloads.ErrEpisodeNotFound {
			return fmt.Errorf("delete listened episode download: %w", err)
		}
	}

	return nil
}
