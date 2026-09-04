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
	ErrInvalidTarget        = errors.New("invalid playback target")
)

type Service struct {
	db             *sql.DB
	episodeActions *episodes.Actions
	playlist       *playlist.Service
	now            func() time.Time
}

type State struct {
	EpisodeID       int64     `json:"episodeId,omitempty"`
	AudiobookID     int64     `json:"audiobookId,omitempty"`
	TrackID         int64     `json:"trackId,omitempty"`
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
	HasChapters     bool    `json:"hasChapters,omitempty"`
	HasCover        bool    `json:"hasCover,omitempty"`
	Playback        *State  `json:"playback"`
}

type UpdateResult struct {
	Playback      State           `json:"playback"`
	NextTarget    *PlaybackTarget `json:"nextTarget,omitempty"`
	NextEpisodeID *int64          `json:"nextEpisodeId"`
	NextTrackID   *int64          `json:"nextTrackId,omitempty"`
}

type PlaybackTarget struct {
	Type        string `json:"type"`
	EpisodeID   *int64 `json:"episodeId,omitempty"`
	AudiobookID *int64 `json:"audiobookId,omitempty"`
	TrackID     *int64 `json:"trackId,omitempty"`
}

type UpdateInput struct {
	EpisodeID       int64
	AudiobookID     *int64
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

func (s *Service) GetEpisode(ctx context.Context, episodeID int64) (*State, error) {
	var state State
	err := s.db.QueryRowContext(ctx, `
		SELECT episode_id, position_seconds, last_updated
		FROM playback
		WHERE episode_id = ?
	`, episodeID).Scan(&state.EpisodeID, &state.PositionSeconds, &state.LastUpdated)
	if err == nil {
		state.LastUpdated = state.LastUpdated.UTC()
		return &state, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load playback state: %w", err)
	}
	return nil, nil
}

func (s *Service) GetAudiobook(ctx context.Context, audiobookID int64, trackID *int64) (*State, error) {
	var abID, selectedTrackID, pos int64
	var lastUpdated time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT ap.audiobook_id, ap.track_id, ap.position_seconds, ap.last_updated
		FROM audiobook_playback ap
		WHERE ap.track_id = COALESCE(
			(SELECT selected.track_id FROM audiobook_playlist_tracks selected WHERE selected.audiobook_id = ? AND selected.track_id = ?),
			(SELECT act.audiobook_track_id FROM active_playback act WHERE act.singleton_id = 1 AND act.audiobook_id = ? AND EXISTS(SELECT 1 FROM audiobook_playlist_tracks selected WHERE selected.audiobook_id = ? AND selected.track_id = act.audiobook_track_id)),
			(SELECT ap2.track_id FROM audiobook_playback ap2 JOIN audiobook_playlist_tracks selected ON selected.track_id = ap2.track_id WHERE selected.audiobook_id = ? ORDER BY ap2.last_updated DESC LIMIT 1),
			(SELECT t.id FROM audiobook_tracks t JOIN audiobook_playlist_tracks selected ON selected.track_id = t.id WHERE selected.audiobook_id = ? ORDER BY t.track_number ASC, t.id ASC LIMIT 1)
		)
	`, audiobookID, trackID, audiobookID, audiobookID, audiobookID, audiobookID).Scan(&abID, &selectedTrackID, &pos, &lastUpdated)
	if err == nil {
		return &State{
			AudiobookID:     abID,
			TrackID:         selectedTrackID,
			PositionSeconds: pos,
			LastUpdated:     lastUpdated.UTC(),
		}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load audiobook playback state: %w", err)
	}
	return nil, nil
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
		_ = s.db.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM playlist
			WHERE audiobook_id = ?
			  AND EXISTS(SELECT 1 FROM audiobook_playlist_tracks WHERE audiobook_id = ?)
		`, audiobookID.Int64, audiobookID.Int64).Scan(&count)
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

	if trackID != nil && *trackID > 0 {
		var bookID int64
		if err := s.db.QueryRowContext(ctx, `SELECT audiobook_id FROM audiobook_tracks WHERE id = ?`, *trackID).Scan(&bookID); err != nil {
			return nil, fmt.Errorf("find track audiobook: %w", err)
		}

		var count int
		if err := s.db.QueryRowContext(ctx, `
			SELECT COUNT(*)
			FROM playlist
			JOIN audiobook_playlist_tracks selected ON selected.audiobook_id = playlist.audiobook_id
			WHERE playlist.audiobook_id = ? AND selected.track_id = ?
		`, bookID, *trackID).Scan(&count); err != nil {
			return nil, fmt.Errorf("check track in playlist: %w", err)
		}
		if count == 0 {
			return nil, errors.New("audiobook track not in playlist")
		}

		_, _ = s.db.ExecContext(ctx, `
			INSERT INTO audiobook_playback (track_id, audiobook_id, position_seconds, last_updated)
			VALUES (?, ?, 0, ?)
			ON CONFLICT (track_id) DO UPDATE SET last_updated = excluded.last_updated
		`, *trackID, bookID, now)

		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO active_playback (singleton_id, episode_id, audiobook_id, audiobook_track_id, last_updated)
			VALUES (1, NULL, ?, ?, ?)
			ON CONFLICT (singleton_id) DO UPDATE SET
				episode_id = NULL,
				audiobook_id = excluded.audiobook_id,
				audiobook_track_id = excluded.audiobook_track_id,
				last_updated = excluded.last_updated
		`, bookID, *trackID, now); err != nil {
			return nil, fmt.Errorf("save active playback: %w", err)
		}

		return &ActiveState{
			AudiobookID:      &bookID,
			AudiobookTrackID: trackID,
			LastUpdated:      now,
		}, nil
	}

	if audiobookID != nil && *audiobookID > 0 {
		var count int
		if err := s.db.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM playlist
			WHERE audiobook_id = ?
			  AND EXISTS(SELECT 1 FROM audiobook_playlist_tracks WHERE audiobook_id = ?)
		`, *audiobookID, *audiobookID).Scan(&count); err != nil {
			return nil, fmt.Errorf("check audiobook in playlist: %w", err)
		}
		if count == 0 {
			return nil, errors.New("audiobook not in playlist")
		}

		actualTrackID := trackID
		if actualTrackID == nil {
			var lastTrID int64
			if err := s.db.QueryRowContext(ctx, `
				SELECT progress.track_id
				FROM audiobook_playback progress
				JOIN audiobook_playlist_tracks selected ON selected.track_id = progress.track_id
				WHERE selected.audiobook_id = ?
				ORDER BY progress.last_updated DESC LIMIT 1
			`, *audiobookID).Scan(&lastTrID); err == nil {
				actualTrackID = &lastTrID
			} else {
				var firstTrID int64
				if err := s.db.QueryRowContext(ctx, `
					SELECT track.id
					FROM audiobook_tracks track
					JOIN audiobook_playlist_tracks selected ON selected.track_id = track.id
					WHERE selected.audiobook_id = ?
					ORDER BY track.track_number ASC, track.id ASC LIMIT 1
				`, *audiobookID).Scan(&firstTrID); err == nil {
					actualTrackID = &firstTrID
				}
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
		WITH audiobook_queue AS (
			SELECT p.audiobook_id,
			       COUNT(selected.track_id) AS track_count,
			       (SELECT COUNT(*)
			        FROM audiobook_tracks library_track
			        WHERE library_track.audiobook_id = p.audiobook_id) > 1 AS has_chapters,
			       COALESCE(
			         (
			           SELECT active.audiobook_track_id
			           FROM active_playback active
			           JOIN audiobook_tracks active_track ON active_track.id = active.audiobook_track_id
			           WHERE active.singleton_id = 1
			             AND active.audiobook_id = p.audiobook_id
			             AND active_track.is_listened = 0
			             AND EXISTS(
			               SELECT 1 FROM audiobook_playlist_tracks membership
			               WHERE membership.audiobook_id = p.audiobook_id
			                 AND membership.track_id = active.audiobook_track_id
			             )
			         ),
			         (
			           SELECT progress.track_id
			           FROM audiobook_playback progress
			           JOIN audiobook_playlist_tracks membership ON membership.track_id = progress.track_id
			           JOIN audiobook_tracks progress_track ON progress_track.id = progress.track_id
			           WHERE membership.audiobook_id = p.audiobook_id
			             AND progress_track.is_listened = 0
			           ORDER BY progress.last_updated DESC
			           LIMIT 1
			         ),
			         (
			           SELECT track.id
			           FROM audiobook_playlist_tracks membership
			           JOIN audiobook_tracks track ON track.id = membership.track_id
			           WHERE membership.audiobook_id = p.audiobook_id
			             AND track.is_listened = 0
			           ORDER BY track.track_number, track.id
			           LIMIT 1
			         )
			       ) AS active_track_id
			FROM playlist p
			LEFT JOIN audiobook_playlist_tracks selected ON selected.audiobook_id = p.audiobook_id
			WHERE p.audiobook_id IS NOT NULL
			GROUP BY p.audiobook_id
		)
		SELECT playlist.position, playlist.episode_id, playlist.audiobook_id,
		       episodes.id, episodes.podcast_id, episodes.title, episodes.description,
		       episodes.audio_url, episodes.duration, episodes.downloaded_path,
		       episodes.is_listened, episodes.published_at,
		       podcasts.title, podcasts.image_url,
		       playback.episode_id, playback.position_seconds, playback.last_updated,
		       audiobooks.id, audiobooks.title, COALESCE(audiobooks.author, ''), COALESCE(audiobooks.cover_path, ''), audiobooks.total_duration,
		       audiobook_queue.track_count, audiobook_queue.has_chapters,
		       active_track.id, active_track.track_number, active_track.title, active_track.duration,
		       audiobook_progress.position_seconds, audiobook_progress.last_updated
		FROM playlist
		LEFT JOIN episodes ON episodes.id = playlist.episode_id
		LEFT JOIN podcasts ON podcasts.id = episodes.podcast_id
		LEFT JOIN playback ON playback.episode_id = episodes.id
		LEFT JOIN audiobooks ON audiobooks.id = playlist.audiobook_id
		LEFT JOIN audiobook_queue ON audiobook_queue.audiobook_id = playlist.audiobook_id
		LEFT JOIN audiobook_tracks active_track ON active_track.id = audiobook_queue.active_track_id
		LEFT JOIN audiobook_playback audiobook_progress ON audiobook_progress.track_id = active_track.id
		ORDER BY playlist.position ASC, playlist.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("list playback queue: %w", err)
	}
	defer rows.Close()

	items := make([]QueueEpisode, 0)
	for rows.Next() {
		var position int64
		var epID, abID sql.NullInt64
		var epRowID, epPodcastID sql.NullInt64
		var epTitle, description, downloadedPath, epAudioURL, podcastTitle, podcastImageURL sql.NullString
		var epDuration, playbackEpisodeID, playbackPosition sql.NullInt64
		var epIsListened sql.NullBool
		var publishedAt, playbackUpdatedAt sql.NullTime
		var abRowID, abTotalDuration, abTrackCount, abActiveTrackID, abActiveTrackNumber, abActiveTrackDuration, abTrackPos sql.NullInt64
		var abHasChapters sql.NullBool
		var abTitle, abAuthor, abCoverPath, abActiveTrackTitle sql.NullString
		var abTrackUpdated sql.NullTime

		if err := rows.Scan(
			&position, &epID, &abID,
			&epRowID, &epPodcastID, &epTitle, &description,
			&epAudioURL, &epDuration, &downloadedPath,
			&epIsListened, &publishedAt,
			&podcastTitle, &podcastImageURL,
			&playbackEpisodeID, &playbackPosition, &playbackUpdatedAt,
			&abRowID, &abTitle, &abAuthor, &abCoverPath, &abTotalDuration,
			&abTrackCount, &abHasChapters, &abActiveTrackID, &abActiveTrackNumber, &abActiveTrackTitle, &abActiveTrackDuration,
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
			item.HasChapters = abHasChapters.Bool
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
					AudiobookID:     bookID,
					TrackID:         trID,
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
		if input.AudiobookID == nil || *input.AudiobookID <= 0 || input.EpisodeID > 0 {
			return UpdateResult{}, ErrInvalidTarget
		}
		var abID, dur int64
		if err := s.db.QueryRowContext(ctx, `
			SELECT track.audiobook_id, track.duration
			FROM audiobook_tracks track
			JOIN audiobook_playlist_tracks selected ON selected.track_id = track.id
			JOIN playlist ON playlist.audiobook_id = selected.audiobook_id
			WHERE track.id = ? AND track.audiobook_id = ?
		`, *input.TrackID, *input.AudiobookID).Scan(&abID, &dur); err != nil {
			return UpdateResult{}, fmt.Errorf("track not found: %w", err)
		}
		now := s.now().UTC()
		position := input.PositionSeconds
		if input.DurationSeconds > 0 && position > input.DurationSeconds {
			position = input.DurationSeconds
		}

		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return UpdateResult{}, fmt.Errorf("begin audiobook playback tx: %w", err)
		}
		defer tx.Rollback()

		var currentPosition sql.NullInt64
		var currentUpdated sql.NullTime
		if err := tx.QueryRowContext(ctx, `SELECT position_seconds, last_updated FROM audiobook_playback WHERE track_id = ?`, *input.TrackID).Scan(&currentPosition, &currentUpdated); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return UpdateResult{}, fmt.Errorf("load audiobook playback: %w", err)
		}
		if !input.DidSeek && input.ClientUpdatedAt != nil && currentUpdated.Valid && input.ClientUpdatedAt.UTC().Before(currentUpdated.Time.UTC()) {
			return UpdateResult{Playback: State{AudiobookID: abID, TrackID: *input.TrackID, PositionSeconds: currentPosition.Int64, LastUpdated: currentUpdated.Time.UTC()}}, nil
		}

		if input.Completed {
			if input.DurationSeconds > 0 {
				position = input.DurationSeconds
			} else if dur > 0 {
				position = dur
			}
			if _, err := tx.ExecContext(ctx, `UPDATE audiobook_tracks SET is_listened = 1 WHERE id = ?`, *input.TrackID); err != nil {
				return UpdateResult{}, fmt.Errorf("mark audiobook track listened: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO audiobook_playback (track_id, audiobook_id, position_seconds, last_updated)
				VALUES (?, ?, ?, ?)
				ON CONFLICT (track_id) DO UPDATE SET position_seconds = excluded.position_seconds, last_updated = excluded.last_updated
			`, *input.TrackID, abID, position, now); err != nil {
				return UpdateResult{}, fmt.Errorf("save completed audiobook track: %w", err)
			}

			var nextTrackID int64
			err := tx.QueryRowContext(ctx, `
				SELECT track.id
				FROM audiobook_playlist_tracks selected
				JOIN audiobook_tracks track ON track.id = selected.track_id
				WHERE selected.audiobook_id = ? AND track.is_listened = 0
				ORDER BY
				  CASE WHEN track.track_number > (SELECT track_number FROM audiobook_tracks WHERE id = ?) THEN 0 ELSE 1 END,
				  track.track_number,
				  track.id
				LIMIT 1
			`, abID, *input.TrackID).Scan(&nextTrackID)
			if err == nil {
				if _, err := tx.ExecContext(ctx, `
					INSERT INTO active_playback (singleton_id, episode_id, audiobook_id, audiobook_track_id, last_updated)
					VALUES (1, NULL, ?, ?, ?)
					ON CONFLICT (singleton_id) DO UPDATE SET
						episode_id = NULL,
						audiobook_id = excluded.audiobook_id,
						audiobook_track_id = excluded.audiobook_track_id,
						last_updated = excluded.last_updated
				`, abID, nextTrackID, now); err != nil {
					return UpdateResult{}, fmt.Errorf("advance active audiobook track: %w", err)
				}
				if err := tx.Commit(); err != nil {
					return UpdateResult{}, fmt.Errorf("commit audiobook completion: %w", err)
				}
				return UpdateResult{
					Playback: State{
						AudiobookID:     abID,
						TrackID:         *input.TrackID,
						PositionSeconds: position,
						LastUpdated:     now,
					},
					NextTarget: &PlaybackTarget{
						Type:        "audiobook",
						AudiobookID: &abID,
						TrackID:     &nextTrackID,
					},
					NextTrackID: &nextTrackID,
				}, nil
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return UpdateResult{}, fmt.Errorf("find next audiobook track: %w", err)
			}

			fallback, err := findCompletionFallback(ctx, tx, nil, &abID)
			if err != nil {
				return UpdateResult{}, err
			}
			if err := resetCompletedAudiobookTx(ctx, tx, abID, now); err != nil {
				return UpdateResult{}, err
			}
			if err := tx.Commit(); err != nil {
				return UpdateResult{}, fmt.Errorf("commit completed audiobook reset: %w", err)
			}
			result := UpdateResult{
				Playback: State{
					AudiobookID:     abID,
					TrackID:         *input.TrackID,
					PositionSeconds: position,
					LastUpdated:     now,
				},
				NextTarget: fallback,
			}
			if fallback != nil && fallback.EpisodeID != nil {
				result.NextEpisodeID = fallback.EpisodeID
			}
			return result, nil
		}

		if _, err := tx.ExecContext(ctx, `UPDATE audiobook_tracks SET is_listened = 0 WHERE id = ? AND is_listened = 1`, *input.TrackID); err != nil {
			return UpdateResult{}, fmt.Errorf("mark replayed audiobook track unlistened: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO audiobook_playback (track_id, audiobook_id, position_seconds, last_updated)
			VALUES (?, ?, ?, ?)
			ON CONFLICT (track_id) DO UPDATE SET position_seconds = excluded.position_seconds, last_updated = excluded.last_updated
		`, *input.TrackID, abID, position, now); err != nil {
			return UpdateResult{}, fmt.Errorf("save audiobook playback: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return UpdateResult{}, fmt.Errorf("commit audiobook playback: %w", err)
		}

		return UpdateResult{
			Playback: State{
				AudiobookID:     abID,
				TrackID:         *input.TrackID,
				PositionSeconds: position,
				LastUpdated:     now,
			},
		}, nil
	}

	if input.AudiobookID != nil || input.EpisodeID <= 0 {
		return UpdateResult{}, ErrInvalidTarget
	}

	var episodeExists int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM episodes WHERE id = ?`, input.EpisodeID).Scan(&episodeExists); err != nil {
		return UpdateResult{}, fmt.Errorf("check episode exists: %w", err)
	}
	if episodeExists == 0 {
		return UpdateResult{}, ErrEpisodeNotFound
	}

	current, err := s.GetEpisode(ctx, input.EpisodeID)
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
		nextTarget, err := findCompletionFallback(ctx, s.db, &input.EpisodeID, nil)
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
		result := UpdateResult{Playback: state, NextTarget: nextTarget}
		if nextTarget != nil && nextTarget.EpisodeID != nil {
			result.NextEpisodeID = nextTarget.EpisodeID
		}
		return result, nil
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

func resetCompletedAudiobookTx(ctx context.Context, tx *sql.Tx, audiobookID int64, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM playlist WHERE audiobook_id = ?`, audiobookID); err != nil {
		return fmt.Errorf("remove completed audiobook from playlist: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM audiobook_playlist_tracks WHERE audiobook_id = ?`, audiobookID); err != nil {
		return fmt.Errorf("clear completed audiobook selection: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM audiobook_playback WHERE audiobook_id = ?`, audiobookID); err != nil {
		return fmt.Errorf("reset completed audiobook playback: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE audiobook_tracks SET is_listened = 0 WHERE audiobook_id = ?`, audiobookID); err != nil {
		return fmt.Errorf("reset completed audiobook listened state: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE active_playback
		SET audiobook_id = NULL, audiobook_track_id = NULL, last_updated = ?
		WHERE singleton_id = 1 AND audiobook_id = ?
	`, now, audiobookID); err != nil {
		return fmt.Errorf("clear completed audiobook active state: %w", err)
	}
	return nil
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

type playlistQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func findCompletionFallback(ctx context.Context, queryer playlistQueryer, completedEpisodeID, completedAudiobookID *int64) (*PlaybackTarget, error) {
	rows, err := queryer.QueryContext(ctx, `
		SELECT playlist.episode_id,
		       COALESCE(episodes.is_listened, 1),
		       COALESCE(episodes.audio_url, ''),
		       playlist.audiobook_id,
		       COALESCE(
		         (
		           SELECT active.audiobook_track_id
		           FROM active_playback active
		           JOIN audiobook_tracks track ON track.id = active.audiobook_track_id
		           WHERE active.singleton_id = 1
		             AND active.audiobook_id = playlist.audiobook_id
		             AND track.is_listened = 0
		             AND EXISTS(
		               SELECT 1 FROM audiobook_playlist_tracks selected
		               WHERE selected.audiobook_id = playlist.audiobook_id
		                 AND selected.track_id = active.audiobook_track_id
		             )
		         ),
		         (
		           SELECT progress.track_id
		           FROM audiobook_playback progress
		           JOIN audiobook_playlist_tracks selected ON selected.track_id = progress.track_id
		           JOIN audiobook_tracks track ON track.id = progress.track_id
		           WHERE selected.audiobook_id = playlist.audiobook_id
		             AND track.is_listened = 0
		           ORDER BY progress.last_updated DESC
		           LIMIT 1
		         ),
		         (
		           SELECT track.id
		           FROM audiobook_playlist_tracks selected
		           JOIN audiobook_tracks track ON track.id = selected.track_id
		           WHERE selected.audiobook_id = playlist.audiobook_id
		             AND track.is_listened = 0
		           ORDER BY track.track_number, track.id
		           LIMIT 1
		         )
		       ) AS audiobook_track_id
		FROM playlist
		LEFT JOIN episodes ON episodes.id = playlist.episode_id
		ORDER BY playlist.position ASC, playlist.id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("load playlist for completion fallback: %w", err)
	}
	defer rows.Close()

	type candidate struct {
		target *PlaybackTarget
	}

	var items []candidate
	currentIndex := -1
	for rows.Next() {
		var epID, abID, trackID sql.NullInt64
		var listened bool
		var audioURL string
		if err := rows.Scan(&epID, &listened, &audioURL, &abID, &trackID); err != nil {
			return nil, fmt.Errorf("scan completion fallback candidate: %w", err)
		}
		var item candidate
		if epID.Valid {
			id := epID.Int64
			if !listened && audioURL != "" {
				item.target = &PlaybackTarget{Type: "episode", EpisodeID: &id}
			}
			if completedEpisodeID != nil && id == *completedEpisodeID {
				currentIndex = len(items)
			}
		} else if abID.Valid {
			id := abID.Int64
			if trackID.Valid {
				trID := trackID.Int64
				item.target = &PlaybackTarget{Type: "audiobook", AudiobookID: &id, TrackID: &trID}
			}
			if completedAudiobookID != nil && id == *completedAudiobookID {
				currentIndex = len(items)
			}
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
		if items[i].target != nil {
			return items[i].target, nil
		}
	}

	return nil, nil
}
