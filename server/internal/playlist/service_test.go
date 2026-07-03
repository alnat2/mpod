package playlist

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/cross/mpod/server/internal/storage"
)

func TestAddIsIdempotent(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)

	service := NewService(db.SQL)
	if err := service.Add(context.Background(), 1); err != nil {
		t.Fatalf("first Add failed: %v", err)
	}
	if err := service.Add(context.Background(), 1); err != nil {
		t.Fatalf("second Add failed: %v", err)
	}

	var count int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&count); err != nil {
		t.Fatalf("count playlist rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 playlist row after duplicate add, got %d", count)
	}
}

func TestAddMarksListenedEpisodeUnlistened(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 1)`)

	service := NewService(db.SQL)
	if err := service.Add(context.Background(), 1); err != nil {
		t.Fatalf("Add failed: %v", err)
	}

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 1`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if listened {
		t.Fatalf("expected playlist add to mark episode unlistened")
	}
}

func TestDuplicateAddMarksExistingPlaylistEpisodeUnlistened(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, is_listened) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', 1)`)
	mustExec(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)

	service := NewService(db.SQL)
	if err := service.Add(context.Background(), 1); err != nil {
		t.Fatalf("Add failed: %v", err)
	}

	var listened bool
	if err := db.SQL.QueryRow(`SELECT is_listened FROM episodes WHERE id = 1`).Scan(&listened); err != nil {
		t.Fatalf("query listened state: %v", err)
	}
	if listened {
		t.Fatalf("expected duplicate playlist add to mark episode unlistened")
	}

	var count int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM playlist WHERE episode_id = 1`).Scan(&count); err != nil {
		t.Fatalf("count playlist rows: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected duplicate add to keep one playlist row, got %d", count)
	}
}

func TestRemoveNormalizesPositions(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Test', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url) VALUES (3, 1, 'ep-3', 'Episode 3', 'https://example.com/3.mp3')`)
	mustExec(t, db, `INSERT INTO playlist (episode_id, position) VALUES (1, 1)`)
	mustExec(t, db, `INSERT INTO playlist (episode_id, position) VALUES (2, 2)`)
	mustExec(t, db, `INSERT INTO playlist (episode_id, position) VALUES (3, 3)`)

	service := NewService(db.SQL)
	if err := service.Remove(context.Background(), 2); err != nil {
		t.Fatalf("Remove failed: %v", err)
	}

	rows, err := db.SQL.Query(`SELECT episode_id, position FROM playlist ORDER BY position ASC`)
	if err != nil {
		t.Fatalf("query playlist rows: %v", err)
	}
	defer rows.Close()

	var got [][2]int64
	for rows.Next() {
		var episodeID, position int64
		if err := rows.Scan(&episodeID, &position); err != nil {
			t.Fatalf("scan playlist row: %v", err)
		}
		got = append(got, [2]int64{episodeID, position})
	}
	want := [][2]int64{{1, 1}, {3, 2}}
	if len(got) != len(want) {
		t.Fatalf("expected %d playlist rows, got %d", len(want), len(got))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("row %d mismatch: got %v want %v", i, got[i], want[i])
		}
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

func mustExec(t *testing.T, db *storage.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.SQL.Exec(query, args...); err != nil {
		t.Fatalf("Exec %q failed: %v", query, err)
	}
}
