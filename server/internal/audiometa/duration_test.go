package audiometa

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRoundDuration(t *testing.T) {
	tests := []struct {
		d        time.Duration
		expected int64
		err      bool
	}{
		{0, 0, true},
		{-1 * time.Second, 0, true},
		{10 * time.Millisecond, 1, false},
		{1490 * time.Millisecond, 1, false},
		{1500 * time.Millisecond, 2, false},
		{2490 * time.Millisecond, 2, false},
		{2500 * time.Millisecond, 3, false},
	}

	for _, tc := range tests {
		got, err := roundDuration(tc.d)
		if tc.err {
			if !errors.Is(err, ErrAudioDurationUnavailable) {
				t.Errorf("roundDuration(%v): expected ErrAudioDurationUnavailable, got %v", tc.d, err)
			}
		} else {
			if err != nil {
				t.Errorf("roundDuration(%v): unexpected error %v", tc.d, err)
			}
			if got != tc.expected {
				t.Errorf("roundDuration(%v): expected %d, got %d", tc.d, tc.expected, got)
			}
		}
	}
}

func TestReadAudioDuration_UnsupportedExtension(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.txt")
	if err := os.WriteFile(path, []byte("fake"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	_, err := ReadAudioDuration(path)
	if !errors.Is(err, ErrAudioDurationUnavailable) {
		t.Fatalf("expected ErrAudioDurationUnavailable for unsupported extension, got %v", err)
	}
}

func TestReadAudioDuration_EmptyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty.mp3")
	if err := os.WriteFile(path, []byte{}, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	_, err := ReadAudioDuration(path)
	if !errors.Is(err, ErrAudioDurationUnavailable) {
		t.Fatalf("expected ErrAudioDurationUnavailable for empty file, got %v", err)
	}
}

// TestReadAudioDuration_RelativePath verifies that ReadAudioDuration accepts a relative
// path (as produced by filepath.Join("testdata", ...)) and returns the correct duration.
// During go test the CWD is the package directory, so testdata/ is reachable.
func TestReadAudioDuration_RelativePath(t *testing.T) {
	// Use a relative path, not an absolute one.
	relPath := filepath.Join("testdata", "valid.mp3")
	dur, err := ReadAudioDuration(relPath)
	if err != nil {
		t.Fatalf("ReadAudioDuration(%q): unexpected error: %v", relPath, err)
	}
	if dur != 3 {
		t.Fatalf("ReadAudioDuration(%q): expected 3 s, got %d", relPath, dur)
	}
}

// TestReadAudioDurationWithHint_RelativePath verifies that ReadAudioDurationWithHint
// works correctly when given a relative file path that has no extension.
func TestReadAudioDurationWithHint_RelativePath(t *testing.T) {
	// testdata/noext is a copy of valid.mp3 with no file extension.
	relPath := filepath.Join("testdata", "noext")
	dur, err := ReadAudioDurationWithHint(relPath, "audio/mpeg")
	if err != nil {
		t.Fatalf("ReadAudioDurationWithHint(%q, audio/mpeg): unexpected error: %v", relPath, err)
	}
	if dur != 3 {
		t.Fatalf("ReadAudioDurationWithHint(%q, audio/mpeg): expected 3 s, got %d", relPath, dur)
	}
}

// TestReadAudioDurationWithHint_UnsupportedContentType verifies that an unrecognised
// Content-Type on an extensionless file returns ErrAudioDurationUnavailable.
func TestReadAudioDurationWithHint_UnsupportedContentType(t *testing.T) {
	relPath := filepath.Join("testdata", "noext")
	_, err := ReadAudioDurationWithHint(relPath, "audio/ogg")
	if !errors.Is(err, ErrAudioDurationUnavailable) {
		t.Fatalf("expected ErrAudioDurationUnavailable for unsupported content-type, got %v", err)
	}
}

// TestReadAudioDurationWithHint_FallsBackToExtension verifies that when the file
// already has a recognised extension, ReadAudioDurationWithHint uses it directly
// and ignores the content-type hint.
func TestReadAudioDurationWithHint_FallsBackToExtension(t *testing.T) {
	relPath := filepath.Join("testdata", "valid.mp3")
	// Provide a mismatched content-type — the extension should win.
	dur, err := ReadAudioDurationWithHint(relPath, "audio/ogg")
	if err != nil {
		t.Fatalf("ReadAudioDurationWithHint with .mp3 extension: unexpected error: %v", err)
	}
	if dur != 3 {
		t.Fatalf("ReadAudioDurationWithHint with .mp3 extension: expected 3 s, got %d", dur)
	}
}
