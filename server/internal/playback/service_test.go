package playback

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/episodes"
	"github.com/cross/mpod/server/internal/playlist"
	"github.com/cross/mpod/server/internal/storage"
)

func TestUpdateIgnoresStaleClientUpdate(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	currentTime := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, ?)`, currentTime)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return currentTime.Add(5 * time.Minute) }

	staleTime := currentTime.Add(-1 * time.Minute)
	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 80,
		ClientUpdatedAt: &staleTime,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.Playback.PositionSeconds != 120 {
		t.Fatalf("expected stale update to preserve position 120, got %d", result.Playback.PositionSeconds)
	}
}

func TestUpdateProcessesCompletionAfterNewerServerTimestamp(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1), (2, 2)`)

	serverTime := time.Date(2026, 8, 10, 10, 0, 0, 0, time.UTC)
	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return serverTime }

	progressClientTime := serverTime.Add(-100 * time.Millisecond)
	if _, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       2,
		PositionSeconds: 590,
		DurationSeconds: 600,
		ClientUpdatedAt: &progressClientTime,
	}); err != nil {
		t.Fatalf("progress Update returned error: %v", err)
	}

	completionClientTime := serverTime.Add(-50 * time.Millisecond)
	service.now = func() time.Time { return serverTime.Add(100 * time.Millisecond) }
	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       2,
		PositionSeconds: 600,
		DurationSeconds: 600,
		Completed:       true,
		ClientUpdatedAt: &completionClientTime,
	})
	if err != nil {
		t.Fatalf("completion Update returned error: %v", err)
	}

	if result.NextEpisodeID == nil || *result.NextEpisodeID != 1 {
		t.Fatalf("expected fallback episode 1, got %v", result.NextEpisodeID)
	}

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 2`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if !listened {
		t.Fatal("expected completed episode to be listened")
	}

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 2`).Scan(&playlistCount); err != nil {
		t.Fatalf("query playlist state: %v", err)
	}
	if playlistCount != 0 {
		t.Fatalf("expected completed episode removed from playlist, got %d rows", playlistCount)
	}
}

func TestListQueueReturnsPlaybackReadyEpisodesInPlaylistOrder(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	updatedAt := time.Date(2026, 7, 13, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url, image_url) VALUES (1, 'Test Podcast', 'https://example.com/feed.xml', 'https://example.com/artwork.png')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, description, audio_url, duration, is_listened, published_at) VALUES (1, 1, 'ep-1', 'Episode 1', '<p>Safe notes</p>', 'https://example.com/1.mp3', 600, 0, ?)`, updatedAt)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, ?)`, updatedAt)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	queue, err := service.ListQueue(context.Background())
	if err != nil {
		t.Fatalf("ListQueue failed: %v", err)
	}
	if len(queue) != 1 {
		t.Fatalf("expected one queue episode, got %d", len(queue))
	}

	item := queue[0]
	if item.Title != "Episode 1" || item.PodcastTitle != "Test Podcast" {
		t.Fatalf("unexpected queue item: %+v", item)
	}
	if item.PodcastImageURL == nil || *item.PodcastImageURL != "/api/podcasts/1/image" {
		t.Fatalf("expected proxied artwork path, got %+v", item.PodcastImageURL)
	}
	if item.ShowNotes == nil || *item.ShowNotes != "Safe notes" {
		t.Fatalf("expected sanitized show notes, got %+v", item.ShowNotes)
	}
	if item.Playback == nil || item.Playback.PositionSeconds != 120 || !item.Playback.LastUpdated.Equal(updatedAt) {
		t.Fatalf("unexpected playback state: %+v", item.Playback)
	}
}

func TestGetActiveInitiallyReturnsNil(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	active, err := service.GetActive(context.Background())
	if err != nil {
		t.Fatalf("GetActive failed: %v", err)
	}
	if active != nil {
		t.Fatalf("expected nil active playback, got %+v", active)
	}
}

