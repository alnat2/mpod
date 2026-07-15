package episodes

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/storage"
)

func TestSetListenedDeletesDownloadedFile(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExecActions(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExecActions(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir))
	if err := actions.SetListened(context.Background(), 1, true); err != nil {
		t.Fatalf("SetListened failed: %v", err)
	}

	var listened bool
	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT is_listened, downloaded_path FROM episodes WHERE id = 1`).Scan(&listened, &downloadedPath); err != nil {
		t.Fatalf("query episode state: %v", err)
	}
	if !listened {
		t.Fatalf("expected episode to be listened")
	}
	if downloadedPath.Valid {
		t.Fatalf("expected downloaded_path to be cleared, got %q", downloadedPath.String)
	}
	if _, err := os.Stat(downloadPath); !os.IsNotExist(err) {
		t.Fatalf("expected download file to be deleted, stat err=%v", err)
	}
	if count := playlistCountForEpisode(t, db, 1); count != 0 {
		t.Fatalf("expected episode to be removed from playlist, got %d playlist rows", count)
	}
}

func TestSetListenedFalseDoesNotDeleteDownload(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExecActions(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?, 1)`, downloadPath)
	mustExecActions(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir))
	if err := actions.SetListened(context.Background(), 1, false); err != nil {
		t.Fatalf("SetListened failed: %v", err)
	}

	var listened bool
	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT is_listened, downloaded_path FROM episodes WHERE id = 1`).Scan(&listened, &downloadedPath); err != nil {
		t.Fatalf("query episode state: %v", err)
	}
	if listened {
		t.Fatalf("expected episode to be unlistened")
	}
	if !downloadedPath.Valid || downloadedPath.String != downloadPath {
		t.Fatalf("expected downloaded_path to remain set, got %+v", downloadedPath)
	}
	if _, err := os.Stat(downloadPath); err != nil {
		t.Fatalf("expected file to remain, stat err=%v", err)
	}
	if count := playlistCountForEpisode(t, db, 1); count != 1 {
		t.Fatalf("expected episode to remain in playlist, got %d playlist rows", count)
	}
}

func TestSetListenedKeepsEpisodeUnlistenedWhenDownloadDeletionFails(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "problem-dir")
	if err := os.MkdirAll(downloadPath, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(downloadPath, "nested.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExecActions(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExecActions(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir))
	if err := actions.SetListened(context.Background(), 1, true); err == nil {
		t.Fatal("expected SetListened to fail")
	}

	var listened bool
	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT is_listened, downloaded_path FROM episodes WHERE id = 1`).Scan(&listened, &downloadedPath); err != nil {
		t.Fatalf("query episode state: %v", err)
	}
	if listened {
		t.Fatalf("expected episode to remain unlistened")
	}
	if !downloadedPath.Valid || downloadedPath.String != downloadPath {
		t.Fatalf("expected downloaded_path to remain set, got %+v", downloadedPath)
	}
	if count := playlistCountForEpisode(t, db, 1); count != 1 {
		t.Fatalf("expected episode to remain in playlist, got %d playlist rows", count)
	}
}

func TestSetListenedMissingEpisode(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir()))
	if err := actions.SetListened(context.Background(), 999, true); err != ErrEpisodeNotFound {
		t.Fatalf("expected ErrEpisodeNotFound, got %v", err)
	}
}

func TestMarkPodcastListenedAppliesLifecycleRules(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPathOne := filepath.Join(downloadDir, "1", "one.mp3")
	downloadPathTwo := filepath.Join(downloadDir, "1", "two.mp3")
	for _, path := range []string{downloadPathOne, downloadPathTwo} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
		if err := os.WriteFile(path, []byte("audio"), 0o644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
	}

	mustExecActions(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml'), (2, 'Other', 'https://example.com/other.xml')`)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'One', 'https://example.com/1.mp3', ?, 0)`, downloadPathOne)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (2, 1, 'ep-2', 'Two', 'https://example.com/2.mp3', ?, 1)`, downloadPathTwo)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, is_listened) VALUES (3, 2, 'ep-3', 'Three', 'https://example.com/3.mp3', 0)`)
	mustExecActions(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1), (2, 2), (3, 3)`)
	mustExecActions(t, db, `INSERT INTO active_playback (singleton_id, episode_id, last_updated) VALUES (1, 1, CURRENT_TIMESTAMP)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir))
	result, err := actions.MarkPodcastListened(context.Background(), 1)
	if err != nil {
		t.Fatalf("MarkPodcastListened failed: %v", err)
	}
	if result.MarkedEpisodes != 1 {
		t.Fatalf("expected 1 newly marked episode, got %d", result.MarkedEpisodes)
	}

	assertEpisodeListened(t, db, 1, true)
	assertEpisodeListened(t, db, 2, true)
	assertEpisodeListened(t, db, 3, false)
	assertEpisodeDownloadedPathCleared(t, db, 1)
	assertEpisodeDownloadedPathCleared(t, db, 2)
	if count := playlistCountForPodcast(t, db, 1); count != 0 {
		t.Fatalf("expected podcast playlist entries removed, got %d", count)
	}
	if count := playlistCountForPodcast(t, db, 2); count != 1 {
		t.Fatalf("expected other podcast playlist entry to remain, got %d", count)
	}
	if active := activeEpisodeID(t, db); active.Valid {
		t.Fatalf("expected active playback to clear, got %d", active.Int64)
	}
	for _, path := range []string{downloadPathOne, downloadPathTwo} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("expected %s to be deleted, stat err=%v", path, err)
		}
	}
}

