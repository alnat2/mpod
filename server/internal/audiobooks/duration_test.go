package audiobooks

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestReadAudioDurationMP3(t *testing.T) {
	path := filepath.Join(t.TempDir(), "chapter.mp3")
	frameHeader := []byte{0xff, 0xfb, 0x90, 0x00} // MPEG-1 Layer III, 128 kbps, 44.1 kHz.
	frameLength := 417
	data := make([]byte, frameLength*100)
	for offset := 0; offset < len(data); offset += frameLength {
		copy(data[offset:], frameHeader)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	duration, err := ReadAudioDuration(path)
	if err != nil {
		t.Fatalf("ReadAudioDuration failed: %v", err)
	}
	if duration != 3 {
		t.Fatalf("expected rounded duration 3 seconds, got %d", duration)
	}
}

func TestReadAudioDurationMP4(t *testing.T) {
	path := filepath.Join(t.TempDir(), "chapter.m4b")
	var mvhd bytes.Buffer
	mvhd.Write(make([]byte, 12))
	_ = binary.Write(&mvhd, binary.BigEndian, uint32(1000))
	_ = binary.Write(&mvhd, binary.BigEndian, uint32(125000))
	moov := mp4TestBox("moov", mp4TestBox("mvhd", mvhd.Bytes()))
	if err := os.WriteFile(path, moov, 0o644); err != nil {
		t.Fatal(err)
	}

	duration, err := ReadAudioDuration(path)
	if err != nil {
		t.Fatalf("ReadAudioDuration failed: %v", err)
	}
	if duration != 125 {
		t.Fatalf("expected duration 125 seconds, got %d", duration)
	}
}

func mp4TestBox(boxType string, content []byte) []byte {
	result := make([]byte, 8+len(content))
	binary.BigEndian.PutUint32(result[:4], uint32(len(result)))
	copy(result[4:8], boxType)
	copy(result[8:], content)
	return result
}
