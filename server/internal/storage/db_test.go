package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
)

func TestOpenConfiguresEverySQLiteConnection(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()
	db.SQL.SetMaxOpenConns(2)

	ctx := context.Background()
	first, err := db.SQL.Conn(ctx)
	if err != nil {
		t.Fatalf("open first connection: %v", err)
	}
	defer first.Close()
	second, err := db.SQL.Conn(ctx)
	if err != nil {
		t.Fatalf("open second connection: %v", err)
	}
	defer second.Close()

	for index, connection := range []*sql.Conn{first, second} {
		assertSQLitePragma(t, connection, index+1, "foreign_keys", "1")
		assertSQLitePragma(t, connection, index+1, "journal_mode", "wal")
		assertSQLitePragma(t, connection, index+1, "busy_timeout", "5000")
	}
}

func TestIsUniqueConstraintUsesSQLiteExtendedCode(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer db.Close()

	if _, err := db.SQL.Exec(`CREATE TABLE unique_values (value TEXT NOT NULL UNIQUE)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	if _, err := db.SQL.Exec(`INSERT INTO unique_values (value) VALUES ('same')`); err != nil {
		t.Fatalf("insert initial value: %v", err)
	}
	_, constraintErr := db.SQL.Exec(`INSERT INTO unique_values (value) VALUES ('same')`)
	if !IsUniqueConstraint(constraintErr) {
		t.Fatalf("expected SQLite unique constraint, got %v", constraintErr)
	}
	if !IsUniqueConstraint(fmt.Errorf("wrapped: %w", constraintErr)) {
		t.Fatal("expected wrapped SQLite unique constraint to be recognized")
	}
	if IsUniqueConstraint(errors.New("UNIQUE constraint failed")) {
		t.Fatal("plain error text must not be treated as a SQLite unique constraint")
	}
}

func assertSQLitePragma(t *testing.T, connection *sql.Conn, connectionNumber int, name, want string) {
	t.Helper()

	var got string
	if err := connection.QueryRowContext(context.Background(), "PRAGMA "+name).Scan(&got); err != nil {
		t.Fatalf("query %s on connection %d: %v", name, connectionNumber, err)
	}
	if got != want {
		t.Fatalf("expected %s=%s on connection %d, got %s", name, want, connectionNumber, got)
	}
}
