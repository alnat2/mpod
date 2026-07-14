package playback

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/cross/mpod/server/internal/episodes"
	"github.com/cross/mpod/server/internal/playlist"
)

var (
	ErrEpisodeNotFound      = errors.New("episode not found")
	ErrEpisodeNotInPlaylist = errors.New("episode not in playlist")
	ErrInvalidPosition      = errors.New("invalid playback position")
)

type Service struct {
	db             *sql.DB
	episodeActions *episodes.Actions
	playlist       *playlist.Service
	now            func() time.Time
}

type State struct {
	EpisodeID       int64     `json:"episodeId"`
	PositionSeconds int64     `json:"positionSeconds"`
	LastUpdated     time.Time `json:"lastUpdated"`
}

type ActiveState struct {
	EpisodeID   int64     `json:"episodeId"`
	LastUpdated time.Time `json:"lastUpdated"`
}

type QueueEpisode struct {
	episodes.Episode
	PodcastTitle    string  `json:"podcastTitle"`
	PodcastImageURL *string `json:"podcastImageUrl"`
	Playback        *State  `json:"playback"`
}

type UpdateResult struct {
	Playback      State  `json:"playback"`
	NextEpisodeID *int64 `json:"nextEpisodeId"`
}

type UpdateInput struct {
	EpisodeID       int64
	PositionSeconds int64
	DurationSeconds int64
	Completed       bool
	DidSeek         bool
	ClientUpdatedAt *time.Time
}

func NewService(db *sql.DB, episodeActions *episodes.Actions, playlist *playlist.Service) *Service {
	return &Service{
		db:             db,
		episodeActions: episodeActions,
		playlist:       playlist,
		now:            time.Now,
	}
}

func (s *Service) Get(ctx context.Context, episodeID int64) (*State, error) {
	var state State
	err := s.db.QueryRowContext(ctx, `
		SELECT episode_id, position_seconds, last_updated
		FROM playback
		WHERE episode_id = ?
	`, episodeID).Scan(&state.EpisodeID, &state.PositionSeconds, &state.LastUpdated)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load playback state: %w", err)
	}
	state.LastUpdated = state.LastUpdated.UTC()
	return &state, nil
}

func (s *Service) GetActive(ctx context.Context) (*ActiveState, error) {
	var episodeID sql.NullInt64
	var lastUpdated time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT episode_id, last_updated
		FROM active_playback
		WHERE singleton_id = 1
	`).Scan(&episodeID, &lastUpdated)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load active playback: %w", err)
	}
	if !episodeID.Valid {
		return nil, nil
	}

	inPlaylist, err := s.episodeInPlaylist(ctx, episodeID.Int64)
	if err != nil {
		return nil, err
	}
	if !inPlaylist {
		if err := s.ClearActiveIfEpisode(ctx, episodeID.Int64); err != nil {
			return nil, err
		}
		return nil, nil
	}

	return &ActiveState{
		EpisodeID:   episodeID.Int64,
		LastUpdated: lastUpdated.UTC(),
	}, nil
}

func (s *Service) SetActive(ctx context.Context, episodeID int64) (ActiveState, error) {
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM episodes WHERE id = ?`, episodeID).Scan(&exists); err != nil {
		return ActiveState{}, fmt.Errorf("check active episode exists: %w", err)
	}
	if exists == 0 {
		return ActiveState{}, ErrEpisodeNotFound
	}

	inPlaylist, err := s.episodeInPlaylist(ctx, episodeID)
	if err != nil {
		return ActiveState{}, err
	}
	if !inPlaylist {
		return ActiveState{}, ErrEpisodeNotInPlaylist
	}

	now := s.now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO active_playback (singleton_id, episode_id, last_updated)
		VALUES (1, ?, ?)
		ON CONFLICT (singleton_id) DO UPDATE SET
			episode_id = excluded.episode_id,
			last_updated = excluded.last_updated
	`, episodeID, now); err != nil {
		return ActiveState{}, fmt.Errorf("save active playback: %w", err)
	}

	return ActiveState{
		EpisodeID:   episodeID,
		LastUpdated: now,
	}, nil
}

func (s *Service) ClearActiveIfEpisode(ctx context.Context, episodeID int64) error {
	now := s.now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		UPDATE active_playback
		SET episode_id = NULL, last_updated = ?
		WHERE singleton_id = 1 AND episode_id = ?
	`, now, episodeID); err != nil {
		return fmt.Errorf("clear active playback: %w", err)
	}
	return nil
}

