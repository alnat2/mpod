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
	return readDurationViaTaglib(filePath)
}

// ReadAudioDurationWithHint reads duration from filePath, using contentType as a
// fallback when the file has no recognised audio extension. This covers podcast
// episodes whose audio URL carries no path extension (e.g. CDN query-string URLs).
//
// If the extension is recognised the hint is ignored. If the extension is absent
// or unrecognised and contentType maps to a supported format, the source file is
// read directly.
//
// If neither the extension nor the content-type identifies a supported format,
// ErrAudioDurationUnavailable is returned and the file is not read.
func ReadAudioDurationWithHint(filePath, contentType string) (int64, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".mp3", ".m4a", ".m4b":
		return readDurationViaTaglib(filePath)
	}

	// Extension is absent or unsupported – check Content-Type hint.
	if !isSupportedContentType(contentType) {
		return 0, ErrAudioDurationUnavailable
	}

	return readDurationViaTaglib(filePath)
}

// isSupportedContentType checks if the MIME type corresponds to a supported audio format.
func isSupportedContentType(ct string) bool {
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	switch strings.TrimSpace(strings.ToLower(ct)) {
	case "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/m4b", "audio/x-m4b":
		return true
	}
	return false
}

func readDurationViaTaglib(filePath string) (int64, error) {
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
