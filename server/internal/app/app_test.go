package app

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/config"
	"github.com/cross/mpod/server/internal/storage"
)

func TestNewCleansExpiredSessionsAtStartup(t *testing.T) {
	dataDir := t.TempDir()
	dbPath := filepath.Join(dataDir, "mpod.sqlite")
	downloadsDir := filepath.Join(dataDir, "downloads")
	db, err := storage.Open(dbPath)
	if err != nil {
		t.Fatalf("open seed database: %v", err)
	}
	if err := storage.Migrate(db.SQL, "../../migrations"); err != nil {
		t.Fatalf("migrate seed database: %v", err)
	}
	if _, err := db.SQL.Exec(`
		INSERT INTO users (id, username, password_hash) VALUES (1, 'admin', 'unused');
		INSERT INTO sessions (id, user_id, expires_at) VALUES
			('expired', 1, '2000-01-01T00:00:00Z'),
			('active', 1, '2100-01-01T00:00:00Z');
	`); err != nil {
		t.Fatalf("seed sessions: %v", err)
	}
	if err := db.Close(); err != nil {
		t.Fatalf("close seed database: %v", err)
	}
	originalWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("get working directory: %v", err)
	}
	if err := os.Chdir("../.."); err != nil {
		t.Fatalf("change to server working directory: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(originalWorkingDir); err != nil {
			t.Errorf("restore working directory: %v", err)
		}
	})

	t.Setenv("SESSION_SECRET", "test-secret")
	t.Setenv("APP_ENV", "development")
	t.Setenv("DB_PATH", dbPath)
	t.Setenv("DATA_DIR", dataDir)
	t.Setenv("DOWNLOADS_DIR", downloadsDir)
	t.Setenv("SOCKS5_HOST", "")
	t.Setenv("SOCKS5_PORT", "")

	application, err := New(log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatalf("New failed: %v", err)
	}
	if err := application.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown failed: %v", err)
	}

	verificationDB, err := storage.Open(dbPath)
	if err != nil {
		t.Fatalf("open verification database: %v", err)
	}
	defer verificationDB.Close()

	var expiredCount, activeCount int
	if err := verificationDB.SQL.QueryRow(`SELECT COUNT(*) FROM sessions WHERE id = 'expired'`).Scan(&expiredCount); err != nil {
		t.Fatalf("query expired session: %v", err)
	}
	if err := verificationDB.SQL.QueryRow(`SELECT COUNT(*) FROM sessions WHERE id = 'active'`).Scan(&activeCount); err != nil {
		t.Fatalf("query active session: %v", err)
	}
	if expiredCount != 0 || activeCount != 1 {
		t.Fatalf("expected startup cleanup to remove only expired session, expired=%d active=%d", expiredCount, activeCount)
	}
}

func TestRunGracefullyDrainsActiveRequest(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(requestStarted)
		<-releaseRequest
		w.WriteHeader(http.StatusNoContent)
	})

	application, listenerReady, database, backgroundStops := newLifecycleTestApp(t, handler)
	runCtx, cancelRun := context.WithCancel(context.Background())
	runErr := make(chan error, 1)
	go func() {
		runErr <- application.Run(runCtx)
	}()

	listener := waitForListener(t, listenerReady, runErr)
	requestErr := make(chan error, 1)
	go func() {
		resp, err := http.Get("http://" + listener.Addr().String())
		if err == nil {
			_ = resp.Body.Close()
		}
		requestErr <- err
	}()

	<-requestStarted
	cancelRun()
	select {
	case err := <-runErr:
		t.Fatalf("Run returned before active request completed: %v", err)
	case <-time.After(25 * time.Millisecond):
	}

	close(releaseRequest)
	if err := <-requestErr; err != nil {
		t.Fatalf("active request failed during graceful shutdown: %v", err)
	}
	if err := <-runErr; err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if database.CloseCount() != 1 {
		t.Fatalf("expected database to close once, got %d", database.CloseCount())
	}
	if backgroundStops.Count() != 1 {
		t.Fatalf("expected background context to stop once, got %d", backgroundStops.Count())
	}
}

