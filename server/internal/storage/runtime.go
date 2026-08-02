package storage

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

func EnsureWritableDirectory(path string) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("storage directory path is required")
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return fmt.Errorf("create storage directory %q: %w", path, err)
	}

	probe, err := os.CreateTemp(path, ".mpod-write-check-*")
	if err != nil {
		return fmt.Errorf("write to storage directory %q: %w", path, err)
	}
	probePath := probe.Name()
	if err := probe.Close(); err != nil {
		_ = os.Remove(probePath)
		return fmt.Errorf("close storage write check %q: %w", path, err)
	}
	if err := os.Remove(probePath); err != nil {
		return fmt.Errorf("remove storage write check %q: %w", path, err)
	}
	return nil
}
