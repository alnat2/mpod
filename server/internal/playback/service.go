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
	EpisodeID        *int64    `json:"episodeId,omitempty"`
	AudiobookID      *int64    `json:"audiobookId,omitempty"`
	AudiobookTrackID *int64    `json:"trackId,omitempty"`
	LastUpdated      time.Time `json:"lastUpdated"`
}

type QueueEpisode struct {
	episodes.Episode
	Type            string  `json:"type"` // "episode" or "audiobook"
	AudiobookID     *int64  `json:"audiobookId,omitempty"`
	TrackID         *int64  `json:"trackId,omitempty"`
	Author          string  `json:"author,omitempty"`
	PodcastTitle    string  `json:"podcastTitle"`
	PodcastImageURL *string `json:"podcastImageUrl"`
	CoverURL        *string `json:"coverUrl,omitempty"`
	TrackCount      int     `json:"trackCount,omitempty"`
	TrackNumber     int     `json:"trackNumber,omitempty"`
	HasCover        bool    `json:"hasCover,omitempty"`
	Playback        *State  `json:"playback"`
}

type UpdateResult struct {
	Playback      State  `json:"playback"`
	NextEpisodeID *int64 `json:"nextEpisodeId"`
}

type UpdateInput struct {
	EpisodeID       int64
	TrackID         *int64
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
	var episodeID, audiobookID, trackID sql.NullInt64
	var lastUpdated time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT episode_id, audiobook_id, audiobook_track_id, last_updated
		FROM active_playback
		WHERE singleton_id = 1
	`).Scan(&episodeID, &audiobookID, &trackID, &lastUpdated)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load active playback: %w", err)
	}
	if !episodeID.Valid && !audiobookID.Valid {
		return nil, nil
	}

	if episodeID.Valid {
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

		epID := episodeID.Int64
		return &ActiveState{
			EpisodeID:   &epID,
			LastUpdated: lastUpdated.UTC(),
		}, nil
	}

	if audiobookID.Valid {
		var count int
		_ = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM playlist WHERE audiobook_id = ?`, audiobookID.Int64).Scan(&count)
		if count == 0 {
			_, _ = s.db.ExecContext(ctx, `UPDATE active_playback SET audiobook_id = NULL, audiobook_track_id = NULL WHERE singleton_id = 1`)
			return nil, nil
		}

		abID := audiobookID.Int64
		var trID *int64
		if trackID.Valid {
			v := trackID.Int64
			trID = &v
		}
		return &ActiveState{
			AudiobookID:      &abID,
			AudiobookTrackID: trID,
			LastUpdated:      lastUpdated.UTC(),
		}, nil
	}

	return nil, nil
}

func (s *Service) SetActive(ctx context.Context, episodeID int64) (ActiveState, error) {
	epID := episodeID
	state, err := s.SetActiveItem(ctx, &epID, nil, nil)
	if err != nil {
		return ActiveState{}, err
	}
	return *state, nil
}

