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
