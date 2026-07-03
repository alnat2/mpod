package storage

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
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
