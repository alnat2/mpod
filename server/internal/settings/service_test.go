package settings

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/cross/mpod/server/internal/storage"
)

func TestGetReturnsStoredValues(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	values, err := service.Get(context.Background())
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if values.DailyRefreshTime != "03:00" {
		t.Fatalf("expected default daily refresh time, got %q", values.DailyRefreshTime)
	}
}

func TestUpdatePersistsValidatedTime(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	values, err := service.Update(context.Background(), "08:45")
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if values.DailyRefreshTime != "08:45" {
		t.Fatalf("unexpected values returned: %+v", values)
	}

	loaded, err := service.Get(context.Background())
	if err != nil {
		t.Fatalf("Get after update failed: %v", err)
	}
	if loaded.DailyRefreshTime != "08:45" {
		t.Fatalf("expected persisted value 08:45, got %q", loaded.DailyRefreshTime)
	}
}

func TestUpdateRejectsInvalidTime(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL)
	if _, err := service.Update(context.Background(), "25:99"); err == nil {
		t.Fatalf("expected invalid time error")
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
