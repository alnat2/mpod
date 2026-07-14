package playlist

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

var (
	ErrEpisodeNotFound = errors.New("episode not found")
	ErrInvalidReorder  = errors.New("invalid playlist reorder")
)

type Service struct {
	db *sql.DB
}

type Episode struct {
	ID         int64  `json:"id"`
	Title      string `json:"title"`
	PodcastID  int64  `json:"podcastId"`
	IsListened bool   `json:"isListened"`
	Downloaded bool   `json:"downloaded"`
}

type Item struct {
	EpisodeID int64   `json:"episodeId"`
	Position  int64   `json:"position"`
	Episode   Episode `json:"episode"`
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) List(ctx context.Context) ([]Item, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT playlist.episode_id, playlist.position,
		       episodes.id, episodes.title, episodes.podcast_id, episodes.is_listened, episodes.downloaded_path
		FROM playlist
		JOIN episodes ON episodes.id = playlist.episode_id
		ORDER BY playlist.position ASC, playlist.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list playlist: %w", err)
	}
	defer rows.Close()

	items := make([]Item, 0)
	for rows.Next() {
		var item Item
		var downloadedPath sql.NullString
		if err := rows.Scan(
			&item.EpisodeID,
			&item.Position,
			&item.Episode.ID,
			&item.Episode.Title,
			&item.Episode.PodcastID,
			&item.Episode.IsListened,
			&downloadedPath,
		); err != nil {
			return nil, fmt.Errorf("scan playlist item: %w", err)
		}
		item.Episode.Downloaded = downloadedPath.Valid && downloadedPath.String != ""
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) Add(ctx context.Context, episodeID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin playlist add tx: %w", err)
	}
	defer tx.Rollback()

	var episodeExists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM episodes WHERE id = ?`, episodeID).Scan(&episodeExists); err != nil {
		return fmt.Errorf("check episode exists: %w", err)
	}
	if episodeExists == 0 {
		return ErrEpisodeNotFound
	}

	if _, err := tx.ExecContext(ctx, `UPDATE episodes SET is_listened = 0 WHERE id = ?`, episodeID); err != nil {
		return fmt.Errorf("mark playlist episode unlistened: %w", err)
	}

	var existing int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM playlist WHERE episode_id = ?`, episodeID).Scan(&existing); err != nil {
		return fmt.Errorf("check playlist item exists: %w", err)
	}
	if existing > 0 {
		return tx.Commit()
	}

	var nextPosition int64 = 1
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(position), 0) + 1 FROM playlist`).Scan(&nextPosition); err != nil {
		return fmt.Errorf("load next playlist position: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `INSERT INTO playlist (episode_id, position) VALUES (?, ?)`, episodeID, nextPosition); err != nil {
		return fmt.Errorf("insert playlist item: %w", err)
	}

	return tx.Commit()
}

func (s *Service) Remove(ctx context.Context, episodeID int64) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM playlist WHERE episode_id = ?`, episodeID); err != nil {
		return fmt.Errorf("delete playlist item: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE active_playback
		SET episode_id = NULL, last_updated = ?
		WHERE singleton_id = 1 AND episode_id = ?
	`, time.Now().UTC(), episodeID); err != nil {
		return fmt.Errorf("clear active playback item: %w", err)
	}
	return s.normalizePositions(ctx)
}

func (s *Service) Reorder(ctx context.Context, episodeIDs []int64) error {
	current, err := s.List(ctx)
	if err != nil {
		return err
	}
	if len(current) != len(episodeIDs) {
		return ErrInvalidReorder
	}

	currentSet := make(map[int64]struct{}, len(current))
	for _, item := range current {
		currentSet[item.EpisodeID] = struct{}{}
	}
	for _, id := range episodeIDs {
		if _, ok := currentSet[id]; !ok {
			return ErrInvalidReorder
		}
		delete(currentSet, id)
	}
	if len(currentSet) != 0 {
		return ErrInvalidReorder
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin playlist reorder tx: %w", err)
	}
	defer tx.Rollback()

	for i, id := range episodeIDs {
		if _, err := tx.ExecContext(ctx, `UPDATE playlist SET position = ? WHERE episode_id = ?`, i+1, id); err != nil {
			return fmt.Errorf("update playlist position: %w", err)
		}
	}

	return tx.Commit()
}

func (s *Service) normalizePositions(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `SELECT episode_id FROM playlist ORDER BY position ASC, id ASC`)
	if err != nil {
		return fmt.Errorf("load playlist for normalization: %w", err)
	}
	defer rows.Close()

	var episodeIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan playlist normalization row: %w", err)
		}
		episodeIDs = append(episodeIDs, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(episodeIDs) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return s.Reorder(ctx, episodeIDs)
}