func (s *Service) ListQueue(ctx context.Context) ([]QueueEpisode, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT episodes.id, episodes.podcast_id, episodes.title, episodes.description,
		       episodes.audio_url, episodes.duration, episodes.downloaded_path,
		       episodes.is_listened, episodes.published_at,
		       podcasts.title, podcasts.image_url,
		       playback.episode_id, playback.position_seconds, playback.last_updated
		FROM playlist
		JOIN episodes ON episodes.id = playlist.episode_id
		JOIN podcasts ON podcasts.id = episodes.podcast_id
		LEFT JOIN playback ON playback.episode_id = episodes.id
		ORDER BY playlist.position ASC, playlist.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list playback queue: %w", err)
	}
	defer rows.Close()

	items := make([]QueueEpisode, 0)
	for rows.Next() {
		var item QueueEpisode
		var description, downloadedPath, podcastImageURL sql.NullString
		var duration sql.NullInt64
		var publishedAt, playbackUpdatedAt sql.NullTime
		var playbackEpisodeID, playbackPosition sql.NullInt64
		if err := rows.Scan(
			&item.ID,
			&item.PodcastID,
			&item.Title,
			&description,
			&item.AudioURL,
			&duration,
			&downloadedPath,
			&item.IsListened,
			&publishedAt,
			&item.PodcastTitle,
			&podcastImageURL,
			&playbackEpisodeID,
			&playbackPosition,
			&playbackUpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan playback queue: %w", err)
		}

		if description.Valid {
			item.ShowNotes = episodes.SanitizeShowNotes(description.String)
			item.Description = item.ShowNotes
		}
		if duration.Valid {
			item.Duration = &duration.Int64
		}
		item.Downloaded = downloadedPath.Valid && downloadedPath.String != ""
		if publishedAt.Valid {
			timestamp := publishedAt.Time.UTC()
			item.PublishedAt = &timestamp
		}
		if podcastImageURL.Valid {
			imagePath := fmt.Sprintf("/api/podcasts/%d/image", item.PodcastID)
			item.PodcastImageURL = &imagePath
		}
		if playbackEpisodeID.Valid {
			item.Playback = &State{
				EpisodeID:       playbackEpisodeID.Int64,
				PositionSeconds: playbackPosition.Int64,
				LastUpdated:     playbackUpdatedAt.Time.UTC(),
			}
		}

		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Service) episodeInPlaylist(ctx context.Context, episodeID int64) (bool, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM playlist WHERE episode_id = ?`, episodeID).Scan(&count); err != nil {
		return false, fmt.Errorf("check active episode playlist state: %w", err)
	}
	return count > 0, nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (UpdateResult, error) {
	if input.PositionSeconds < 0 {
		return UpdateResult{}, ErrInvalidPosition
	}

	var episodeExists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM episodes WHERE id = ?`, input.EpisodeID).Scan(&episodeExists); err != nil {
		return UpdateResult{}, fmt.Errorf("check episode exists: %w", err)
	}
	if episodeExists == 0 {
		return UpdateResult{}, ErrEpisodeNotFound
	}

	current, err := s.Get(ctx, input.EpisodeID)
	if err != nil {
		return UpdateResult{}, err
	}

	if current != nil && input.ClientUpdatedAt != nil && input.ClientUpdatedAt.UTC().Before(current.LastUpdated) {
		return UpdateResult{Playback: *current}, nil
	}

	position := input.PositionSeconds
	if input.DurationSeconds > 0 && position > input.DurationSeconds {
		position = input.DurationSeconds
	}

	if input.Completed || isCompleted(position, input.DurationSeconds) {
		if input.DurationSeconds > 0 {
			position = input.DurationSeconds
		}
		nextEpisodeID, err := s.findCompletionFallback(ctx, input.EpisodeID)
		if err != nil {
			return UpdateResult{}, err
		}
		state, err := s.saveState(ctx, input.EpisodeID, position)
		if err != nil {
			return UpdateResult{}, err
		}
		if err := s.applyCompletionSideEffects(ctx, input.EpisodeID); err != nil {
			return UpdateResult{}, err
		}
		return UpdateResult{
			Playback:      state,
			NextEpisodeID: nextEpisodeID,
		}, nil
	}

	if current == nil {
		state, err := s.saveState(ctx, input.EpisodeID, position)
		if err != nil {
			return UpdateResult{}, err
		}
		return UpdateResult{Playback: state}, nil
	}

	if position > current.PositionSeconds {
		state, err := s.saveState(ctx, input.EpisodeID, position)
		if err != nil {
			return UpdateResult{}, err
		}
		return UpdateResult{Playback: state}, nil
	}

	diff := current.PositionSeconds - position
	if diff < 30 {
		return UpdateResult{Playback: *current}, nil
	}
	if !input.DidSeek {
		return UpdateResult{Playback: *current}, nil
	}

	state, err := s.saveState(ctx, input.EpisodeID, position)
	if err != nil {
		return UpdateResult{}, err
	}
	return UpdateResult{Playback: state}, nil
}

