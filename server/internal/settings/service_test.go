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

	service := NewService(db.SQL, false)
	values, err := service.Get(context.Background())
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if values.DailyRefreshTime != "03:00" || values.ProxyEnabled || values.ProxyConfigured {
		t.Fatalf("expected default daily refresh time, got %q", values.DailyRefreshTime)
	}
}

func TestUpdatePersistsValidatedTime(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, false)
	refreshTime := "08:45"
	values, err := service.Update(context.Background(), UpdateInput{DailyRefreshTime: &refreshTime})
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

	service := NewService(db.SQL, false)
	refreshTime := "25:99"
	if _, err := service.Update(context.Background(), UpdateInput{DailyRefreshTime: &refreshTime}); err == nil {
		t.Fatalf("expected invalid time error")
	}
}

func TestUpdatePersistsProxyEnabledWhenConfigured(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, true)
	enabled := true
	values, err := service.Update(context.Background(), UpdateInput{ProxyEnabled: &enabled})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if !values.ProxyEnabled || !values.ProxyConfigured {
		t.Fatalf("unexpected values after proxy update: %+v", values)
	}
}

func TestUpdateRejectsEnablingProxyWhenUnavailable(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, false)
	enabled := true
	if _, err := service.Update(context.Background(), UpdateInput{ProxyEnabled: &enabled}); err != ErrProxyNotConfigured {
		t.Fatalf("expected ErrProxyNotConfigured, got %v", err)
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
