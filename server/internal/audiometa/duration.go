// Package audiometa reads audio file metadata without decoding or modifying files.
// It is a leaf package with no internal dependencies, allowing both audiobooks
// and downloads packages to use it without creating an import cycle.
package audiometa

import (
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"time"

	"go.senan.xyz/taglib"
)

// ErrAudioDurationUnavailable is returned when the audio duration cannot be read
// from the file, either because the format is unsupported or metadata is absent/corrupt.
var ErrAudioDurationUnavailable = errors.New("audio duration unavailable")

// ReadAudioDuration reads duration metadata without decoding or modifying the file.
// It supports .mp3, .m4a, and .m4b files. Any other extension returns
// ErrAudioDurationUnavailable immediately. A positive integer number of seconds
// is returned on success; zero is never returned without an error.
func ReadAudioDuration(filePath string) (int64, error) {
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".mp3", ".m4a", ".m4b":
		// supported
	default:
		return 0, ErrAudioDurationUnavailable
	}

	props, err := taglib.ReadProperties(filePath)
	if err != nil {
		return 0, fmt.Errorf("%w: %v", ErrAudioDurationUnavailable, err)
	}

	return roundDuration(props.Length)
}

func roundDuration(d time.Duration) (int64, error) {
	seconds := d.Seconds()
	if seconds <= 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return 0, ErrAudioDurationUnavailable
	}
	return max(1, int64(math.Round(seconds))), nil
}
