package media

import (
	"errors"
	"io"
	"mime"
	"strings"
)

func IsPlayableContentType(value string) bool {
	contentType := strings.TrimSpace(value)
	if contentType == "" {
		return true
	}

	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.TrimSpace(strings.Split(contentType, ";")[0])
	}
	mediaType = strings.ToLower(mediaType)

	if strings.HasPrefix(mediaType, "audio/") || strings.HasPrefix(mediaType, "video/") {
		return true
	}

	switch mediaType {
	case "application/octet-stream",
		"binary/octet-stream",
		"application/ogg",
		"application/mp4":
		return true
	default:
		return false
	}
}

func LooksLikeNonPlayableBody(sample []byte) bool {
	trimmed := strings.TrimSpace(string(sample))
	trimmed = strings.ToLower(trimmed)
	if trimmed == "" {
		return false
	}

	return strings.HasPrefix(trimmed, "<!doctype html") ||
		strings.HasPrefix(trimmed, "<html") ||
		strings.HasPrefix(trimmed, "<?xml") ||
		strings.HasPrefix(trimmed, "{") ||
		strings.HasPrefix(trimmed, "[")
}

func ReadBodyPrefix(body io.Reader) ([]byte, error) {
	prefix := make([]byte, 512)
	n, err := io.ReadFull(body, prefix)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		return nil, err
	}
	return prefix[:n], nil
}
