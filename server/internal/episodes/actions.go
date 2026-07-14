package episodes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/playlist"
)

var ErrEpisodeNotFound = errors.New("episode not found")

type Actions struct {
	db        *sql.DB
	downloads *downloads.Service
	playlist  *playlist.Service
}

func NewActions(db *sql.DB, downloads *downloads.Service) *Actions {
	return &Actions{
		db:        db,
		downloads: downloads,
		playlist:  playlist.NewService(db),
	}
}

func (a *Actions) SetListened(ctx context.Context, episodeID int64, listened bool) error {
	if listened {
		if _, err := a.downloads.Delete(ctx, episodeID); err != nil {
			switch err {
			case downloads.ErrEpisodeNotFound:
				return ErrEpisodeNotFound
			default:
				return fmt.Errorf("delete listened episode download: %w", err)
			}
		}
	}

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
		if _, err := a.db.ExecContext(ctx, `
			UPDATE active_playback
			SET episode_id = NULL, last_updated = CURRENT_TIMESTAMP
			WHERE singleton_id = 1 AND episode_id = ?
		`, episodeID); err != nil {
			return fmt.Errorf("clear active listened episode: %w", err)
		}
		if err := a.playlist.Remove(ctx, episodeID); err != nil {
			return fmt.Errorf("remove listened episode from playlist: %w", err)
		}
	}

	return nil
}
