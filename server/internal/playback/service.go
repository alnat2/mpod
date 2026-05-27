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
	ErrEpisodeNotFound = errors.New("episode not found")
	ErrInvalidPosition = errors.New("invalid playback position")
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

func (s *Service) Update(ctx context.Context, input UpdateInput) (State, error) {
	if input.PositionSeconds < 0 {
		return State{}, ErrInvalidPosition
	}

	var episodeExists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM episodes WHERE id = ?`, input.EpisodeID).Scan(&episodeExists); err != nil {
		return State{}, fmt.Errorf("check episode exists: %w", err)
	}
	if episodeExists == 0 {
		return State{}, ErrEpisodeNotFound
	}

	current, err := s.Get(ctx, input.EpisodeID)
	if err != nil {
		return State{}, err
	}

	if current != nil && input.ClientUpdatedAt != nil && input.ClientUpdatedAt.UTC().Before(current.LastUpdated) {
		return *current, nil
	}

	position := input.PositionSeconds
	if input.DurationSeconds > 0 && position > input.DurationSeconds {
		position = input.DurationSeconds
	}

	if input.Completed || isCompleted(position, input.DurationSeconds) {
		if input.DurationSeconds > 0 {
			position = input.DurationSeconds
		}
		state, err := s.saveState(ctx, input.EpisodeID, position)
		if err != nil {
			return State{}, err
		}
		if err := s.applyCompletionSideEffects(ctx, input.EpisodeID); err != nil {
			return State{}, err
		}
		return state, nil
	}

	if current == nil {
		return s.saveState(ctx, input.EpisodeID, position)
	}

	if position > current.PositionSeconds {
		return s.saveState(ctx, input.EpisodeID, position)
	}

	diff := current.PositionSeconds - position
	if diff < 30 {
		return *current, nil
	}
	if !input.DidSeek {
		return *current, nil
	}

	return s.saveState(ctx, input.EpisodeID, position)
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

func isCompleted(position, duration int64) bool {
	if duration <= 0 {
		return false
	}
	return position >= duration-15
}