func TestSetActiveStoresAndReplacesPlaylistEpisode(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)
	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3')`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1), (2, 2)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return now }

	first, err := service.SetActive(context.Background(), 1)
	if err != nil {
		t.Fatalf("SetActive first failed: %v", err)
	}
	if first.EpisodeID == nil || *first.EpisodeID != 1 || !first.LastUpdated.Equal(now) {
		t.Fatalf("unexpected first active state: %+v", first)
	}

	service.now = func() time.Time { return now.Add(time.Minute) }
	repeated, err := service.SetActive(context.Background(), 1)
	if err != nil {
		t.Fatalf("SetActive repeat failed: %v", err)
	}
	if repeated.EpisodeID == nil || *repeated.EpisodeID != 1 || !repeated.LastUpdated.Equal(now.Add(time.Minute)) {
		t.Fatalf("expected idempotent refresh of same episode, got %+v", repeated)
	}

	service.now = func() time.Time { return now.Add(2 * time.Minute) }
	replacement, err := service.SetActive(context.Background(), 2)
	if err != nil {
		t.Fatalf("SetActive replacement failed: %v", err)
	}
	if replacement.EpisodeID == nil || *replacement.EpisodeID != 2 || !replacement.LastUpdated.Equal(now.Add(2*time.Minute)) {
		t.Fatalf("expected episode 2 replacement, got %+v", replacement)
	}

	active, err := service.GetActive(context.Background())
	if err != nil {
		t.Fatalf("GetActive failed: %v", err)
	}
	if active == nil || active.EpisodeID == nil || *active.EpisodeID != 2 {
		t.Fatalf("expected active episode 2, got %+v", active)
	}
}

func TestSetActiveRejectsUnknownEpisode(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	if _, err := service.SetActive(context.Background(), 999); !errors.Is(err, ErrEpisodeNotFound) {
		t.Fatalf("expected ErrEpisodeNotFound, got %v", err)
	}
}

func TestSetActiveRejectsEpisodeOutsidePlaylist(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	if _, err := service.SetActive(context.Background(), 1); !errors.Is(err, ErrEpisodeNotInPlaylist) {
		t.Fatalf("expected ErrEpisodeNotInPlaylist, got %v", err)
	}
}

func TestUpdateCompletionAppliesSideEffects(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir)), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 4, 22, 11, 0, 0, 0, time.UTC) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 2390,
		DurationSeconds: 2400,
		Completed:       true,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.Playback.PositionSeconds != 2400 {
		t.Fatalf("expected completion to clamp position to 2400, got %d", result.Playback.PositionSeconds)
	}
	if result.NextEpisodeID != nil {
		t.Fatalf("expected no fallback episode, got %d", *result.NextEpisodeID)
	}

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 1`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if !listened {
		t.Fatalf("expected episode to be marked listened")
	}

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&playlistCount); err != nil {
		t.Fatalf("query playlist count: %v", err)
	}
	if playlistCount != 0 {
		t.Fatalf("expected episode to be removed from playlist")
	}

	var downloadedPathAfter sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&downloadedPathAfter); err != nil {
		t.Fatalf("query downloaded_path: %v", err)
	}
	if downloadedPathAfter.Valid {
		t.Fatalf("expected downloaded_path to be cleared, got %v", downloadedPathAfter.String)
	}

	if _, err := os.Stat(downloadPath); !os.IsNotExist(err) {
		t.Fatalf("expected file to be deleted, stat err=%v", err)
	}
}

func TestUpdateNearEndProgressDoesNotCompleteEpisode(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir)), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 7, 28, 10, 0, 0, 0, time.UTC) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 2390,
		DurationSeconds: 2400,
		Completed:       false,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}
	if result.Playback.PositionSeconds != 2390 {
		t.Fatalf("expected near-end progress to be stored as-is, got %d", result.Playback.PositionSeconds)
	}
	if result.NextEpisodeID != nil {
		t.Fatalf("expected no fallback episode, got %d", *result.NextEpisodeID)
	}

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 1`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if listened {
		t.Fatalf("expected episode to remain unlistened")
	}

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&playlistCount); err != nil {
		t.Fatalf("query playlist count: %v", err)
	}
	if playlistCount != 1 {
		t.Fatalf("expected episode to remain in playlist")
	}
	if _, err := os.Stat(downloadPath); err != nil {
		t.Fatalf("expected file to remain, stat err=%v", err)
	}
}

func TestActiveClearsWhenEpisodeLeavesPlaylist(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	playlistService := playlist.NewService(db.SQL)
	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlistService)
	if _, err := service.SetActive(context.Background(), 1); err != nil {
		t.Fatalf("SetActive failed: %v", err)
	}
	if err := playlistService.Remove(context.Background(), 1); err != nil {
		t.Fatalf("playlist Remove failed: %v", err)
	}

	active, err := service.GetActive(context.Background())
	if err != nil {
		t.Fatalf("GetActive failed: %v", err)
	}
	if active != nil {
		t.Fatalf("expected active playback to clear after playlist removal, got %+v", active)
	}
}

