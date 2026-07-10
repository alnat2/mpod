package media

import (
	"errors"
	"io"
	"mime"
	nethttp "net/http"
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

func PreferredPlayableContentType(header string, sample []byte) string {
	mediaType := normalizedMediaType(header)
	if mediaType != "" && IsPlayableContentType(mediaType) && !isGenericBinaryContentType(mediaType) {
		return mediaType
	}

	sniffed := normalizedMediaType(nethttp.DetectContentType(sample))
	if sniffed != "" && IsPlayableContentType(sniffed) && !isGenericBinaryContentType(sniffed) {
		return sniffed
	}

	if mediaType != "" && IsPlayableContentType(mediaType) {
		return mediaType
	}

	return ""
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

func normalizedMediaType(value string) string {
	contentType := strings.TrimSpace(value)
	if contentType == "" {
		return ""
	}

	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.TrimSpace(strings.Split(contentType, ";")[0])
	}
	return strings.ToLower(mediaType)
}

func isGenericBinaryContentType(value string) bool {
	switch normalizedMediaType(value) {
	case "application/octet-stream", "binary/octet-stream":
		return true
	default:
		return false
	}
}
