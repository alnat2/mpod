package media

import (
	"errors"
	"io"
	"strings"
	"testing"
)

func TestIsPlayableContentType(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "empty treated as playable", value: "", want: true},
		{name: "audio mpeg", value: "audio/mpeg", want: true},
		{name: "video mp4", value: "video/mp4", want: true},
		{name: "octet stream", value: "application/octet-stream", want: true},
		{name: "ogg application", value: "application/ogg", want: true},
		{name: "mp4 application", value: "application/mp4", want: true},
		{name: "content type with params", value: "audio/mpeg; charset=utf-8", want: true},
		{name: "fallback parser path", value: "audio/mpeg; broken", want: true},
		{name: "html rejected", value: "text/html; charset=utf-8", want: false},
		{name: "json rejected", value: "application/json", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsPlayableContentType(tt.value); got != tt.want {
				t.Fatalf("IsPlayableContentType(%q) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}
}

func TestLooksLikeNonPlayableBody(t *testing.T) {
	tests := []struct {
		name   string
		sample []byte
		want   bool
	}{
		{name: "empty", sample: nil, want: false},
		{name: "html", sample: []byte("  <!DOCTYPE html><html>bad</html>"), want: true},
		{name: "xml", sample: []byte("<?xml version=\"1.0\"?><error/>"), want: true},
		{name: "json object", sample: []byte(`{"error":"blocked"}`), want: true},
		{name: "json array", sample: []byte(`[1,2,3]`), want: true},
		{name: "audio id3", sample: []byte("ID3\x03\x00\x00"), want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := LooksLikeNonPlayableBody(tt.sample); got != tt.want {
				t.Fatalf("LooksLikeNonPlayableBody(%q) = %v, want %v", string(tt.sample), got, tt.want)
			}
		})
	}
}

func TestReadBodyPrefix(t *testing.T) {
	body := strings.NewReader("hello")
	prefix, err := ReadBodyPrefix(body)
	if err != nil {
		t.Fatalf("ReadBodyPrefix failed: %v", err)
	}
	if string(prefix) != "hello" {
		t.Fatalf("unexpected prefix %q", string(prefix))
	}
}

func TestReadBodyPrefixPropagatesReadErrors(t *testing.T) {
	_, err := ReadBodyPrefix(errReader{})
	if !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("expected io.ErrClosedPipe, got %v", err)
	}
}

func TestPreferredPlayableContentType(t *testing.T) {
	tests := []struct {
		name   string
		header string
		sample []byte
		want   string
	}{
		{
			name:   "preserves specific playable header",
			header: "audio/mpeg; charset=utf-8",
			sample: []byte("ID3\x03\x00\x00payload"),
			want:   "audio/mpeg",
		},
		{
			name:   "upgrades generic binary from sniffed mp3",
			header: "application/octet-stream",
			sample: []byte("ID3\x03\x00\x00payload"),
			want:   "audio/mpeg",
		},
		{
			name:   "keeps generic binary when sniff cannot improve it",
			header: "application/octet-stream",
			sample: []byte("plain text but not html"),
			want:   "application/octet-stream",
		},
		{
			name:   "returns empty for non-playable types",
			header: "text/html",
			sample: []byte("<html>bad</html>"),
			want:   "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := PreferredPlayableContentType(tt.header, tt.sample); got != tt.want {
				t.Fatalf("PreferredPlayableContentType(%q, %q) = %q, want %q", tt.header, string(tt.sample), got, tt.want)
			}
		})
	}
}

type errReader struct{}

func (errReader) Read([]byte) (int, error) {
	return 0, io.ErrClosedPipe
}
