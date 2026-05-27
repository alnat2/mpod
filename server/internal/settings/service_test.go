package settings

import (
	"context"
	"errors"
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
	if values.DailyRefreshTime != "03:00" || values.PlaybackSpeed != DefaultPlaybackSpeed || values.ProxyEnabled || values.ProxyConfigured {
		t.Fatalf("expected default settings values, got %+v", values)
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

func TestUpdatePersistsPlaybackSpeed(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, false)
	speed := "Speed 2x"
	values, err := service.Update(context.Background(), UpdateInput{PlaybackSpeed: &speed})
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}
	if values.PlaybackSpeed != "Speed 2x" {
		t.Fatalf("unexpected values returned: %+v", values)
	}

	loaded, err := service.Get(context.Background())
	if err != nil {
		t.Fatalf("Get after update failed: %v", err)
	}
	if loaded.PlaybackSpeed != "Speed 2x" {
		t.Fatalf("expected persisted playback speed Speed 2x, got %q", loaded.PlaybackSpeed)
	}
}

func TestUpdateRejectsInvalidPlaybackSpeed(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, false)
	speed := "Speed 9x"
	if _, err := service.Update(context.Background(), UpdateInput{PlaybackSpeed: &speed}); err != ErrInvalidPlaybackSpeed {
		t.Fatalf("expected ErrInvalidPlaybackSpeed, got %v", err)
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

func TestGetProxyStatusReturnsOffWhenDisabled(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewServiceWithProxyStatusLookup(db.SQL, true, func(context.Context) (ProxyLookupResult, error) {
		t.Fatalf("proxy lookup should not run when proxy is disabled")
		return ProxyLookupResult{}, nil
	})

	status, err := service.GetProxyStatus(context.Background())
	if err != nil {
		t.Fatalf("GetProxyStatus failed: %v", err)
	}
	if status.Status != ProxyStatusOff || status.ProxyEnabled || !status.ProxyConfigured {
		t.Fatalf("unexpected proxy status: %+v", status)
	}
	if status.ExternalIP != nil || status.Country != nil || status.Error != nil {
		t.Fatalf("expected empty observed identity for disabled proxy, got %+v", status)
	}
}

func TestGetProxyStatusReturnsObservedIdentityWhenEnabled(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewServiceWithProxyStatusLookup(db.SQL, true, func(context.Context) (ProxyLookupResult, error) {
		return ProxyLookupResult{
			ExternalIP: "198.51.100.10",
			Country:    "Germany",
		}, nil
	})
	enabled := true
	if _, err := service.Update(context.Background(), UpdateInput{ProxyEnabled: &enabled}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	status, err := service.GetProxyStatus(context.Background())
	if err != nil {
		t.Fatalf("GetProxyStatus failed: %v", err)
	}
	if status.Status != ProxyStatusOK || !status.ProxyEnabled || !status.ProxyConfigured {
		t.Fatalf("unexpected proxy status: %+v", status)
	}
	if status.ExternalIP == nil || *status.ExternalIP != "198.51.100.10" {
		t.Fatalf("unexpected external ip: %+v", status.ExternalIP)
	}
	if status.Country == nil || *status.Country != "Germany" {
		t.Fatalf("unexpected country: %+v", status.Country)
	}
	if status.Error != nil {
		t.Fatalf("expected no lookup error, got %+v", status.Error)
	}
}

func TestGetProxyStatusReturnsUnknownWhenLookupUnavailable(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewService(db.SQL, true)
	enabled := true
	if _, err := service.Update(context.Background(), UpdateInput{ProxyEnabled: &enabled}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	status, err := service.GetProxyStatus(context.Background())
	if err != nil {
		t.Fatalf("GetProxyStatus failed: %v", err)
	}
	if status.Status != ProxyStatusUnknown {
		t.Fatalf("expected unknown state, got %+v", status)
	}
	if status.Error == nil || *status.Error != "Proxy status lookup is unavailable" {
		t.Fatalf("expected unavailable lookup error, got %+v", status.Error)
	}
}

func TestGetProxyStatusReturnsUnknownWhenLookupHasNoIdentity(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewServiceWithProxyStatusLookup(db.SQL, true, func(context.Context) (ProxyLookupResult, error) {
		return ProxyLookupResult{}, nil
	})
	enabled := true
	if _, err := service.Update(context.Background(), UpdateInput{ProxyEnabled: &enabled}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	status, err := service.GetProxyStatus(context.Background())
	if err != nil {
		t.Fatalf("GetProxyStatus failed: %v", err)
	}
	if status.Status != ProxyStatusUnknown {
		t.Fatalf("expected unknown state, got %+v", status)
	}
	if status.Error == nil || *status.Error != "Proxy status check returned no observable network identity" {
		t.Fatalf("expected empty identity error, got %+v", status.Error)
	}
}

func TestGetProxyStatusReturnsErrorStateWhenLookupFails(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service := NewServiceWithProxyStatusLookup(db.SQL, true, func(context.Context) (ProxyLookupResult, error) {
		return ProxyLookupResult{}, errors.New("lookup failed")
	})
	enabled := true
	if _, err := service.Update(context.Background(), UpdateInput{ProxyEnabled: &enabled}); err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	status, err := service.GetProxyStatus(context.Background())
	if err != nil {
		t.Fatalf("GetProxyStatus failed: %v", err)
	}
	if status.Status != ProxyStatusError {
		t.Fatalf("expected error state, got %+v", status)
	}
	if status.Error == nil || *status.Error != "lookup failed" {
		t.Fatalf("expected lookup error details, got %+v", status.Error)
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