func (s *Service) SetActiveItem(ctx context.Context, episodeID *int64, audiobookID *int64, trackID *int64) (*ActiveState, error) {
	now := s.now().UTC()
	if episodeID != nil && *episodeID > 0 {
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM episodes WHERE id = ?`, *episodeID).Scan(&exists); err != nil {
			return nil, fmt.Errorf("check active episode exists: %w", err)
		}
		if exists == 0 {
			return nil, ErrEpisodeNotFound
		}

		inPlaylist, err := s.episodeInPlaylist(ctx, *episodeID)
		if err != nil {
			return nil, err
		}
		if !inPlaylist {
			return nil, ErrEpisodeNotInPlaylist
		}

		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO active_playback (singleton_id, episode_id, audiobook_id, audiobook_track_id, last_updated)
			VALUES (1, ?, NULL, NULL, ?)
			ON CONFLICT (singleton_id) DO UPDATE SET
				episode_id = excluded.episode_id,
				audiobook_id = NULL,
				audiobook_track_id = NULL,
				last_updated = excluded.last_updated
		`, *episodeID, now); err != nil {
			return nil, fmt.Errorf("save active playback: %w", err)
		}

		return &ActiveState{
			EpisodeID:   episodeID,
			LastUpdated: now,
		}, nil
	}

	if audiobookID != nil && *audiobookID > 0 {
		var count int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM playlist WHERE audiobook_id = ?`, *audiobookID).Scan(&count); err != nil {
			return nil, fmt.Errorf("check audiobook in playlist: %w", err)
		}
		if count == 0 {
			return nil, errors.New("audiobook not in playlist")
		}

		actualTrackID := trackID
		if actualTrackID == nil {
			var firstTrID int64
			if err := s.db.QueryRowContext(ctx, `SELECT id FROM audiobook_tracks WHERE audiobook_id = ? ORDER BY track_number ASC LIMIT 1`, *audiobookID).Scan(&firstTrID); err == nil {
				actualTrackID = &firstTrID
			}
		}

		if actualTrackID != nil {
			_, _ = s.db.ExecContext(ctx, `
				INSERT INTO audiobook_playback (track_id, audiobook_id, position_seconds, last_updated)
				VALUES (?, ?, 0, ?)
				ON CONFLICT (track_id) DO UPDATE SET last_updated = excluded.last_updated
			`, *actualTrackID, *audiobookID, now)
		}

		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO active_playback (singleton_id, episode_id, audiobook_id, audiobook_track_id, last_updated)
			VALUES (1, NULL, ?, ?, ?)
			ON CONFLICT (singleton_id) DO UPDATE SET
				episode_id = NULL,
				audiobook_id = excluded.audiobook_id,
				audiobook_track_id = excluded.audiobook_track_id,
				last_updated = excluded.last_updated
		`, *audiobookID, actualTrackID, now); err != nil {
			return nil, fmt.Errorf("save active playback: %w", err)
		}

		return &ActiveState{
			AudiobookID:      audiobookID,
			AudiobookTrackID: actualTrackID,
			LastUpdated:      now,
		}, nil
	}

	return nil, errors.New("invalid active playback target")
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
		SELECT playlist.id, playlist.position, playlist.episode_id, playlist.audiobook_id,
		       episodes.id, episodes.podcast_id, episodes.title, episodes.description,
		       episodes.audio_url, episodes.duration, episodes.downloaded_path,
		       episodes.is_listened, episodes.published_at,
		       podcasts.title, podcasts.image_url,
		       playback.episode_id, playback.position_seconds, playback.last_updated,
		       audiobooks.id, audiobooks.title, COALESCE(audiobooks.author, ''), COALESCE(audiobooks.cover_path, ''), audiobooks.total_duration,
		       (SELECT COUNT(*) FROM audiobook_tracks WHERE audiobook_id = audiobooks.id) as ab_track_count,
		       COALESCE(
		         (SELECT t.id FROM audiobook_playback ap JOIN audiobook_tracks t ON t.id = ap.track_id WHERE ap.audiobook_id = audiobooks.id ORDER BY ap.last_updated DESC LIMIT 1),
		         (SELECT t.id FROM audiobook_tracks t WHERE t.audiobook_id = audiobooks.id ORDER BY t.track_number ASC LIMIT 1)
		       ) as ab_active_track_id,
		       COALESCE(
		         (SELECT t.track_number FROM audiobook_playback ap JOIN audiobook_tracks t ON t.id = ap.track_id WHERE ap.audiobook_id = audiobooks.id ORDER BY ap.last_updated DESC LIMIT 1),
		         (SELECT t.track_number FROM audiobook_tracks t WHERE t.audiobook_id = audiobooks.id ORDER BY t.track_number ASC LIMIT 1)
		       ) as ab_active_track_number,
		       COALESCE(
		         (SELECT t.title FROM audiobook_playback ap JOIN audiobook_tracks t ON t.id = ap.track_id WHERE ap.audiobook_id = audiobooks.id ORDER BY ap.last_updated DESC LIMIT 1),
		         (SELECT t.title FROM audiobook_tracks t WHERE t.audiobook_id = audiobooks.id ORDER BY t.track_number ASC LIMIT 1)
		       ) as ab_active_track_title,
		       COALESCE(
		         (SELECT t.duration FROM audiobook_playback ap JOIN audiobook_tracks t ON t.id = ap.track_id WHERE ap.audiobook_id = audiobooks.id ORDER BY ap.last_updated DESC LIMIT 1),
		         (SELECT t.duration FROM audiobook_tracks t WHERE t.audiobook_id = audiobooks.id ORDER BY t.track_number ASC LIMIT 1)
		       ) as ab_active_track_duration,
		       (SELECT ap.position_seconds FROM audiobook_playback ap WHERE ap.audiobook_id = audiobooks.id ORDER BY ap.last_updated DESC LIMIT 1) as ab_track_pos,
		       (SELECT ap.last_updated FROM audiobook_playback ap WHERE ap.audiobook_id = audiobooks.id ORDER BY ap.last_updated DESC LIMIT 1) as ab_track_updated
		FROM playlist
		LEFT JOIN episodes ON episodes.id = playlist.episode_id
		LEFT JOIN podcasts ON podcasts.id = episodes.podcast_id
		LEFT JOIN playback ON playback.episode_id = episodes.id
		LEFT JOIN audiobooks ON audiobooks.id = playlist.audiobook_id
		ORDER BY playlist.position ASC, playlist.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list playback queue: %w", err)
	}
	defer rows.Close()

	items := make([]QueueEpisode, 0)
	for rows.Next() {
		var playlistID, position int64
		var epID, abID sql.NullInt64
		var epRowID, epPodcastID sql.NullInt64
		var epTitle, description, downloadedPath, epAudioURL, podcastTitle, podcastImageURL sql.NullString
		var epDuration, playbackEpisodeID, playbackPosition sql.NullInt64
		var epIsListened sql.NullBool
		var publishedAt, playbackUpdatedAt sql.NullTime
		var abRowID, abTotalDuration, abTrackCount, abActiveTrackID, abActiveTrackNumber, abActiveTrackDuration, abTrackPos sql.NullInt64
		var abTitle, abAuthor, abCoverPath, abActiveTrackTitle sql.NullString
		var abTrackUpdated sql.NullTime

		if err := rows.Scan(
			&playlistID, &position, &epID, &abID,
			&epRowID, &epPodcastID, &epTitle, &description,
			&epAudioURL, &epDuration, &downloadedPath,
			&epIsListened, &publishedAt,
			&podcastTitle, &podcastImageURL,
			&playbackEpisodeID, &playbackPosition, &playbackUpdatedAt,
			&abRowID, &abTitle, &abAuthor, &abCoverPath, &abTotalDuration,
			&abTrackCount, &abActiveTrackID, &abActiveTrackNumber, &abActiveTrackTitle, &abActiveTrackDuration,
			&abTrackPos, &abTrackUpdated,
		); err != nil {
			return nil, fmt.Errorf("scan playback queue: %w", err)
		}

		if epID.Valid {
			var item QueueEpisode
			item.Type = "episode"
			item.ID = epRowID.Int64
			item.PodcastID = epPodcastID.Int64
			item.Title = epTitle.String
			item.AudioURL = epAudioURL.String
			item.IsListened = epIsListened.Bool
			item.PodcastTitle = podcastTitle.String

			if description.Valid {
				item.ShowNotes = episodes.SanitizeShowNotes(description.String)
				item.Description = item.ShowNotes
			}
			if epDuration.Valid {
				item.Duration = &epDuration.Int64
			}
			item.Downloaded = downloadedPath.Valid && downloadedPath.String != ""
			if publishedAt.Valid {
				timestamp := publishedAt.Time.UTC()
				item.PublishedAt = &timestamp
			}
			if podcastImageURL.Valid && podcastImageURL.String != "" {
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
		} else if abID.Valid {
			var item QueueEpisode
			item.Type = "audiobook"
			bookID := abRowID.Int64
			item.ID = bookID
			item.AudiobookID = &bookID
			item.Title = abTitle.String
			item.Author = abAuthor.String
			item.PodcastTitle = abAuthor.String
			item.TrackCount = int(abTrackCount.Int64)
			item.Downloaded = true // Local audiobook files are permanent

			if abActiveTrackID.Valid {
				trID := abActiveTrackID.Int64
				item.TrackID = &trID
				item.TrackNumber = int(abActiveTrackNumber.Int64)
				dur := abActiveTrackDuration.Int64
				item.Duration = &dur
				item.AudioURL = fmt.Sprintf("/api/audiobooks/%d/tracks/%d/audio", bookID, trID)
				pos := int64(0)
				if abTrackPos.Valid {
					pos = abTrackPos.Int64
				}
				upd := time.Now().UTC()
				if abTrackUpdated.Valid {
					upd = abTrackUpdated.Time.UTC()
				}
				item.Playback = &State{
					EpisodeID:       bookID,
					PositionSeconds: pos,
					LastUpdated:     upd,
				}
			}

			if abCoverPath.Valid && abCoverPath.String != "" {
				item.HasCover = true
				coverURL := fmt.Sprintf("/api/audiobooks/%d/cover", bookID)
				item.CoverURL = &coverURL
				item.PodcastImageURL = &coverURL
			}
			item.Downloaded = true

			items = append(items, item)
		}
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

	if input.TrackID != nil && *input.TrackID > 0 {
		var abID, dur int64
		if err := s.db.QueryRowContext(ctx, `SELECT audiobook_id, duration FROM audiobook_tracks WHERE id = ?`, *input.TrackID).Scan(&abID, &dur); err != nil {
			return UpdateResult{}, fmt.Errorf("track not found: %w", err)
		}
		now := s.now().UTC()
		position := input.PositionSeconds
		if input.DurationSeconds > 0 && position > input.DurationSeconds {
			position = input.DurationSeconds
		}

		if input.Completed {
			if input.DurationSeconds > 0 {
				position = input.DurationSeconds
			}
			// Mark track listened
			_, _ = s.db.ExecContext(ctx, `UPDATE audiobook_tracks SET is_listened = 1 WHERE id = ?`, *input.TrackID)
			// Check next track
			var nextTrackID int64
			err := s.db.QueryRowContext(ctx, `
				SELECT id FROM audiobook_tracks
				WHERE audiobook_id = ? AND track_number > (SELECT track_number FROM audiobook_tracks WHERE id = ?)
				ORDER BY track_number ASC LIMIT 1
			`, abID, *input.TrackID).Scan(&nextTrackID)
			if err == nil {
				// Update active playback to next track
				_, _ = s.db.ExecContext(ctx, `UPDATE active_playback SET audiobook_track_id = ?, last_updated = ? WHERE singleton_id = 1`, nextTrackID, now)
				return UpdateResult{
					Playback: State{
						EpisodeID:       abID,
						PositionSeconds: position,
						LastUpdated:     now,
					},
					NextEpisodeID: &nextTrackID,
				}, nil
			}

			// Final track completed -> remove audiobook from playlist
			_, _ = s.db.ExecContext(ctx, `DELETE FROM playlist WHERE audiobook_id = ?`, abID)
			_, _ = s.db.ExecContext(ctx, `UPDATE active_playback SET audiobook_id = NULL, audiobook_track_id = NULL WHERE singleton_id = 1`)
			return UpdateResult{
				Playback: State{
					EpisodeID:       abID,
					PositionSeconds: position,
					LastUpdated:     now,
				},
				NextEpisodeID: nil,
			}, nil
		}

		// Save track playback
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO audiobook_playback (track_id, audiobook_id, position_seconds, last_updated)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (track_id) DO UPDATE SET position_seconds = excluded.position_seconds, last_updated = excluded.last_updated
		`, *input.TrackID, abID, position, now); err != nil {
			return UpdateResult{}, fmt.Errorf("save audiobook playback: %w", err)
		}

		return UpdateResult{
			Playback: State{
				EpisodeID:       abID,
				PositionSeconds: position,
				LastUpdated:     now,
			},
		}, nil
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

	position := input.PositionSeconds
	if input.DurationSeconds > 0 && position > input.DurationSeconds {
		position = input.DurationSeconds
	}

	if input.Completed {
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

	if current != nil && input.ClientUpdatedAt != nil && input.ClientUpdatedAt.UTC().Before(current.LastUpdated) {
		return UpdateResult{Playback: *current}, nil
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
	return nil
}

func (s *Service) findCompletionFallback(ctx context.Context, completedEpisodeID int64) (*int64, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT playlist.episode_id, episodes.is_listened
		FROM playlist
		JOIN episodes ON episodes.id = playlist.episode_id
		ORDER BY playlist.position ASC, playlist.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("load playlist for completion fallback: %w", err)
	}
	defer rows.Close()

	type candidate struct {
		episodeID int64
		listened  bool
	}

	var items []candidate
	currentIndex := -1
	for rows.Next() {
		var item candidate
		if err := rows.Scan(&item.episodeID, &item.listened); err != nil {
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

	for i := 0; i < currentIndex; i++ {
		item := items[i]
		if item.listened {
			continue
		}

		nextEpisodeID := item.episodeID
		return &nextEpisodeID, nil
	}

	return nil, nil
}
