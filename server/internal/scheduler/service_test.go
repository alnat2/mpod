package scheduler

import (
	"context"
	"errors"
	"io"
	"log"
	"path/filepath"
	"testing"

	"github.com/cross/mpod/server/internal/settings"
	"github.com/cross/mpod/server/internal/storage"
)

func TestRunOnceSuccessUpdatesStatus(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, log.New(io.Discard, "", 0), settings.NewService(db.SQL), func(context.Context) error {
		return nil
	})

	if err := service.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce failed: %v", err)
	}

	status, err := service.GetStatus(context.Background())
	if err != nil {
		t.Fatalf("GetStatus failed: %v", err)
	}
	if status.State != "completed" {
		t.Fatalf("expected completed state, got %q", status.State)
	}
	if status.LastRunAt == nil || status.LastSuccessAt == nil {
		t.Fatalf("expected lastRunAt and lastSuccessAt to be set")
	}
}

func TestRunOnceFailureUpdatesStatus(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, log.New(io.Discard, "", 0), settings.NewService(db.SQL), func(context.Context) error {
		return errors.New("refresh failed")
	})

	if err := service.RunOnce(context.Background()); err == nil {
		t.Fatalf("expected RunOnce to return error")
	}

	status, err := service.GetStatus(context.Background())
	if err != nil {
		t.Fatalf("GetStatus failed: %v", err)
	}
	if status.State != "failed" {
		t.Fatalf("expected failed state, got %q", status.State)
	}
	if status.LastRunAt == nil || status.LastFailureAt == nil || status.LastError == nil {
		t.Fatalf("expected failure status fields to be set")
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
