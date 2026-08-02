package storage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEnsureWritableDirectoryCreatesDirectoryAndRemovesProbe(t *testing.T) {
	target := filepath.Join(t.TempDir(), "downloads")

	if err := EnsureWritableDirectory(target); err != nil {
		t.Fatalf("EnsureWritableDirectory failed: %v", err)
	}
	entries, err := os.ReadDir(target)
	if err != nil {
		t.Fatalf("read prepared directory: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected write probe to be removed, found %d entries", len(entries))
	}
}

func TestEnsureWritableDirectoryRejectsFilePath(t *testing.T) {
	target := filepath.Join(t.TempDir(), "downloads")
	if err := os.WriteFile(target, []byte("not a directory"), 0o644); err != nil {
		t.Fatalf("write conflicting file: %v", err)
	}

	if err := EnsureWritableDirectory(target); err == nil {
		t.Fatal("expected regular file path to be rejected")
	}
}

func TestEnsureWritableDirectoryRejectsEmptyPath(t *testing.T) {
	if err := EnsureWritableDirectory("  "); err == nil {
		t.Fatal("expected empty path to be rejected")
	}
}
