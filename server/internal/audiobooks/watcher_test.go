package audiobooks

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestWatcherDebounce(t *testing.T) {
	tempDir := t.TempDir()

	var rescanCount int32
	rescanSignal := make(chan struct{}, 10)

	watcher, err := NewWatcher(tempDir, 50*time.Millisecond, func() {
		atomic.AddInt32(&rescanCount, 1)
		rescanSignal <- struct{}{}
	})
	if err != nil {
		t.Fatalf("NewWatcher failed: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := watcher.Start(ctx); err != nil {
		t.Fatalf("watcher.Start failed: %v", err)
	}
	defer watcher.Close()

	// Rapid file writes in quick succession
	for i := 0; i < 5; i++ {
		mustWriteFile(t, filepath.Join(tempDir, "file.mp3"), "content")
		time.Sleep(10 * time.Millisecond)
	}

	// Wait for the debounced signal
	select {
	case <-rescanSignal:
		// Rescan triggered
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("expected rescan to be triggered")
	}

	// Give a small grace period to ensure debounce grouped the rapid events
	time.Sleep(100 * time.Millisecond)

	count := atomic.LoadInt32(&rescanCount)
	if count != 1 {
		t.Errorf("expected exactly 1 debounced rescan call, got %d", count)
	}

	// Create a subfolder and write inside it
	subDir := filepath.Join(tempDir, "subfolder")
	if err := os.Mkdir(subDir, 0o755); err != nil {
		t.Fatal(err)
	}
	time.Sleep(20 * time.Millisecond)

	mustWriteFile(t, filepath.Join(subDir, "01.mp3"), "audio")

	select {
	case <-rescanSignal:
		// Triggered for subfolder
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("expected rescan to be triggered for subfolder file")
	}
}
