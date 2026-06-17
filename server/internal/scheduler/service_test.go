package scheduler

import (
	"context"
	"errors"
	"io"
	"log"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/settings"
	"github.com/cross/mpod/server/internal/storage"
)

func TestRunOnceSuccessUpdatesStatus(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service, err := NewService(db.SQL, log.New(io.Discard, "", 0), settings.NewService(db.SQL, false), func(context.Context) error {
		return nil
	}, "UTC")
	if err != nil {
		t.Fatalf("NewService failed: %v", err)
	}

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
	if status.LastTrigger == nil || *status.LastTrigger != triggerManual {
		t.Fatalf("expected manual trigger, got %+v", status.LastTrigger)
	}
	if status.Timezone != "UTC" {
		t.Fatalf("expected UTC timezone, got %q", status.Timezone)
	}
}

func TestRunOnceFailureUpdatesStatus(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	service, err := NewService(db.SQL, log.New(io.Discard, "", 0), settings.NewService(db.SQL, false), func(context.Context) error {
		return errors.New("refresh failed")
	}, "UTC")
	if err != nil {
		t.Fatalf("NewService failed: %v", err)
	}

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

func TestRunNowRejectsOverlappingRuns(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	service, err := NewService(db.SQL, log.New(io.Discard, "", 0), settings.NewService(db.SQL, false), func(context.Context) error {
		started <- struct{}{}
		<-release
		return nil
	}, "UTC")
	if err != nil {
		t.Fatalf("NewService failed: %v", err)
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- service.RunNow(context.Background())
	}()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for scheduler run to start")
	}

	if err := service.RunNow(context.Background()); !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("expected ErrAlreadyRunning, got %v", err)
	}

	close(release)

	if err := <-errCh; err != nil {
		t.Fatalf("expected first RunNow to complete successfully, got %v", err)
	}
}

func TestParseClock(t *testing.T) {
	hour, minute, err := parseClock("09:45")
	if err != nil {
		t.Fatalf("parseClock failed: %v", err)
	}
	if hour != 9 || minute != 45 {
		t.Fatalf("unexpected parsed time: %d:%d", hour, minute)
	}

	if _, _, err := parseClock("invalid"); err == nil {
		t.Fatalf("expected parseClock to reject invalid values")
	}
}

func TestMaybeRunSkipsOutsideConfiguredWindow(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	now := time.Now()
	configured := now.Add(1 * time.Minute).Format("15:04")
	if _, err := db.SQL.Exec(`UPDATE settings SET value = ? WHERE key = 'daily_refresh_time'`, configured); err != nil {
		t.Fatalf("update settings: %v", err)
	}

	var called atomic.Int32
	service, err := NewService(db.SQL, log.New(io.Discard, "", 0), settings.NewService(db.SQL, false), func(context.Context) error {
		called.Add(1)
		return nil
	}, "UTC")
	if err != nil {
		t.Fatalf("NewService failed: %v", err)
	}
	service.maybeRun(context.Background())

	if called.Load() != 0 {
		t.Fatalf("expected maybeRun to skip outside configured window, called=%d", called.Load())
	}
}

func TestMaybeRunStartsOnlyOncePerDay(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	var called atomic.Int32
	service, err := NewService(db.SQL, log.New(io.Discard, "", 0), settings.NewService(db.SQL, false), func(context.Context) error {
		called.Add(1)
		started <- struct{}{}
		<-release
		return nil
	}, "UTC")
	if err != nil {
		t.Fatalf("NewService failed: %v", err)
	}
	now := service.now().In(service.location).Format("15:04")
	if _, err := db.SQL.Exec(`UPDATE settings SET value = ? WHERE key = 'daily_refresh_time'`, now); err != nil {
		t.Fatalf("update settings: %v", err)
	}

	service.maybeRun(context.Background())
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for scheduled run to start")
	}

	service.maybeRun(context.Background())
	close(release)

	waitForSchedulerIdle(t, service)
	if called.Load() != 1 {
		t.Fatalf("expected exactly one scheduled run, got %d", called.Load())
	}
}

func TestMaybeRunDoesNotRunAgainAfterSuccessfulRunSameDay(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	var called atomic.Int32
	service, err := NewService(db.SQL, log.New(io.Discard, "", 0), settings.NewService(db.SQL, false), func(context.Context) error {
		called.Add(1)
		return nil
	}, "UTC")
	if err != nil {
		t.Fatalf("NewService failed: %v", err)
	}
	now := service.now().In(service.location).Format("15:04")
	if _, err := db.SQL.Exec(`UPDATE settings SET value = ? WHERE key = 'daily_refresh_time'`, now); err != nil {
		t.Fatalf("update settings: %v", err)
	}

	service.maybeRun(context.Background())
	waitForSchedulerIdle(t, service)

	service.maybeRun(context.Background())
	waitForSchedulerIdle(t, service)

	if called.Load() != 1 {
		t.Fatalf("expected successful scheduled run to happen once per day, got %d", called.Load())
	}
}

func TestMaybeRunUsesConfiguredTimezone(t *testing.T) {
	db := newTestDB(t)
	defer db.Close()

	if _, err := db.SQL.Exec(`UPDATE settings SET value = '04:00' WHERE key = 'daily_refresh_time'`); err != nil {
		t.Fatalf("update settings: %v", err)
	}

	var called atomic.Int32
	service, err := NewService(db.SQL, log.New(io.Discard, "", 0), settings.NewService(db.SQL, false), func(context.Context) error {
		called.Add(1)
		return nil
	}, "Europe/Moscow")
	if err != nil {
		t.Fatalf("NewService failed: %v", err)
	}
	service.now = func() time.Time {
		return time.Date(2026, time.June, 17, 1, 0, 0, 0, time.UTC)
	}

	service.maybeRun(context.Background())
	waitForSchedulerIdle(t, service)

	if called.Load() != 1 {
		t.Fatalf("expected scheduled run in configured timezone, got %d", called.Load())
	}

	status, err := service.GetStatus(context.Background())
	if err != nil {
		t.Fatalf("GetStatus failed: %v", err)
	}
	if status.LastTrigger == nil || *status.LastTrigger != triggerScheduled {
		t.Fatalf("expected scheduled trigger, got %+v", status.LastTrigger)
	}
	if status.Timezone != "Europe/Moscow" {
		t.Fatalf("expected Europe/Moscow timezone, got %q", status.Timezone)
	}
}

func waitForSchedulerIdle(t *testing.T, service *Service) {
	t.Helper()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		service.mu.Lock()
		running := service.running
		service.mu.Unlock()
		if !running {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for scheduler to become idle")
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
