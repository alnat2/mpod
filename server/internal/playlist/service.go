package playlist

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

var (
	ErrEpisodeNotFound   = errors.New("episode not found")
	ErrAudiobookNotFound = errors.New("audiobook not found")
	ErrInvalidReorder    = errors.New("invalid playlist reorder")
)

type Service struct {
	db  *sql.DB
	now func() time.Time
}

type Episode struct {
	ID         int64  `json:"id"`
	Title      string `json:"title"`
	PodcastID  int64  `json:"podcastId"`
	IsListened bool   `json:"isListened"`
	Downloaded bool   `json:"downloaded"`
}

type AudiobookItem struct {
	ID            int64  `json:"id"`
	Title         string `json:"title"`
	Author        string `json:"author"`
	TrackCount    int    `json:"trackCount"`
	CoverPath     string `json:"coverPath,omitempty"`
	HasCover      bool   `json:"hasCover"`
	TotalDuration int64  `json:"totalDuration"`
}

type Item struct {
	EpisodeID   *int64         `json:"episodeId,omitempty"`
	AudiobookID *int64         `json:"audiobookId,omitempty"`
	Position    int64          `json:"position"`
	Type        string         `json:"type"`
	Episode     *Episode       `json:"episode,omitempty"`
	Audiobook   *AudiobookItem `json:"audiobook,omitempty"`
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db, now: time.Now}
}

func (s *Service) List(ctx context.Context) ([]Item, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT playlist.position, playlist.episode_id, playlist.audiobook_id,
		       episodes.id, episodes.title, episodes.podcast_id, episodes.is_listened, episodes.downloaded_path,
		       audiobooks.id, audiobooks.title, COALESCE(audiobooks.author, ''), COALESCE(audiobooks.cover_path, ''), audiobooks.total_duration,
		       (SELECT COUNT(*) FROM audiobook_tracks WHERE audiobook_id = audiobooks.id)
		FROM playlist
		LEFT JOIN episodes ON episodes.id = playlist.episode_id
		LEFT JOIN audiobooks ON audiobooks.id = playlist.audiobook_id
		ORDER BY playlist.position ASC, playlist.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list playlist: %w", err)
	}
	defer rows.Close()

	items := make([]Item, 0)
	for rows.Next() {
		var item Item
		var epID, abID sql.NullInt64
		var epRowID, epPodcastID sql.NullInt64
		var epTitle sql.NullString
		var epIsListened sql.NullBool
		var downloadedPath sql.NullString
		var abRowID, abTotalDuration sql.NullInt64
		var abTitle, abAuthor, abCoverPath sql.NullString
		var abTrackCount sql.NullInt64

		if err := rows.Scan(
			&item.Position,
			&epID,
			&abID,
			&epRowID,
			&epTitle,
			&epPodcastID,
			&epIsListened,
			&downloadedPath,
			&abRowID,
			&abTitle,
			&abAuthor,
			&abCoverPath,
			&abTotalDuration,
			&abTrackCount,
		); err != nil {
			return nil, fmt.Errorf("scan playlist item: %w", err)
		}

		if epID.Valid {
			idVal := epID.Int64
			item.EpisodeID = &idVal
			item.Type = "episode"
			item.Episode = &Episode{
				ID:         epRowID.Int64,
				Title:      epTitle.String,
				PodcastID:  epPodcastID.Int64,
				IsListened: epIsListened.Bool,
				Downloaded: downloadedPath.Valid && downloadedPath.String != "",
			}
		} else if abID.Valid {
			idVal := abID.Int64
			item.AudiobookID = &idVal
			item.Type = "audiobook"
			item.Audiobook = &AudiobookItem{
				ID:            abRowID.Int64,
				Title:         abTitle.String,
				Author:        abAuthor.String,
				TrackCount:    int(abTrackCount.Int64),
				CoverPath:     abCoverPath.String,
				HasCover:      abCoverPath.String != "",
				TotalDuration: abTotalDuration.Int64,
			}
		}

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

	addedAt := s.now().UTC()
	downloadAfter := addedAt.Add(15 * time.Second)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO playlist (episode_id, position, added_at, download_after)
		VALUES (?, ?, ?, ?)
	`, episodeID, nextPosition, addedAt, downloadAfter); err != nil {
		return fmt.Errorf("insert playlist item: %w", err)
	}

	return tx.Commit()
}

func (s *Service) AddAudiobook(ctx context.Context, audiobookID int64) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin playlist add audiobook tx: %w", err)
	}
	defer tx.Rollback()

	var bookExists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM audiobooks WHERE id = ?`, audiobookID).Scan(&bookExists); err != nil {
		return fmt.Errorf("check audiobook exists: %w", err)
	}
	if bookExists == 0 {
		return ErrAudiobookNotFound
	}

	var existing int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM playlist WHERE audiobook_id = ?`, audiobookID).Scan(&existing); err != nil {
		return fmt.Errorf("check playlist item exists: %w", err)
	}
	if existing > 0 {
		return tx.Commit()
	}

	var nextPosition int64 = 1
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(position), 0) + 1 FROM playlist`).Scan(&nextPosition); err != nil {
		return fmt.Errorf("load next playlist position: %w", err)
	}

	addedAt := s.now().UTC()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO playlist (audiobook_id, position, added_at)
		VALUES (?, ?, ?)
	`, audiobookID, nextPosition, addedAt); err != nil {
		return fmt.Errorf("insert playlist audiobook item: %w", err)
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

func (s *Service) RemoveAudiobook(ctx context.Context, audiobookID int64) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM playlist WHERE audiobook_id = ?`, audiobookID); err != nil {
		return fmt.Errorf("delete playlist audiobook item: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, `
		UPDATE active_playback
		SET audiobook_id = NULL, audiobook_track_id = NULL, last_updated = ?
		WHERE singleton_id = 1 AND audiobook_id = ?
	`, time.Now().UTC(), audiobookID); err != nil {
		return fmt.Errorf("clear active playback audiobook: %w", err)
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
		if item.EpisodeID != nil {
			currentSet[*item.EpisodeID] = struct{}{}
		}
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
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM playlist ORDER BY position ASC, id ASC`)
	if err != nil {
		return fmt.Errorf("load playlist for normalization: %w", err)
	}
	defer rows.Close()

	var itemIDs []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan playlist normalization row: %w", err)
		}
		itemIDs = append(itemIDs, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(itemIDs) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin normalize positions tx: %w", err)
	}
	defer tx.Rollback()

	for i, id := range itemIDs {
		if _, err := tx.ExecContext(ctx, `UPDATE playlist SET position = ? WHERE id = ?`, i+1, id); err != nil {
			return fmt.Errorf("update playlist item position: %w", err)
		}
	}

	return tx.Commit()
}
