package pathutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFirstExistingDirReturnsFirstMatch(t *testing.T) {
	base := t.TempDir()
	missing := filepath.Join(base, "missing")
	existing := filepath.Join(base, "existing")
	later := filepath.Join(base, "later")

	if err := os.MkdirAll(existing, 0o755); err != nil {
		t.Fatalf("MkdirAll existing: %v", err)
	}
	if err := os.MkdirAll(later, 0o755); err != nil {
		t.Fatalf("MkdirAll later: %v", err)
	}

	got := FirstExistingDir(missing, existing, later)
	if got != existing {
		t.Fatalf("expected %q, got %q", existing, got)
	}
}

func TestFirstExistingDirFallsBackToFirstCandidate(t *testing.T) {
	base := t.TempDir()
	first := filepath.Join(base, "missing-one")
	second := filepath.Join(base, "missing-two")

	got := FirstExistingDir(first, second)
	if got != first {
		t.Fatalf("expected fallback %q, got %q", first, got)
	}
}

func TestFirstExistingDirEmptyCandidates(t *testing.T) {
	if got := FirstExistingDir(); got != "" {
		t.Fatalf("expected empty string, got %q", got)
	}
}
