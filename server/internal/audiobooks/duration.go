package audiobooks

import (
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"time"

	"go.senan.xyz/taglib"
)

var ErrAudioDurationUnavailable = errors.New("audio duration unavailable")

// ReadAudioDuration reads duration metadata without decoding or modifying the file.
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