func TestMarkPodcastListenedIsIdempotent(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	mustExecActions(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, is_listened) VALUES (1, 1, 'ep-1', 'One', 'https://example.com/1.mp3', 0)`)
	mustExecActions(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir()))
	first, err := actions.MarkPodcastListened(context.Background(), 1)
	if err != nil {
		t.Fatalf("first MarkPodcastListened failed: %v", err)
	}
	second, err := actions.MarkPodcastListened(context.Background(), 1)
	if err != nil {
		t.Fatalf("second MarkPodcastListened failed: %v", err)
	}
	if first.MarkedEpisodes != 1 || second.MarkedEpisodes != 0 {
		t.Fatalf("expected marked counts 1 then 0, got %d then %d", first.MarkedEpisodes, second.MarkedEpisodes)
	}
}

func TestMarkPodcastListenedMissingPodcast(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, t.TempDir()))
	if _, err := actions.MarkPodcastListened(context.Background(), 999); err != ErrPodcastNotFound {
		t.Fatalf("expected ErrPodcastNotFound, got %v", err)
	}
}

func TestMarkPodcastListenedDoesNotDeleteFilesBeforeSuccessfulDBUpdate(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "1", "episode.mp3")
	if err := os.MkdirAll(filepath.Dir(downloadPath), 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(downloadPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExecActions(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'One', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExecActions(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExecActions(t, db, `INSERT INTO active_playback (singleton_id, episode_id, last_updated) VALUES (1, 1, CURRENT_TIMESTAMP)`)

	ctx, cancel := context.WithCancel(context.Background())
	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir))
	actions.afterMarkPodcastDownloadPathsLoad = func() {
		cancel()
	}
	if _, err := actions.MarkPodcastListened(ctx, 1); err == nil {
		t.Fatal("expected MarkPodcastListened to fail")
	}
	assertEpisodeListened(t, db, 1, false)
	if count := playlistCountForEpisode(t, db, 1); count != 1 {
		t.Fatalf("expected playlist entry to remain, got %d", count)
	}
	if _, err := os.Stat(downloadPath); err != nil {
		t.Fatalf("expected file not to be deleted before successful DB commit, stat err=%v", err)
	}
}

func TestMarkPodcastListenedKeepsCommittedDBWhenPostCommitFileDeletionFails(t *testing.T) {
	db := newActionsTestDB(t)
	defer db.Close()

	downloadDir := t.TempDir()
	downloadPath := filepath.Join(downloadDir, "problem-dir")
	if err := os.MkdirAll(downloadPath, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if err := os.WriteFile(filepath.Join(downloadPath, "nested.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	mustExecActions(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExecActions(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path, is_listened) VALUES (1, 1, 'ep-1', 'One', 'https://example.com/1.mp3', ?, 0)`, downloadPath)
	mustExecActions(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExecActions(t, db, `INSERT INTO active_playback (singleton_id, episode_id, last_updated) VALUES (1, 1, CURRENT_TIMESTAMP)`)

	actions := NewActions(db.SQL, downloads.NewService(db.SQL, nil, downloadDir))
	result, err := actions.MarkPodcastListened(context.Background(), 1)
	if err != nil {
		t.Fatalf("MarkPodcastListened failed: %v", err)
	}
	if result.MarkedEpisodes != 1 {
		t.Fatalf("expected 1 marked episode, got %d", result.MarkedEpisodes)
	}

	assertEpisodeListened(t, db, 1, true)
	assertEpisodeDownloadedPathCleared(t, db, 1)
	if count := playlistCountForEpisode(t, db, 1); count != 0 {
		t.Fatalf("expected playlist entry to be removed, got %d", count)
	}
	if active := activeEpisodeID(t, db); active.Valid {
		t.Fatalf("expected active playback to clear, got %+v", active)
	}
	if _, err := os.Stat(downloadPath); err != nil {
		t.Fatalf("expected orphan file to remain after failed cleanup, stat err=%v", err)
	}
}

func newActionsTestDB(t *testing.T) *storage.DB {
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

func assertEpisodeListened(t *testing.T, db *storage.DB, episodeID int64, want bool) {
	t.Helper()

	var got bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = ?`, episodeID).Scan(&got); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if got != want {
		t.Fatalf("expected episode %d listened=%v, got %v", episodeID, want, got)
	}
}

func assertEpisodeDownloadedPathCleared(t *testing.T, db *storage.DB, episodeID int64) {
	t.Helper()

	var downloadedPath sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = ?`, episodeID).Scan(&downloadedPath); err != nil {
		t.Fatalf("query downloaded path: %v", err)
	}
	if downloadedPath.Valid {
		t.Fatalf("expected episode %d downloaded_path to clear, got %q", episodeID, downloadedPath.String)
	}
}

func mustExecActions(t *testing.T, db *storage.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.SQL.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}

func playlistCountForEpisode(t *testing.T, db *storage.DB, episodeID int64) int {
	t.Helper()

	var count int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = ?`, episodeID).Scan(&count); err != nil {
		t.Fatalf("query playlist count: %v", err)
	}
	return count
}

func playlistCountForPodcast(t *testing.T, db *storage.DB, podcastID int64) int {
	t.Helper()

	var count int
	if err := db.SQL.QueryRow(`
		SELECT COUNT(*)
		FROM playlist
		JOIN episodes ON episodes.id = playlist.episode_id
		WHERE episodes.podcast_id = ?
	`, podcastID).Scan(&count); err != nil {
		t.Fatalf("query playlist count: %v", err)
	}
	return count
}

func activeEpisodeID(t *testing.T, db *storage.DB) sql.NullInt64 {
	t.Helper()

	var episodeID sql.NullInt64
	if err := db.SQL.QueryRow(`SELECT episode_id FROM active_playback WHERE singleton_id = 1`).Scan(&episodeID); err != nil {
		t.Fatalf("query active playback: %v", err)
	}
	return episodeID
}