func (s *Service) saveState(ctx context.Context, episodeID, position int64) (State, error) {
	now := s.now().UTC()
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO playback (episode_id, position_seconds, last_updated)
		VALUES (?, ?, ?)
		ON CONFLICT (episode_id) DO UPDATE SET
			position_seconds = excluded.position_seconds,
			last_updated = excluded.last_updated
	`, episodeID, position, now); err != nil {
		return State{}, fmt.Errorf("save playback state: %w", err)
	}

	return State{
		EpisodeID:       episodeID,
		PositionSeconds: position,
		LastUpdated:     now,
	}, nil
}

func (s *Service) applyCompletionSideEffects(ctx context.Context, episodeID int64) error {
	if err := s.episodeActions.SetListened(ctx, episodeID, true); err != nil {
		return fmt.Errorf("mark episode listened from playback: %w", err)
	}
	if err := s.playlist.Remove(ctx, episodeID); err != nil {
		return fmt.Errorf("remove completed episode from playlist: %w", err)
	}
	return nil
}

func (s *Service) findCompletionFallback(ctx context.Context, completedEpisodeID int64) (*int64, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT playlist.episode_id, episodes.is_listened, playback.position_seconds, episodes.duration
		FROM playlist
		JOIN episodes ON episodes.id = playlist.episode_id
		LEFT JOIN playback ON playback.episode_id = playlist.episode_id
		ORDER BY playlist.position ASC, playlist.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("load playlist for completion fallback: %w", err)
	}
	defer rows.Close()

	type candidate struct {
		episodeID int64
		listened  bool
		position  sql.NullInt64
		duration  sql.NullInt64
	}

	var items []candidate
	currentIndex := -1
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.episodeID, &item.listened, &item.position, &item.duration); err != nil {
			return nil, fmt.Errorf("scan completion fallback candidate: %w", err)
		}
		if item.episodeID == completedEpisodeID {
			currentIndex = len(items)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate completion fallback candidates: %w", err)
	}

	if currentIndex == -1 || currentIndex != len(items)-1 {
		return nil, nil
	}

	for i := currentIndex - 1; i >= 0; i-- {
		item := items[i]
		if item.listened || !item.position.Valid || item.position.Int64 <= 0 {
			continue
		}

		duration := int64(0)
		if item.duration.Valid {
			duration = item.duration.Int64
		}
		if isCompleted(item.position.Int64, duration) {
			continue
		}

		nextEpisodeID := item.episodeID
		return &nextEpisodeID, nil
	}

	return nil, nil
}

func isCompleted(position, duration int64) bool {
	if duration <= 0 {
		return false
	}
	return position >= duration-15
}
