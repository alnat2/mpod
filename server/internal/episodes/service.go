package episodes

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type Service struct {
	db *sql.DB
}

type Episode struct {
	ID          int64      `json:"id"`
	PodcastID   int64      `json:"podcastId"`
	Title       string     `json:"title"`
	Description *string    `json:"description,omitempty"`
	ShowNotes   *string    `json:"showNotes,omitempty"`
	AudioURL    string     `json:"audioUrl"`
	Duration    *int64     `json:"duration"`
	Downloaded  bool       `json:"downloaded"`
	IsListened  bool       `json:"isListened"`
	PublishedAt *time.Time `json:"publishedAt"`
}

func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

func (s *Service) ListByPodcast(ctx context.Context, podcastID int64) ([]Episode, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, podcast_id, title, description, audio_url, duration, downloaded_path, is_listened, published_at
		FROM episodes
		WHERE podcast_id = ?
		ORDER BY published_at DESC, id DESC
	`, podcastID)
	if err != nil {
		return nil, fmt.Errorf("list episodes: %w", err)
	}
	defer rows.Close()

	items := make([]Episode, 0)
	for rows.Next() {
		episode, err := scanEpisode(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, episode)
	}
	return items, rows.Err()
}

func (s *Service) GetByID(ctx context.Context, episodeID int64) (Episode, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, podcast_id, title, description, audio_url, duration, downloaded_path, is_listened, published_at
		FROM episodes
		WHERE id = ?
	`, episodeID)
	return scanEpisode(row)
}

type scanner interface {
	Scan(dest ...any) error
}

func scanEpisode(row scanner) (Episode, error) {
	var item Episode
	var description sql.NullString
	var downloadedPath sql.NullString
	var duration sql.NullInt64
	var publishedAt sql.NullTime

	if err := row.Scan(
		&item.ID,
		&item.PodcastID,
		&item.Title,
		&description,
		&item.AudioURL,
		&duration,
		&downloadedPath,
		&item.IsListened,
		&publishedAt,
	); err != nil {
		return Episode{}, err
	}

	if duration.Valid {
		item.Duration = &duration.Int64
	}
	if description.Valid {
		item.ShowNotes = sanitizeShowNotes(description.String)
		item.Description = item.ShowNotes
	}
	item.Downloaded = downloadedPath.Valid && downloadedPath.String != ""
	if publishedAt.Valid {
		ts := publishedAt.Time.UTC()
		item.PublishedAt = &ts
	}

	return item, nil
}
