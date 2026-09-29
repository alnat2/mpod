// Package audiometa reads audio file metadata without decoding or modifying files.
// It is a leaf package with no internal dependencies, allowing both audiobooks
// and downloads packages to use it without creating an import cycle.
package audiometa

import (
	"errors"
	"fmt"
	"math"
	"os"
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
// or unrecognised and contentType maps to a supported format (.mp3, .m4a, .m4b),
// a temporary hard link with the correct extension is created in the same directory
// as filePath, taglib is called on the hard link, and the hard link is removed
// before returning. A hard link (os.Link) is used instead of a symlink so that the
// reference is path-independent: it is not affected by CWD changes or the relative/
// absolute form of filePath.
//
// If neither the extension nor the content-type identifies a supported format,
// ErrAudioDurationUnavailable is returned and the file is not read.
func ReadAudioDurationWithHint(filePath, contentType string) (int64, error) {
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".mp3", ".m4a", ".m4b":
		return readDurationViaTaglib(filePath)
	}

	// Extension is absent or unsupported – try to infer from Content-Type.
	inferredExt := contentTypeToExt(contentType)
	if inferredExt == "" {
		return 0, ErrAudioDurationUnavailable
	}

	// taglib identifies the format from the file extension, so we create a
	// temporary hard link with the inferred extension and let taglib read it.
	// A hard link shares the inode with filePath: it works with both relative
	// and absolute paths, requires no data copy, and avoids symlink fragility.
	linkPath := filePath + inferredExt + ".durlink"
	if err := os.Link(filePath, linkPath); err != nil {
		return 0, fmt.Errorf("%w: create duration hard link: %v", ErrAudioDurationUnavailable, err)
	}
	defer os.Remove(linkPath)

	return readDurationViaTaglib(linkPath)
}

// contentTypeToExt maps a MIME type to a file extension taglib can read.
// Returns "" for unsupported or unknown types.
func contentTypeToExt(ct string) string {
	// Strip parameters (e.g. "; charset=utf-8").
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	switch strings.TrimSpace(strings.ToLower(ct)) {
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	case "audio/mp4", "audio/x-m4a", "audio/m4b", "audio/x-m4b":
		return ".m4a"
	}
	return ""
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
