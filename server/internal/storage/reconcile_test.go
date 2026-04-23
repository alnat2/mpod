package storage

import (
	"bytes"
	"database/sql"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReconcileDownloadsClearsMissingPathAndLogs(t *testing.T) {
	db := newReconcileTestDB(t)
	defer db.Close()

	existingPath := filepath.Join(t.TempDir(), "existing.mp3")
	if err := os.WriteFile(existingPath, []byte("audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	missingPath := filepath.Join(t.TempDir(), "missing.mp3")
	if _, err := db.SQL.Exec(`INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml')`); err != nil {
		t.Fatalf("insert podcast: %v", err)
	}
	if _, err := db.SQL.Exec(`INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url, downloaded_path) VALUES (1, 1, 'ep-1', 'Existing', 'https://example.com/1.mp3', ?), (2, 1, 'ep-2', 'Missing', 'https://example.com/2.mp3', ?)`, existingPath, missingPath); err != nil {
		t.Fatalf("insert episodes: %v", err)
	}

	var logs bytes.Buffer
	logger := log.New(&logs, "", 0)
	if err := ReconcileDownloads(db.SQL, logger); err != nil {
		t.Fatalf("ReconcileDownloads failed: %v", err)
	}

	var existingAfter sql.NullString
	var missingAfter sql.NullString
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 1`).Scan(&existingAfter); err != nil {
		t.Fatalf("query existing path: %v", err)
	}
	if err := db.SQL.QueryRow(`SELECT downloaded_path FROM episodes WHERE id = 2`).Scan(&missingAfter); err != nil {
		t.Fatalf("query missing path: %v", err)
	}
	if !existingAfter.Valid || existingAfter.String != existingPath {
		t.Fatalf("expected existing path to remain, got %+v", existingAfter)
	}
	if missingAfter.Valid {
		t.Fatalf("expected missing path to be cleared, got %+v", missingAfter)
	}
	if !strings.Contains(logs.String(), "reconciled missing download for episode 2") {
		t.Fatalf("expected reconcile log entry, got %q", logs.String())
	}
}

func TestReconcileDownloadsHandlesMissingEpisodesTable(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.sqlite")
	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	if err := ReconcileDownloads(db.SQL, log.New(bytes.NewBuffer(nil), "", 0)); err != nil {
		t.Fatalf("expected nil error for missing episodes table, got %v", err)
	}
}

func newReconcileTestDB(t *testing.T) *DB {
	t.Helper()

	path := filepath.Join(t.TempDir(), "test.sqlite")
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	if err := Migrate(db.SQL, "../../migrations"); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}
	return db
}
