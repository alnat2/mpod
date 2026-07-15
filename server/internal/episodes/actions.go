package episodes

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"

	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/playlist"
)

var (
	ErrEpisodeNotFound = errors.New("episode not found")
	ErrPodcastNotFound = errors.New("podcast not found")
)

type MarkPodcastListenedResult struct {
	MarkedEpisodes int64 `json:"markedEpisodes"`
}

type Actions struct {
	db                                *sql.DB
	downloads                         *downloads.Service
	playlist                          *playlist.Service
	afterMarkPodcastDownloadPathsLoad func()
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

func (a *Actions) MarkPodcastListened(ctx context.Context, podcastID int64) (MarkPodcastListenedResult, error) {
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return MarkPodcastListenedResult{}, fmt.Errorf("begin mark podcast listened tx: %w", err)
	}
	defer tx.Rollback()

	var podcastExists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM podcasts WHERE id = ?`, podcastID).Scan(&podcastExists); err != nil {
		return MarkPodcastListenedResult{}, fmt.Errorf("check podcast exists: %w", err)
	}
	if podcastExists == 0 {
		return MarkPodcastListenedResult{}, ErrPodcastNotFound
	}

	downloadedPaths, err := loadPodcastDownloadedPaths(ctx, tx, podcastID)
	if err != nil {
		return MarkPodcastListenedResult{}, err
	}
	if a.afterMarkPodcastDownloadPathsLoad != nil {
		a.afterMarkPodcastDownloadPathsLoad()
	}

	var markedEpisodes int64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM episodes WHERE podcast_id = ? AND is_listened = 0`, podcastID).Scan(&markedEpisodes); err != nil {
		return MarkPodcastListenedResult{}, fmt.Errorf("count unlistened podcast episodes: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `UPDATE episodes SET is_listened = 1, downloaded_path = NULL WHERE podcast_id = ?`, podcastID); err != nil {
		return MarkPodcastListenedResult{}, fmt.Errorf("mark podcast episodes listened: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM playlist WHERE episode_id IN (SELECT id FROM episodes WHERE podcast_id = ?)`, podcastID); err != nil {
		return MarkPodcastListenedResult{}, fmt.Errorf("remove podcast episodes from playlist: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE active_playback
		SET episode_id = NULL, last_updated = CURRENT_TIMESTAMP
		WHERE singleton_id = 1
		  AND episode_id IN (SELECT id FROM episodes WHERE podcast_id = ?)
	`, podcastID); err != nil {
		return MarkPodcastListenedResult{}, fmt.Errorf("clear active podcast playback: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return MarkPodcastListenedResult{}, fmt.Errorf("commit mark podcast listened tx: %w", err)
	}

	for _, path := range downloadedPaths {
		_ = os.Remove(path)
	}

	return MarkPodcastListenedResult{MarkedEpisodes: markedEpisodes}, nil
}

func loadPodcastDownloadedPaths(ctx context.Context, tx *sql.Tx, podcastID int64) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT downloaded_path
		FROM episodes
		WHERE podcast_id = ?
		  AND downloaded_path IS NOT NULL
		  AND downloaded_path <> ''
	`, podcastID)
	if err != nil {
		return nil, fmt.Errorf("load podcast downloaded paths: %w", err)
	}
	defer rows.Close()

	var paths []string
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return nil, fmt.Errorf("scan podcast downloaded path: %w", err)
		}
		paths = append(paths, path)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate podcast downloaded paths: %w", err)
	}
	return paths, nil
}
