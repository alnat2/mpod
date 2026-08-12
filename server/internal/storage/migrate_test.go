package storage

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMigrateAppliesSQLFilesInSortedOrderAndIsIdempotent(t *testing.T) {
	db := openMigrateTestDB(t)
	defer db.Close()

	dir := t.TempDir()
	writeMigrationFile(t, dir, "002_insert.sql", `INSERT INTO ordered_values (value) VALUES ('second');`)
	writeMigrationFile(t, dir, "001_schema.sql", `
		CREATE TABLE ordered_values (
			value TEXT NOT NULL
		);
		INSERT INTO ordered_values (value) VALUES ('first');
	`)

	if err := Migrate(db.SQL, dir); err != nil {
		t.Fatalf("first Migrate failed: %v", err)
	}
	if err := Migrate(db.SQL, dir); err != nil {
		t.Fatalf("second Migrate failed: %v", err)
	}

	rows, err := db.SQL.Query(`SELECT value FROM ordered_values ORDER BY rowid`)
	if err != nil {
		t.Fatalf("query values: %v", err)
	}
	defer rows.Close()

	var values []string
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			t.Fatalf("scan value: %v", err)
		}
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows err: %v", err)
	}
	if len(values) != 2 || values[0] != "first" || values[1] != "second" {
		t.Fatalf("unexpected migrated values: %v", values)
	}

	assertMigrationVersions(t, db.SQL, 2)
}

func TestMigrateRollsBackFailedMigrationWithoutRecordingVersion(t *testing.T) {
	db := openMigrateTestDB(t)
	defer db.Close()

	dir := t.TempDir()
	writeMigrationFile(t, dir, "001_schema.sql", `CREATE TABLE ok_table (value TEXT NOT NULL);`)
	writeMigrationFile(t, dir, "002_broken.sql", `INSERT INTO missing_table (value) VALUES ('nope');`)

	if err := Migrate(db.SQL, dir); err == nil {
		t.Fatal("expected Migrate to fail for broken migration")
	}

	assertMigrationVersions(t, db.SQL, 1)

	var count int
	if err := db.SQL.QueryRow(`SELECT COUNT(*) FROM ok_table`).Scan(&count); err != nil {
		t.Fatalf("query ok_table: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no rows in ok_table, got %d", count)
	}
}