func TestActiveClearsWhenEpisodeIsMarkedListened(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 0)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	downloadService := downloads.NewService(db.SQL, nil, t.TempDir())
	episodeActions := episodes.NewActions(db.SQL, downloadService)
	service := NewService(db.SQL, episodeActions, playlist.NewService(db.SQL))
	if _, err := service.SetActive(context.Background(), 1); err != nil {
		t.Fatalf("SetActive failed: %v", err)
	}
	if err := episodeActions.SetListened(context.Background(), 1, true); err != nil {
		t.Fatalf("SetListened failed: %v", err)
	}

	active, err := service.GetActive(context.Background())
	if err != nil {
		t.Fatalf("GetActive failed: %v", err)
	}
	if active != nil {
		t.Fatalf("expected active playback to clear after mark listened, got %+v", active)
	}
}

func TestActiveClearsWhenPlaybackCompletionRuns(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 300, 0)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	if _, err := service.SetActive(context.Background(), 1); err != nil {
		t.Fatalf("SetActive failed: %v", err)
	}
	if _, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 300,
		DurationSeconds: 300,
		Completed:       true,
	}); err != nil {
		t.Fatalf("Update completion failed: %v", err)
	}

	active, err := service.GetActive(context.Background())
	if err != nil {
		t.Fatalf("GetActive failed: %v", err)
	}
	if active != nil {
		t.Fatalf("expected active playback to clear after completion, got %+v", active)
	}
}

func TestActiveClearsWhenPodcastCascadeDeletesEpisode(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	if _, err := service.SetActive(context.Background(), 1); err != nil {
		t.Fatalf("SetActive failed: %v", err)
	}
	mustExec(t, db.SQL, `DELETE FROM podcasts WHERE id = 1`)

	active, err := service.GetActive(context.Background())
	if err != nil {
		t.Fatalf("GetActive failed: %v", err)
	}
	if active != nil {
		t.Fatalf("expected active playback to clear after podcast delete, got %+v", active)
	}
}

func TestUpdateAdvancesPositionWhenProgressMovesForward(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	currentTime := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, ?)`, currentTime)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return currentTime.Add(5 * time.Minute) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 180,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.Playback.PositionSeconds != 180 {
		t.Fatalf("expected position to advance to 180, got %d", result.Playback.PositionSeconds)
	}
	if !result.Playback.LastUpdated.Equal(currentTime.Add(5 * time.Minute)) {
		t.Fatalf("expected last updated to move forward, got %v", result.Playback.LastUpdated)
	}
}

func TestUpdateAllowsLargeBackwardSeekWhenExplicit(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	currentTime := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 240, ?)`, currentTime)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return currentTime.Add(5 * time.Minute) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 120,
		DidSeek:         true,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.Playback.PositionSeconds != 120 {
		t.Fatalf("expected explicit seek to persist position 120, got %d", result.Playback.PositionSeconds)
	}
}

func TestUpdateIgnoresBackwardDriftWithoutSeek(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	currentTime := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 240, ?)`, currentTime)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return currentTime.Add(5 * time.Minute) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 120,
		DidSeek:         false,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.Playback.PositionSeconds != 240 {
		t.Fatalf("expected drifted backward update to preserve position 240, got %d", result.Playback.PositionSeconds)
	}
}

func TestUpdateCompletionSelectsTopmostEarlierUnlistenedEpisodeWhenFinishingLastPlaylistItem(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "3", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, downloaded_path, is_listened) VALUES (3, 1, 'ep-3', 'Episode 3', 'https://example.com/3.mp3', 600, ?, 0)`, downloadPath)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (2, 2)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (3, 3)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir)), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       3,
		PositionSeconds: 600,
		DurationSeconds: 600,
		Completed:       true,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.NextEpisodeID == nil || *result.NextEpisodeID != 1 {
		t.Fatalf("expected fallback episode 1, got %v", result.NextEpisodeID)
	}

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&playlistCount); err != nil {
		t.Fatalf("query playlist count: %v", err)
	}
	if playlistCount != 1 {
		t.Fatalf("expected fallback episode to remain in playlist, got %d rows", playlistCount)
	}

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 1`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if listened {
		t.Fatalf("expected fallback episode to remain unlistened")
	}

	var playbackCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playback WHERE episode_id = 1`).Scan(&playbackCount); err != nil {
		t.Fatalf("query playback count: %v", err)
	}
	if playbackCount != 0 {
		t.Fatalf("expected fallback selection not to create playback record, got %d", playbackCount)
	}
}

