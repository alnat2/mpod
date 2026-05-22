package episodes

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/storage"
)

func TestListByPodcastOrdersByPublishedAtDescAndMarksDownloaded(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	now := time.Date(2026, 4, 23, 10, 0, 0, 0, time.UTC)
	older := now.Add(-2 * time.Hour)

	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, downloaded_path, is_listened, published_at) VALUES (1, 1, 'ep-1', 'Older', 'https://example.com/1.mp3', 30, NULL, 1, ?)`, older)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, duration, downloaded_path, is_listened, published_at) VALUES (2, 1, 'ep-2', 'Newer', 'https://example.com/2.mp3', 60, '/tmp/download.mp3', 0, ?)`, now)

	service := NewService(db.SQL)
	items, err := service.ListByPodcast(context.Background(), 1)
	if err != nil {
		t.Fatalf("ListByPodcast failed: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 episodes, got %d", len(items))
	}
	if items[0].ID != 2 || !items[0].Downloaded {
		t.Fatalf("expected newer downloaded episode first, got %+v", items[0])
	}
	if items[0].Duration == nil || *items[0].Duration != 60 {
		t.Fatalf("expected duration 60, got %+v", items[0].Duration)
	}
	if items[1].ID != 1 || !items[1].IsListened {
		t.Fatalf("expected older listened episode second, got %+v", items[1])
	}
	if items[0].PublishedAt == nil || !items[0].PublishedAt.Equal(now) {
		t.Fatalf("expected publishedAt %v, got %+v", now, items[0].PublishedAt)
	}
}

func TestGetByIDReturnsEpisode(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	publishedAt := time.Date(2026, 4, 23, 8, 0, 0, 0, time.UTC)
	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, published_at) VALUES (1, 1, 'ep-1', 'Episode', 'https://example.com/1.mp3', ?)`, publishedAt)

	service := NewService(db.SQL)
	item, err := service.GetByID(context.Background(), 1)
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}
	if item.ID != 1 || item.Title != "Episode" || item.PodcastID != 1 {
		t.Fatalf("unexpected episode: %+v", item)
	}
	if item.PublishedAt == nil || !item.PublishedAt.Equal(publishedAt) {
		t.Fatalf("unexpected publishedAt: %+v", item.PublishedAt)
	}
}

func TestListByPodcastOrdersByIDDescWhenPublishedAtMatches(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	publishedAt := time.Date(2026, 4, 23, 8, 0, 0, 0, time.UTC)
	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, published_at) VALUES (1, 1, 'ep-1', 'Episode 1', 'https://example.com/1.mp3', ?)`, publishedAt)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, published_at) VALUES (2, 1, 'ep-2', 'Episode 2', 'https://example.com/2.mp3', ?)`, publishedAt)

	service := NewService(db.SQL)
	items, err := service.ListByPodcast(context.Background(), 1)
	if err != nil {
		t.Fatalf("ListByPodcast failed: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 episodes, got %d", len(items))
	}
	if items[0].ID != 2 || items[1].ID != 1 {
		t.Fatalf("expected descending id tie-breaker, got %+v", items)
	}
}

func TestGetByIDReturnsDownloadedDescriptionAndDuration(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	publishedAt := time.Date(2026, 4, 23, 8, 0, 0, 0, time.UTC)
	mustExec(t, db, `INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`)
	mustExec(t, db, `INSERT INTO episodes (id, podcast_id, external_episode_key, title, description, audio_url, duration, downloaded_path, published_at) VALUES (1, 1, 'ep-1', 'Episode', 'Shownotes', 'https://example.com/1.mp3', 90, '/tmp/file.mp3', ?)`, publishedAt)

	service := NewService(db.SQL)
	item, err := service.GetByID(context.Background(), 1)
	if err != nil {
		t.Fatalf("GetByID failed: %v", err)
	}
	if item.Description == nil || *item.Description != "Shownotes" {
		t.Fatalf("expected description to be loaded, got %+v", item.Description)
	}
	if item.Duration == nil || *item.Duration != 90 {
		t.Fatalf("expected duration to be loaded, got %+v", item.Duration)
	}
	if !item.Downloaded {
		t.Fatalf("expected downloaded flag to be true")
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