func TestProjectMigrationsUpgradeExistingDatabase(t *testing.T) {
	db := openMigrateTestDB(t)
	defer db.Close()

	if _, err := db.SQL.Exec(`
		CREATE TABLE schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE episodes (
			id INTEGER PRIMARY KEY,
			podcast_id INTEGER NOT NULL,
			published_at DATETIME
		);
		CREATE TABLE playlist (
			id INTEGER PRIMARY KEY,
			position INTEGER NOT NULL
		);
		INSERT INTO schema_migrations (version) VALUES
			('0001_initial.sql'),
			('0002_scheduler_state.sql'),
			('0003_proxy_enabled.sql'),
			('0004_playback_speed.sql'),
			('0005_scheduler_trigger.sql');
	`); err != nil {
		t.Fatalf("prepare existing db failed: %v", err)
	}

	if err := Migrate(db.SQL, "../../migrations"); err != nil {
		t.Fatalf("Migrate existing db failed: %v", err)
	}

	var tableName string
	if err := db.SQL.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'active_playback'`).Scan(&tableName); err != nil {
		t.Fatalf("active_playback table missing: %v", err)
	}
	if tableName != "active_playback" {
		t.Fatalf("expected active_playback table, got %q", tableName)
	}

	assertIndexExists(t, db.SQL, "idx_episodes_podcast_published")
	assertIndexExists(t, db.SQL, "idx_playlist_position")
	assertIndexExists(t, db.SQL, "idx_playlist_download_after")
	assertMigrationVersions(t, db.SQL, 8)
}

func TestSmartListeningMigrationMakesExistingPlaylistItemsDueImmediately(t *testing.T) {
	db := openMigrateTestDB(t)
	defer db.Close()

	if err := Migrate(db.SQL, "../../migrations"); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}
	if _, err := db.SQL.Exec(`
		INSERT INTO podcasts (id, title, rss_url) VALUES (1, 'Podcast', 'https://example.com/feed.xml');
		INSERT INTO episodes (id, podcast_id, external_episode_key, title, audio_url)
		VALUES (1, 1, 'episode-1', 'Episode', 'https://example.com/episode.mp3');
	`); err != nil {
		t.Fatalf("seed episode: %v", err)
	}

	if _, err := db.SQL.Exec(`DELETE FROM schema_migrations WHERE version = '0008_smart_listening.sql'`); err != nil {
		t.Fatalf("remove smart listening migration record: %v", err)
	}
	if _, err := db.SQL.Exec(`DROP INDEX idx_playlist_download_after`); err != nil {
		t.Fatalf("drop smart listening index: %v", err)
	}
	if _, err := db.SQL.Exec(`
		CREATE TABLE playlist_legacy (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			episode_id INTEGER NOT NULL UNIQUE,
			position INTEGER NOT NULL,
			FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
		);
		INSERT INTO playlist_legacy (episode_id, position) VALUES (1, 1);
		DROP TABLE playlist;
		ALTER TABLE playlist_legacy RENAME TO playlist;
	`); err != nil {
		t.Fatalf("restore legacy playlist schema: %v", err)
	}

	if err := Migrate(db.SQL, "../../migrations"); err != nil {
		t.Fatalf("apply smart listening migration: %v", err)
	}

	var addedAt, downloadAfter time.Time
	if err := db.SQL.QueryRow(`SELECT added_at, download_after FROM playlist WHERE episode_id = 1`).Scan(&addedAt, &downloadAfter); err != nil {
		t.Fatalf("query migrated playlist item: %v", err)
	}
	if addedAt.IsZero() || downloadAfter.IsZero() || !downloadAfter.Equal(addedAt) {
		t.Fatalf("expected existing item to be immediately due, added_at=%s download_after=%s", addedAt, downloadAfter)
	}
}

func TestProjectQueryIndexesAvoidTemporarySorts(t *testing.T) {
	db := openMigrateTestDB(t)
	defer db.Close()

	if err := Migrate(db.SQL, "../../migrations"); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}

	episodePlan := queryPlanDetails(t, db.SQL, `
		SELECT id, podcast_id, title, description, audio_url, duration, downloaded_path, is_listened, published_at
		FROM episodes
		WHERE podcast_id = ?
		ORDER BY published_at DESC, id DESC
	`, 1)
	if !strings.Contains(episodePlan, "idx_episodes_podcast_published") {
		t.Fatalf("episode query did not use ordering index:\n%s", episodePlan)
	}
	if strings.Contains(episodePlan, "USE TEMP B-TREE") {
		t.Fatalf("episode query still uses a temporary sort:\n%s", episodePlan)
	}

	playlistPlan := queryPlanDetails(t, db.SQL, `
		SELECT episodes.id, episodes.title
		FROM playlist
		JOIN episodes ON episodes.id = playlist.episode_id
		ORDER BY playlist.position ASC, playlist.id ASC
	`)
	if !strings.Contains(playlistPlan, "idx_playlist_position") {
		t.Fatalf("playlist query did not use ordering index:\n%s", playlistPlan)
	}
	if strings.Contains(playlistPlan, "USE TEMP B-TREE") {
		t.Fatalf("playlist query still uses a temporary sort:\n%s", playlistPlan)
	}
}

func openMigrateTestDB(t *testing.T) *DB {
	t.Helper()

	path := filepath.Join(t.TempDir(), "test.sqlite")
	db, err := Open(path)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	return db
}

func writeMigrationFile(t *testing.T, dir, name, contents string) {
	t.Helper()

	if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0o644); err != nil {
		t.Fatalf("WriteFile %s failed: %v", name, err)
	}
}

func assertMigrationVersions(t *testing.T, db *sql.DB, want int) {
	t.Helper()

	var got int
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&got); err != nil {
		t.Fatalf("count schema_migrations: %v", err)
	}
	if got != want {
		t.Fatalf("expected %d applied migrations, got %d", want, got)
	}
}

func assertIndexExists(t *testing.T, db *sql.DB, name string) {
	t.Helper()

	var got string
	if err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`, name).Scan(&got); err != nil {
		t.Fatalf("index %s missing: %v", name, err)
	}
}

func queryPlanDetails(t *testing.T, db *sql.DB, query string, args ...any) string {
	t.Helper()

	rows, err := db.Query("EXPLAIN QUERY PLAN "+query, args...)
	if err != nil {
		t.Fatalf("explain query plan: %v", err)
	}
	defer rows.Close()

	details := make([]string, 0)
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatalf("scan query plan: %v", err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("query plan rows: %v", err)
	}
	return strings.Join(details, "\n")
}