func TestUpdateCompletionReturnsNoFallbackWhenNoEarlierEligibleEpisodeExists(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 600, 1)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (2, 2)`)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, CURRENT_TIMESTAMP)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       2,
		PositionSeconds: 600,
		DurationSeconds: 600,
		Completed:       true,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.NextEpisodeID != nil {
		t.Fatalf("expected no fallback episode, got %d", *result.NextEpisodeID)
	}
}

func TestUpdateCompletionDoesNotUseFallbackWhenFinishedEpisodeIsNotLastPlaylistItem(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, is_listened) VALUES (3, 1, 'ep-3', 'Episode 3', 'https://example.com/3.mp3', 600, 0)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (2, 2)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (3, 3)`)
	mustExec(t, db.SQL, `INSERT INTO playback (episode_id, position_seconds, last_updated) VALUES (1, 120, CURRENT_TIMESTAMP)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 7, 10, 10, 0, 0, 0, time.UTC) }

	result, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       2,
		PositionSeconds: 600,
		DurationSeconds: 600,
		Completed:       true,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}

	if result.NextEpisodeID != nil {
		t.Fatalf("expected no fallback episode, got %d", *result.NextEpisodeID)
	}
}

func TestUpdateCompletionKeepsEpisodeInPlaylistWhenDownloadDeletionFails(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "problem-dir")
	if err := os.MkdirAll(downloadPath, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(downloadPath, "nested.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir)), playlist.NewService(db.SQL))
	service.now = func() time.Time { return time.Date(2026, 4, 22, 11, 0, 0, 0, time.UTC) }

	if _, err := service.Update(context.Background(), UpdateInput{
		EpisodeID:       1,
		PositionSeconds: 300,
		DurationSeconds: 300,
		Completed:       true,
	}); err == nil {
		t.Fatal("expected Update to fail")
	}

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 1`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if listened {
		t.Fatalf("expected episode to remain unlistened")
	}

	var playlistCount int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&playlistCount); err != nil {
		t.Fatalf("query playlist count: %v", err)
	}
	if playlistCount != 1 {
		t.Fatalf("expected episode to remain in playlist, got %d rows", playlistCount)
	}
}

