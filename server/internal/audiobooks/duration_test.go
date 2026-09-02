package audiobooks

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The valid.* fixtures were generated for tests:
// valid.mp3 is a synthetic MPEG-1 Layer III (128 kbps, 44.1 kHz) stream.
// valid.m4a and valid.m4b are macOS `afconvert` outputs from a 440Hz 2-second WAV generated in Go:
//   afconvert -f m4af -d aac sine.wav valid.m4a && cp valid.m4a valid.m4b

func TestReadAudioDuration(t *testing.T) {
	tests := []struct {
		name     string
		fixture  string
		expected int64
	}{
		{"Valid MP3", "valid.mp3", 3},   // 3 seconds synthetic
		{"Valid M4A", "valid.m4a", 2},   // 2 second generated PCM converted to AAC
		{"Valid M4B", "valid.m4b", 2},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join("testdata", tc.fixture)
			// Pre-read to ensure it doesn't change
			beforeBytes, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("failed to read test file: %v", err)
			}

			duration, err := ReadAudioDuration(path)
			if err != nil {
				t.Fatalf("ReadAudioDuration failed: %v", err)
			}
			if duration != tc.expected {
				t.Fatalf("expected duration %d, got %d", tc.expected, duration)
			}

			afterBytes, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("failed to read test file after: %v", err)
			}
			if !bytes.Equal(beforeBytes, afterBytes) {
				t.Fatalf("file content was altered by ReadAudioDuration")
			}
		})
	}
}

func TestReadAudioDuration_UppercaseExtension(t *testing.T) {
	path := filepath.Join(t.TempDir(), "TEST.MP3")
	content, err := os.ReadFile(filepath.Join("testdata", "valid.mp3"))
	if err != nil {
		t.Fatalf("failed to read fixture: %v", err)
	}
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("failed to write uppercase fixture: %v", err)
	}

	duration, err := ReadAudioDuration(path)
	if err != nil {
		t.Fatalf("ReadAudioDuration failed: %v", err)
	}
	if duration != 3 {
		t.Fatalf("expected duration 3, got %d", duration)
	}
}

func TestReadAudioDuration_Errors(t *testing.T) {
	t.Run("Unsupported extension", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "test.txt")
		if err := os.WriteFile(path, []byte("fake"), 0o644); err != nil {
			t.Fatalf("failed to write fake file: %v", err)
		}
		_, err := ReadAudioDuration(path)
		if !errors.Is(err, ErrAudioDurationUnavailable) {
			t.Fatalf("expected ErrAudioDurationUnavailable, got %v", err)
		}
	})

	t.Run("Empty file", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "empty.mp3")
		if err := os.WriteFile(path, []byte{}, 0o644); err != nil {
			t.Fatalf("failed to write empty file: %v", err)
		}
		_, err := ReadAudioDuration(path)
		if !errors.Is(err, ErrAudioDurationUnavailable) {
			t.Fatalf("expected ErrAudioDurationUnavailable, got %v", err)
		}
	})

	t.Run("Corrupted file", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "corrupt.mp3")
		if err := os.WriteFile(path, []byte("definitely not an audio file but has correct extension"), 0o644); err != nil {
			t.Fatalf("failed to write corrupted file: %v", err)
		}
		_, err := ReadAudioDuration(path)
		if !errors.Is(err, ErrAudioDurationUnavailable) {
			t.Fatalf("expected ErrAudioDurationUnavailable, got %v", err)
		}
	})
}

func TestReadAudioDuration_MP3GarbageRegression(t *testing.T) {
	validBytes, err := os.ReadFile(filepath.Join("testdata", "valid.mp3"))
	if err != nil {
		t.Fatal(err)
	}

	garbage := make([]byte, 5000)
	for i := range garbage {
		garbage[i] = 0xAA
	}

	mid := len(validBytes) / 2
	corruptBytes := append([]byte{}, validBytes[:mid]...)
	corruptBytes = append(corruptBytes, garbage...)
	corruptBytes = append(corruptBytes, validBytes[mid:]...)

	path := filepath.Join(t.TempDir(), "garbage.mp3")
	if err := os.WriteFile(path, corruptBytes, 0o644); err != nil {
		t.Fatalf("failed to write garbage regression file: %v", err)
	}

	duration, err := ReadAudioDuration(path)
	if err == nil {
		if duration != 3 {
			t.Fatalf("expected duration 3 (graceful recovery), but got %d", duration)
		}
	} else {
		if !errors.Is(err, ErrAudioDurationUnavailable) {
			t.Fatalf("expected ErrAudioDurationUnavailable, got %v", err)
		}
	}
}

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
