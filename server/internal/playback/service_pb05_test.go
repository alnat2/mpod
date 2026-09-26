package playback

import (
	"context"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/episodes"
	"github.com/cross/mpod/server/internal/playlist"
)

func TestLateAudiobookProgressPreservesExplicitActiveSelection(t *testing.T) {
	for _, tt := range []struct {
		name          string
		activeEpisode *int64
		activeBook    int64
		activeTrack   int64
		queueTrack    int64
	}{
		{name: "podcast", activeEpisode: playbackTestID(1), queueTrack: 10},
		{name: "another audiobook", activeBook: 2, activeTrack: 20, queueTrack: 10},
		{name: "another chapter", activeBook: 1, activeTrack: 11, queueTrack: 11},
	} {
		t.Run(tt.name, func(t *testing.T) {
			db := newTestDB(t)
			defer db.Close()
			mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
			mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'episode', 'Episode', 'https://example.com/1.mp3')`)
			mustExec(t, db.SQL, `INSERT INTO audiobooks (id, title, author, rel_path) VALUES (1, 'A', 'Author', 'A'), (2, 'B', 'Author', 'B')`)
			mustExec(t, db.SQL, `INSERT INTO audiobook_tracks (id, audiobook_id, track_number, title, rel_path, file_path, duration) VALUES (10, 1, 1, 'A1', 'A/1.mp3', '/A/1.mp3', 600), (11, 1, 2, 'A2', 'A/2.mp3', '/A/2.mp3', 600), (20, 2, 1, 'B1', 'B/1.mp3', '/B/1.mp3', 600)`)
			mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
			mustExec(t, db.SQL, `INSERT INTO playlist (audiobook_id, position) VALUES (1, 2), (2, 3)`)
			mustExec(t, db.SQL, `INSERT INTO audiobook_playlist_tracks (audiobook_id, track_id) VALUES (1, 10), (1, 11), (2, 20)`)

			service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
			ctx := context.Background()
			bookA, chapterA := int64(1), int64(10)
			baseTime := time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC)
			service.now = func() time.Time { return baseTime }
			if _, err := service.SetActiveItem(ctx, nil, &bookA, &chapterA); err != nil {
				t.Fatalf("select chapter A1: %v", err)
			}
			if _, err := service.Update(ctx, UpdateInput{AudiobookID: &bookA, TrackID: &chapterA, PositionSeconds: 60}); err != nil {
				t.Fatalf("save initial A1 position: %v", err)
			}

			service.now = func() time.Time { return baseTime.Add(time.Minute) }
			if _, err := service.SetActiveItem(ctx, tt.activeEpisode, playbackTestOptionalID(tt.activeBook), playbackTestOptionalID(tt.activeTrack)); err != nil {
				t.Fatalf("select next active target: %v", err)
			}
			selected, err := service.GetActive(ctx)
			if err != nil || selected == nil {
				t.Fatalf("load explicit active selection: %+v, %v", selected, err)
			}

			// This request was prepared for A1 before the user selected another target.
			service.now = func() time.Time { return baseTime.Add(2 * time.Minute) }
			result, err := service.Update(ctx, UpdateInput{AudiobookID: &bookA, TrackID: &chapterA, PositionSeconds: 120})
			if err != nil || result.Playback.PositionSeconds != 120 {
				t.Fatalf("late A1 progress: %+v, %v", result, err)
			}
			active, err := service.GetActive(ctx)
			if err != nil || active == nil {
				t.Fatalf("load active after late progress: %+v, %v", active, err)
			}
			if !active.LastUpdated.Equal(selected.LastUpdated) {
				t.Fatalf("ordinary progress changed active timestamp from %v to %v", selected.LastUpdated, active.LastUpdated)
			}
			if tt.activeEpisode != nil {
				if active.EpisodeID == nil || *active.EpisodeID != *tt.activeEpisode {
					t.Fatalf("late A1 progress replaced podcast selection: %+v", active)
				}
			} else if active.AudiobookID == nil || *active.AudiobookID != tt.activeBook || active.AudiobookTrackID == nil || *active.AudiobookTrackID != tt.activeTrack {
				t.Fatalf("late A1 progress replaced audiobook selection: %+v", active)
			}

			state, err := service.GetAudiobook(ctx, bookA, &chapterA)
			if err != nil || state == nil || state.PositionSeconds != 120 {
				t.Fatalf("A1 position was not saved: %+v, %v", state, err)
			}
			queue, err := service.ListQueue(ctx)
			if err != nil {
				t.Fatalf("load queue: %v", err)
			}
			if len(queue) != 3 || queue[1].TrackID == nil || *queue[1].TrackID != tt.queueTrack {
				t.Fatalf("late A1 progress changed queued chapter: %+v", queue)
			}
		})
	}
}

func TestOrdinaryAudiobookProgressDoesNotSelectActive(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()
	mustExec(t, db.SQL, `INSERT INTO audiobooks (id, title, author, rel_path) VALUES (1, 'A', 'Author', 'A')`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_tracks (id, audiobook_id, track_number, title, rel_path, file_path, duration) VALUES (10, 1, 1, 'A1', 'A/1.mp3', '/A/1.mp3', 600)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (audiobook_id, position) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_playlist_tracks (audiobook_id, track_id) VALUES (1, 10)`)
	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	ctx := context.Background()
	bookID, trackID := int64(1), int64(10)
	for _, tt := range []struct {
		name     string
		position int64
		seek     bool
	}{
		{name: "progress or beacon", position: 10},
		{name: "pause position", position: 60},
		{name: "seek", position: 20, seek: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			result, err := service.Update(ctx, UpdateInput{AudiobookID: &bookID, TrackID: &trackID, PositionSeconds: tt.position, DidSeek: tt.seek})
			if err != nil || result.Playback.PositionSeconds != tt.position {
				t.Fatalf("save position: %+v, %v", result, err)
			}
			active, err := service.GetActive(ctx)
			if err != nil || active != nil {
				t.Fatalf("ordinary position update selected active: %+v, %v", active, err)
			}
		})
	}
}

