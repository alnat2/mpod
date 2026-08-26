package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	"github.com/mattn/go-sqlite3"
)

type DB struct {
	SQL *sql.DB
}

func Open(path string) (*DB, error) {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve sqlite database path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolutePath), 0o755); err != nil {
		return nil, fmt.Errorf("create db directory: %w", err)
	}

	journalMode := os.Getenv("SQLITE_JOURNAL_MODE")
	if journalMode == "" {
		journalMode = "WAL"
	}
	dsn := url.URL{Scheme: "file", Path: absolutePath}
	query := dsn.Query()
	query.Set("_busy_timeout", "10000")
	query.Set("_foreign_keys", "on")
	query.Set("_journal_mode", journalMode)
	dsn.RawQuery = query.Encode()

	db, err := sql.Open("sqlite3", dsn.String())
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}

	db.SetMaxOpenConns(1)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect to sqlite database: %w", err)
	}

	return &DB{SQL: db}, nil
}

func IsUniqueConstraint(err error) bool {
	var sqliteErr sqlite3.Error
	return errors.As(err, &sqliteErr) && sqliteErr.ExtendedCode == sqlite3.ErrConstraintUnique
}

func (db *DB) Close() error {
	return db.SQL.Close()
}