func TestRunForcesHTTPServerClosedWhenGracefulShutdownTimesOut(t *testing.T) {
	requestStarted := make(chan struct{})
	handler := http.HandlerFunc(func(_ http.ResponseWriter, req *http.Request) {
		close(requestStarted)
		<-req.Context().Done()
	})

	application, listenerReady, database, _ := newLifecycleTestApp(t, handler)
	application.shutdownTimeout = 20 * time.Millisecond
	runCtx, cancelRun := context.WithCancel(context.Background())
	runErr := make(chan error, 1)
	go func() {
		runErr <- application.Run(runCtx)
	}()

	listener := waitForListener(t, listenerReady, runErr)
	requestDone := make(chan struct{})
	go func() {
		resp, err := http.Get("http://" + listener.Addr().String())
		if err == nil {
			_ = resp.Body.Close()
		}
		close(requestDone)
	}()

	<-requestStarted
	cancelRun()
	err := <-runErr
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected shutdown deadline error, got %v", err)
	}
	<-requestDone
	if database.CloseCount() != 1 {
		t.Fatalf("expected database to close once, got %d", database.CloseCount())
	}
}

func TestRunClosesResourcesWhenListenFails(t *testing.T) {
	database := &countingCloser{}
	backgroundStops := &counter{}
	listenErr := errors.New("listen failed")
	application := &App{
		config: config.Config{Port: "5050"},
		logger: log.New(io.Discard, "", 0),
		server: &http.Server{Addr: ":5050"},
		db:     database,
		cancel: backgroundStops.Increment,
		listen: func(_, _ string) (net.Listener, error) {
			return nil, listenErr
		},
		shutdownTimeout: defaultShutdownTimeout,
	}

	err := application.Run(context.Background())
	if !errors.Is(err, listenErr) {
		t.Fatalf("expected listen error, got %v", err)
	}
	if database.CloseCount() != 1 {
		t.Fatalf("expected database to close once, got %d", database.CloseCount())
	}
	if backgroundStops.Count() != 1 {
		t.Fatalf("expected background context to stop once, got %d", backgroundStops.Count())
	}
}

func newLifecycleTestApp(t *testing.T, handler http.Handler) (*App, <-chan net.Listener, *countingCloser, *counter) {
	t.Helper()

	listenerReady := make(chan net.Listener, 1)
	database := &countingCloser{}
	backgroundStops := &counter{}
	application := &App{
		config: config.Config{Port: "0"},
		logger: log.New(io.Discard, "", 0),
		server: &http.Server{
			Addr:              "127.0.0.1:0",
			Handler:           handler,
			ReadHeaderTimeout: time.Second,
		},
		db:     database,
		cancel: backgroundStops.Increment,
		listen: func(network, address string) (net.Listener, error) {
			listener, err := net.Listen(network, address)
			if err == nil {
				listenerReady <- listener
			}
			return listener, err
		},
		shutdownTimeout: defaultShutdownTimeout,
	}
	return application, listenerReady, database, backgroundStops
}

func waitForListener(t *testing.T, listenerReady <-chan net.Listener, runErr <-chan error) net.Listener {
	t.Helper()
	select {
	case listener := <-listenerReady:
		return listener
	case err := <-runErr:
		t.Fatalf("Run returned before listening: %v", err)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for HTTP listener")
	}
	return nil
}

type countingCloser struct {
	mu    sync.Mutex
	count int
}

func (c *countingCloser) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.count++
	return nil
}

func (c *countingCloser) CloseCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.count
}

type counter struct {
	mu    sync.Mutex
	count int
}

func (c *counter) Increment() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.count++
}

func (c *counter) Count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.count
}