func TestAudiobookPlaybackGetAndUpdate(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO audiobooks (id, title, author, rel_path, total_duration) VALUES (1, 'Book 1', 'Author 1', 'Book 1', 3600)`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_tracks (id, audiobook_id, track_number, title, rel_path, file_path, duration) VALUES (10, 1, 1, 'Track 1', 'Book 1/1.mp3', '/path/1.mp3', 1800)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (position, audiobook_id) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_playlist_tracks (audiobook_id, track_id) VALUES (1, 10)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))

	abID := int64(1)
	trackID := int64(10)
	// 1. Update using an explicitly typed audiobook target.
	result, err := service.Update(context.Background(), UpdateInput{
		AudiobookID:     &abID,
		TrackID:         &trackID,
		PositionSeconds: 250,
		DurationSeconds: 1800,
	})
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}
	if result.Playback.PositionSeconds != 250 {
		t.Fatalf("expected position 250, got %d", result.Playback.PositionSeconds)
	}

	// 2. Get using an explicitly typed audiobook target.
	state, err := service.GetAudiobook(context.Background(), 1, &trackID)
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if state == nil {
		t.Fatalf("expected non-nil state")
	}
	if state.PositionSeconds != 250 {
		t.Fatalf("expected position 250, got %d", state.PositionSeconds)
	}
}

func TestTypedPlaybackTargetsCanShareNumericID(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExec(t, db.SQL, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'episode-1', 'Episode', 'https://example.com/episode.mp3')`)
	mustExec(t, db.SQL, `INSERT INTO audiobooks (id, title, author, rel_path) VALUES (1, 'Book', 'Author', 'Author/Book')`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_tracks (id, audiobook_id, track_number, title, rel_path, file_path, duration) VALUES (10, 1, 1, 'Chapter', 'Author/Book/1.mp3', '/book/1.mp3', 300)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (audiobook_id, position) VALUES (1, 2)`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_playlist_tracks (audiobook_id, track_id) VALUES (1, 10)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))
	if _, err := service.Update(context.Background(), UpdateInput{EpisodeID: 1, PositionSeconds: 40}); err != nil {
		t.Fatalf("save episode playback: %v", err)
	}
	bookID, trackID := int64(1), int64(10)
	if _, err := service.Update(context.Background(), UpdateInput{AudiobookID: &bookID, TrackID: &trackID, PositionSeconds: 90}); err != nil {
		t.Fatalf("save audiobook playback: %v", err)
	}

	episodeState, err := service.GetEpisode(context.Background(), 1)
	if err != nil || episodeState == nil || episodeState.EpisodeID != 1 || episodeState.AudiobookID != 0 || episodeState.TrackID != 0 || episodeState.PositionSeconds != 40 {
		t.Fatalf("expected episode position 40, got %+v, err=%v", episodeState, err)
	}
	bookState, err := service.GetAudiobook(context.Background(), 1, &trackID)
	if err != nil || bookState == nil || bookState.EpisodeID != 0 || bookState.AudiobookID != 1 || bookState.TrackID != 10 || bookState.PositionSeconds != 90 {
		t.Fatalf("expected audiobook position 90, got %+v, err=%v", bookState, err)
	}
}

func TestMultiTrackAudiobookPlaybackAndTrackSwitching(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `INSERT INTO audiobooks (id, title, author, rel_path, total_duration) VALUES (1, 'Book 1', 'Author 1', 'Book 1', 5400)`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_tracks (id, audiobook_id, track_number, title, rel_path, file_path, duration) VALUES (10, 1, 1, 'Track 1', 'Book 1/1.mp3', '/path/1.mp3', 1800)`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_tracks (id, audiobook_id, track_number, title, rel_path, file_path, duration) VALUES (11, 1, 2, 'Track 2', 'Book 1/2.mp3', '/path/2.mp3', 1800)`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_tracks (id, audiobook_id, track_number, title, rel_path, file_path, duration) VALUES (12, 1, 3, 'Track 3', 'Book 1/3.mp3', '/path/3.mp3', 1800)`)
	mustExec(t, db.SQL, `INSERT INTO playlist (position, audiobook_id) VALUES (1, 1)`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_playlist_tracks (audiobook_id, track_id) VALUES (1, 10), (1, 11), (1, 12)`)

	service := NewService(db.SQL, episodes.NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir())), playlist.NewService(db.SQL))

	// 1. Initial queue returns first track (10) at 0s
	queue, err := service.ListQueue(context.Background())
	if err != nil {
		t.Fatalf("ListQueue error: %v", err)
	}
	if len(queue) != 1 || *queue[0].TrackID != 10 || queue[0].Playback.PositionSeconds != 0 {
		t.Fatalf("expected track 10 at 0s, got track %v at %v", queue[0].TrackID, queue[0].Playback.PositionSeconds)
	}

	// 2. Play Track 10 and save 350s
	abID := int64(1)
	track10ID := int64(10)
	_, err = service.Update(context.Background(), UpdateInput{
		AudiobookID:     &abID,
		TrackID:         &track10ID,
		PositionSeconds: 350,
		DurationSeconds: 1800,
	})
	if err != nil {
		t.Fatalf("Update Track 10 error: %v", err)
	}

	// 3. User switches to Track 11 (Chapter 2)
	track11ID := int64(11)
	_, err = service.SetActiveItem(context.Background(), nil, &abID, &track11ID)
	if err != nil {
		t.Fatalf("SetActiveItem Track 11 error: %v", err)
	}

	// 4. Queue should now return Track 11 at 0s (NOT 350s from Track 10!)
	queue, err = service.ListQueue(context.Background())
	if err != nil {
		t.Fatalf("ListQueue error: %v", err)
	}
	if len(queue) != 1 || *queue[0].TrackID != 11 || queue[0].Playback.PositionSeconds != 0 {
		t.Fatalf("expected track 11 at 0s, got track %v at %v", queue[0].TrackID, queue[0].Playback.PositionSeconds)
	}

	// 5. Play Track 11 and save 120s
	_, err = service.Update(context.Background(), UpdateInput{
		AudiobookID:     &abID,
		TrackID:         &track11ID,
		PositionSeconds: 120,
		DurationSeconds: 1800,
	})
	if err != nil {
		t.Fatalf("Update Track 11 error: %v", err)
	}

	// 6. Get for book ID 1 should return 120s (active Track 11's position)
	state, err := service.GetAudiobook(context.Background(), 1, &track11ID)
	if err != nil || state == nil || state.PositionSeconds != 120 {
		t.Fatalf("expected active book position 120, got %v", state)
	}

	// 7. Switch back to Track 10 (Chapter 1)
	_, err = service.SetActiveItem(context.Background(), nil, &abID, &track10ID)
	if err != nil {
		t.Fatalf("SetActiveItem Track 10 error: %v", err)
	}

	// 8. Queue should now return Track 10 at 350s
	queue, err = service.ListQueue(context.Background())
	if err != nil {
		t.Fatalf("ListQueue error: %v", err)
	}
	if len(queue) != 1 || *queue[0].TrackID != 10 || queue[0].Playback.PositionSeconds != 350 {
		t.Fatalf("expected track 10 at 350s, got track %v at %v", queue[0].TrackID, queue[0].Playback.PositionSeconds)
	}

	// 9. Complete Track 10 -> should auto-advance active track to Track 11
	updateRes, err := service.Update(context.Background(), UpdateInput{
		AudiobookID:     &abID,
		TrackID:         &track10ID,
		PositionSeconds: 1800,
		DurationSeconds: 1800,
		Completed:       true,
	})
	if err != nil {
		t.Fatalf("Update completed Track 10 error: %v", err)
	}
	if updateRes.NextTrackID == nil || *updateRes.NextTrackID != 11 {
		t.Fatalf("expected next track 11, got %v", updateRes.NextTrackID)
	}

	// 10. Queue should now return Track 11 with its previously saved 120s
	queue, err = service.ListQueue(context.Background())
	if err != nil {
		t.Fatalf("ListQueue error: %v", err)
	}
	if len(queue) != 1 || *queue[0].TrackID != 11 || queue[0].Playback.PositionSeconds != 120 {
		t.Fatalf("expected track 11 at 120s, got track %v at %v", queue[0].TrackID, queue[0].Playback.PositionSeconds)
	}
}

func TestIndividualTrackInQueue(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db.SQL, `
		INSERT INTO audiobooks (id, title, author, rel_path, total_duration)
		VALUES (1, 'Dune', 'Frank Herbert', 'Frank Herbert/Dune', 3600);
	`)
	mustExec(t, db.SQL, `
		INSERT INTO audiobook_tracks (id, audiobook_id, track_number, title, rel_path, file_path, duration)
		VALUES
			(10, 1, 1, 'Chapter 1', 'Frank Herbert/Dune/01.mp3', '/abs/01.mp3', 1800),
			(11, 1, 2, 'Chapter 2', 'Frank Herbert/Dune/02.mp3', '/abs/02.mp3', 1800);
	`)

	// Add individual track 11 as membership of one parent queue item.
	mustExec(t, db.SQL, `INSERT INTO playlist (audiobook_id, position) VALUES (1, 1);`)
	mustExec(t, db.SQL, `INSERT INTO audiobook_playlist_tracks (audiobook_id, track_id) VALUES (1, 11);`)

	downloadsService := downloads.NewService(db.SQL, nil, t.TempDir())
	episodeActions := episodes.NewActions(db.SQL, downloadsService)
	playlistService := playlist.NewService(db.SQL)
	service := NewService(db.SQL, episodeActions, playlistService)

	queue, err := service.ListQueue(context.Background())
	if err != nil {
		t.Fatalf("ListQueue error: %v", err)
	}
	if len(queue) != 1 {
		t.Fatalf("expected 1 queue item, got %d", len(queue))
	}
	if queue[0].Title != "Dune" || *queue[0].TrackID != 11 || queue[0].TrackCount != 1 {
		t.Fatalf("unexpected queue item for individual track: %+v", queue[0])
	}
	if !queue[0].HasChapters {
		t.Fatalf("expected folder-backed audiobook to retain chapter navigation with one selected track")
	}

	// Set active
	tr11 := int64(11)
	active, err := service.SetActiveItem(context.Background(), nil, nil, &tr11)
	if err != nil {
		t.Fatalf("SetActiveItem for track 11 error: %v", err)
	}
	if active == nil || active.AudiobookTrackID == nil || *active.AudiobookTrackID != 11 {
		t.Fatalf("unexpected active state: %+v", active)
	}
}

func newTestDB(t *testing.T) *storage.DB {
	t.Helper()

	path := filepath.Join(t.TempDir(), "test.sqlite")
	db, err := storage.Open(path)
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	if err := storage.Migrate(db.SQL, "../../migrations"); err != nil {
		t.Fatalf("storage.Migrate: %v", err)
	}
	return db
}

func mustExec(t *testing.T, db execer, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}

type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}
