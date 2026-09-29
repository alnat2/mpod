package audiobooks

import "github.com/cross/mpod/server/internal/audiometa"

// ErrAudioDurationUnavailable is re-exported from audiometa for callers that
// import this package directly.
var ErrAudioDurationUnavailable = audiometa.ErrAudioDurationUnavailable

// ReadAudioDuration reads duration metadata without decoding or modifying the file.
// Delegates to audiometa.ReadAudioDuration; see that package for full documentation.
func ReadAudioDuration(filePath string) (int64, error) {
	return audiometa.ReadAudioDuration(filePath)
}
