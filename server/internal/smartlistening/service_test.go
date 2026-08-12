package smartlistening

import (
	"context"
	"errors"
	"io"
	"log"
	"path/filepath"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/downloads"
	"github.com/cross/mpod/server/internal/storage"
)

func TestRunOnceWaitsUntilDownloadScheduleIsDue(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()
	now := time.Date(2026, 8, 12, 9, 0, 0, 0, time.UTC)
	seedPlaylistItem(t, db, 1, now.Add(15*time.Second))

	fake := &fakeDownloader{}
	service := newTestService(db, fake, now)
	processed, err := service.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce failed: %v", err)
	}
	if processed || len(fake.downloaded) != 0 {
		t.Fatalf("expected no download before schedule, processed=%v downloads=%v", processed, fake.downloaded)
	}
}

func TestRunOnceDownloadsDuePlaylistItem(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()
	now := time.Date(2026, 8, 12, 9, 0, 15, 0, time.UTC)
	seedPlaylistItem(t, db, 1, now)

	fake := &fakeDownloader{db: db}
	service := newTestService(db, fake, now)
	processed, err := service.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce failed: %v", err)
	}
	if !processed || len(fake.downloaded) != 1 || fake.downloaded[0] != 1 {
		t.Fatalf("expected episode 1 downloaded, processed=%v downloads=%v", processed, fake.downloaded)
	}
}

func TestRunOnceReschedulesFailedDownload(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()
	now := time.Date(2026, 8, 12, 9, 0, 15, 0, time.UTC)
	seedPlaylistItem(t, db, 1, now)

	fake := &fakeDownloader{downloadErr: errors.New("network unavailable")}
	service := newTestService(db, fake, now)
	if processed, err := service.RunOnce(context.Background()); err != nil || !processed {
		t.Fatalf("expected failed item processed and rescheduled, processed=%v err=%v", processed, err)
	}

	var downloadAfter time.Time
	if err := db.SQL.QueryRow(`SELECT download_after FROM playlist WHERE episode_id = 1`).Scan(&downloadAfter); err != nil {
		t.Fatalf("query retry time: %v", err)
	}
	if !downloadAfter.Equal(now.Add(defaultRetryDelay)) {
		t.Fatalf("expected retry at %s, got %s", now.Add(defaultRetryDelay), downloadAfter)
	}
}

func TestRunOnceIgnoresPlaylistItemRemovedDuringUndoWindow(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()
	now := time.Date(2026, 8, 12, 9, 0, 15, 0, time.UTC)
	seedPlaylistItem(t, db, 1, now)
	if _, err := db.SQL.Exec(`DELETE FROM playlist WHERE episode_id = 1`); err != nil {
		t.Fatalf("remove playlist item: %v", err)
	}

	fake := &fakeDownloader{}
	service := newTestService(db, fake, now)
	processed, err := service.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce failed: %v", err)
	}
	if processed || len(fake.downloaded) != 0 {
		t.Fatalf("expected removed item ignored, processed=%v downloads=%v", processed, fake.downloaded)
	}
}

type fakeDownloader struct {
	db          *storage.DB
	downloaded  []int64
	deleted     []int64
	downloadErr error
}

func (f *fakeDownloader) Download(_ context.Context, episodeID int64) (downloads.EpisodeDownload, error) {
	f.downloaded = append(f.downloaded, episodeID)
	if f.downloadErr != nil {
		return downloads.EpisodeDownload{}, f.downloadErr
	}
	if f.db != nil {
		if _, err := f.db.SQL.Exec(`UPDATE episodes SET downloaded_path = 'downloaded.mp3' WHERE id = ?`, episodeID); err != nil {
			return downloads.EpisodeDownload{}, err
		}
	}
	return downloads.EpisodeDownload{ID: episodeID, Downloaded: true}, nil
}

func (f *fakeDownloader) Delete(_ context.Context, episodeID int64) (downloads.EpisodeDownload, error) {
	f.deleted = append(f.deleted, episodeID)
	return downloads.EpisodeDownload{ID: episodeID}, nil
}

func newTestService(db *storage.DB, downloader downloader, now time.Time) *Service {
	service := NewService(db.SQL, log.New(io.Discard, "", 0), downloader)
	service.now = func() time.Time { return now }
	return service
}

func seedPlaylistItem(t *testing.T, db *storage.DB, episodeID int64, downloadAfter time.Time) {
	t.Helper()
	if _, err := db.SQL.Exec(`INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`); err != nil {
		t.Fatalf("insert podcast: %v", err)
	}
	if _, err := db.SQL.Exec(`
		INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url)
		VALUES (?, 1, ?, 'Episode', 'https://example.com/episode.mp3')
	`, episodeID, episodeID); err != nil {
		t.Fatalf("insert episode: %v", err)
	}
	if _, err := db.SQL.Exec(`
		INSERT INTO playlist (episode_id, position, added_at, download_after)
		VALUES (?, 1, ?, ?)
	`, episodeID, downloadAfter.Add(-15*time.Second), downloadAfter); err != nil {
		t.Fatalf("insert playlist item: %v", err)
	}
}

func newTestDB(t *testing.T) *storage.DB {
	t.Helper()
	db, err := storage.Open(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	if err := storage.Migrate(db.SQL, "../../migrations"); err != nil {
		db.Close()
		t.Fatalf("storage.Migrate: %v", err)
	}
	return db
}
