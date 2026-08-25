package audiobooks

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Watcher struct {
	rootDir   string
	debounce  time.Duration
	onRescan  func()
	watcher   *fsnotify.Watcher
	mu        sync.Mutex
	timer     *time.Timer
	stopCh    chan struct{}
	running   bool
}

func NewWatcher(rootDir string, debounce time.Duration, onRescan func()) (*Watcher, error) {
	cleanRoot := filepath.Clean(rootDir)
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("create fsnotify watcher: %w", err)
	}

	if debounce <= 0 {
		debounce = 2500 * time.Millisecond
	}

	return &Watcher{
		rootDir:  cleanRoot,
		debounce: debounce,
		onRescan: onRescan,
		watcher:  fw,
		stopCh:   make(chan struct{}),
	}, nil
}

func (w *Watcher) Start(ctx context.Context) error {
	w.mu.Lock()
	if w.running {
		w.mu.Unlock()
		return nil
	}
	w.running = true
	w.mu.Unlock()

	// Initial recursive watch
	if err := w.watchRecursive(w.rootDir); err != nil {
		// If root directory doesn't exist yet, we still proceed without failing fatal
		_ = err
	}

	go w.eventLoop(ctx)
	return nil
}

func (w *Watcher) watchRecursive(dir string) error {
	return filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") && path != dir {
				return filepath.SkipDir
			}
			_ = w.watcher.Add(path)
		}
		return nil
	})
}

func (w *Watcher) eventLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			w.Close()
			return
		case <-w.stopCh:
			return
		case event, ok := <-w.watcher.Events:
			if !ok {
				return
			}

			// Ignore hidden file events
			if strings.HasPrefix(filepath.Base(event.Name), ".") {
				continue
			}

			// If a new directory was created, watch it
			if event.Has(fsnotify.Create) {
				if fi, err := os.Stat(event.Name); err == nil && fi.IsDir() {
					_ = w.watchRecursive(event.Name)
				}
			}

			// Schedule debounced rescan
			w.triggerDebounced()

		case _, ok := <-w.watcher.Errors:
			if !ok {
				return
			}
		}
	}
}

func (w *Watcher) triggerDebounced() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.timer != nil {
		w.timer.Stop()
	}

	w.timer = time.AfterFunc(w.debounce, func() {
		if w.onRescan != nil {
			w.onRescan()
		}
	})
}

func (w *Watcher) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.running {
		return nil
	}
	w.running = false

	if w.timer != nil {
		w.timer.Stop()
	}

	close(w.stopCh)
	return w.watcher.Close()
}