func TestAudiobookReplayPositionWaitsForExplicitActiveSelection(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()
	mustExec(t, db.SQL, `INSERT INTO audiobooks (id, title, author, rel_path) VALUES (1, 'A', 'Author', 'A')`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_tracks (id, audiobook_id, track_number, title, rel_path, file_path, duration, is_listened) VALUES (10, 1, 1, 'A1', 'A/1.mp3', '/A/1.mp3', 600, 1), (11, 1, 2, 'A2', 'A/2.mp3', '/A/2.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (audiobook_id, position) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_playlist_tracks (audiobook_id, track_id) VALUES (1, 10), (1, 11)`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_playback (track_id, audiobook_id, position_seconds, last_updated) VALUES (10, 1, 600, ?)`, time.Date(2026, 9, 25, 10, 0, 0, 0, time.UTC))
	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	ctx := context.Background()
	bookID, finishedTrack, currentTrack := int64(1), int64(10), int64(11)
	if _, err := service.SetActiveItem(ctx, nil, &bookID, &currentTrack); err != nil {
		t.Fatalf("select current chapter: %v", err)
	}

	result, err := service.Update(ctx, UpdateInput{AudiobookID: &bookID, TrackID: &finishedTrack, PositionSeconds: 0, DidSeek: true})
	if err != nil || result.Playback.PositionSeconds != 0 {
		t.Fatalf("reset replay position: %+v, %v", result, err)
	}
	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM audiobook_tracks WHERE id = 10`).Scan(&listened); err != nil || listened {
		t.Fatalf("replay did not clear listened state: %v, %v", listened, err)
	}
	active, err := service.GetActive(ctx)
	if err != nil || active == nil || active.AudiobookTrackID == nil || *active.AudiobookTrackID != currentTrack {
		t.Fatalf("replay position update changed active chapter: %+v, %v", active, err)
	}
	if _, err := service.SetActiveItem(ctx, nil, &bookID, &finishedTrack); err != nil {
		t.Fatalf("explicitly select replay chapter: %v", err)
	}
	active, err = service.GetActive(ctx)
	if err != nil || active == nil || active.AudiobookTrackID == nil || *active.AudiobookTrackID != finishedTrack {
		t.Fatalf("explicit replay selection did not take effect: %+v, %v", active, err)
	}
}

func playbackTestID(id int64) *int64 { return &id }

func playbackTestOptionalID(id int64) *int64 {
	if id == 0 {
		return nil
	}
	return &id
}
