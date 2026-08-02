package app

import (
	"context"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/cross/mpod/server/internal/config"
)

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
