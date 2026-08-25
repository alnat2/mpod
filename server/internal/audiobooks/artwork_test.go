package audiobooks

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractEmbeddedArtwork_ID3v23APIC(t *testing.T) {
	tempDir := t.TempDir()
	mp3Path := filepath.Join(tempDir, "test.mp3")

	dummyJPEG := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46} // Fake JPEG header

	// Build ID3v2.3 tag with APIC frame
	var tagBuf bytes.Buffer

	// APIC frame body:
	// text encoding: 0 (ISO-8859-1)
	// mime type: "image/jpeg\x00"
	// picture type: 3 (Cover front)
	// description: "Cover\x00"
	// picture data: dummyJPEG
	var apicBody bytes.Buffer
	apicBody.WriteByte(0)
	apicBody.WriteString("image/jpeg\x00")
	apicBody.WriteByte(3)
	apicBody.WriteString("Cover\x00")
	apicBody.Write(dummyJPEG)

	apicBodyBytes := apicBody.Bytes()
	frameSize := uint32(len(apicBodyBytes))

	// APIC frame header: "APIC" (4 bytes) + frame size (4 bytes) + flags (2 bytes)
	var frameBuf bytes.Buffer
	frameBuf.WriteString("APIC")
	var sizeBytes [4]byte
	binary.BigEndian.PutUint32(sizeBytes[:], frameSize)
	frameBuf.Write(sizeBytes[:])
	frameBuf.Write([]byte{0, 0}) // flags
	frameBuf.Write(apicBodyBytes)

	frameBytes := frameBuf.Bytes()
	tagLen := uint32(len(frameBytes))

	// ID3v2 header: "ID3" (3 bytes) + version 2.3.0 (2 bytes) + flags (1 byte) + synchsafe size (4 bytes)
	tagBuf.WriteString("ID3\x03\x00\x00")
	// Synchsafe integer conversion
	tagBuf.WriteByte(byte((tagLen >> 21) & 0x7F))
	tagBuf.WriteByte(byte((tagLen >> 14) & 0x7F))
	tagBuf.WriteByte(byte((tagLen >> 7) & 0x7F))
	tagBuf.WriteByte(byte(tagLen & 0x7F))
	tagBuf.Write(frameBytes)

	// Append dummy audio payload
	tagBuf.Write([]byte{0xFF, 0xFB, 0x90, 0x64})

	if err := os.WriteFile(mp3Path, tagBuf.Bytes(), 0644); err != nil {
		t.Fatalf("write mp3: %v", err)
	}

	data, mime, err := ExtractEmbeddedArtwork(mp3Path)
	if err != nil {
		t.Fatalf("ExtractEmbeddedArtwork failed: %v", err)
	}

	if mime != "image/jpeg" {
		t.Errorf("expected mime image/jpeg, got %s", mime)
	}

	if !bytes.Equal(data, dummyJPEG) {
		t.Errorf("extracted image bytes do not match original")
	}
}

func TestExtractEmbeddedArtwork_MP4Covr(t *testing.T) {
	tempDir := t.TempDir()
	m4bPath := filepath.Join(tempDir, "test.m4b")

	dummyPNG := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A} // Fake PNG header

	// Build MP4 hierarchy: ftyp -> moov -> udta -> meta -> ilst -> covr -> data
	// data box: size(4) + "data" + typeCode(4, 14=PNG) + locale(4) + payload
	var dataBox bytes.Buffer
	dataPayloadSize := 8 + 8 + len(dummyPNG)
	binary.Write(&dataBox, binary.BigEndian, uint32(dataPayloadSize))
	dataBox.WriteString("data")
	binary.Write(&dataBox, binary.BigEndian, uint32(14)) // 14 = PNG
	binary.Write(&dataBox, binary.BigEndian, uint32(0))  // locale
	dataBox.Write(dummyPNG)

	// covr box: size(4) + "covr" + dataBox
	var covrBox bytes.Buffer
	binary.Write(&covrBox, binary.BigEndian, uint32(8+dataBox.Len()))
	covrBox.WriteString("covr")
	covrBox.Write(dataBox.Bytes())

	// ilst box: size(4) + "ilst" + covrBox
	var ilstBox bytes.Buffer
	binary.Write(&ilstBox, binary.BigEndian, uint32(8+covrBox.Len()))
	ilstBox.WriteString("ilst")
	ilstBox.Write(covrBox.Bytes())

	// meta box: size(4) + "meta" + flags/version(4) + ilstBox
	var metaBox bytes.Buffer
	binary.Write(&metaBox, binary.BigEndian, uint32(8+4+ilstBox.Len()))
	metaBox.WriteString("meta")
	metaBox.Write([]byte{0, 0, 0, 0}) // 4 bytes version/flags
	metaBox.Write(ilstBox.Bytes())

	// udta box: size(4) + "udta" + metaBox
	var udtaBox bytes.Buffer
	binary.Write(&udtaBox, binary.BigEndian, uint32(8+metaBox.Len()))
	udtaBox.WriteString("udta")
	udtaBox.Write(metaBox.Bytes())

	// moov box: size(4) + "moov" + udtaBox
	var moovBox bytes.Buffer
	binary.Write(&moovBox, binary.BigEndian, uint32(8+udtaBox.Len()))
	moovBox.WriteString("moov")
	moovBox.Write(udtaBox.Bytes())

	// ftyp box
	var fileBuf bytes.Buffer
	fileBuf.Write([]byte{0x00, 0x00, 0x00, 0x14, 'f', 't', 'y', 'p', 'M', '4', 'B', ' ', 0x00, 0x00, 0x00, 0x00, 'M', '4', 'B', ' '})
	fileBuf.Write(moovBox.Bytes())

	if err := os.WriteFile(m4bPath, fileBuf.Bytes(), 0644); err != nil {
		t.Fatalf("write m4b: %v", err)
	}

	data, mime, err := ExtractEmbeddedArtwork(m4bPath)
	if err != nil {
		t.Fatalf("ExtractEmbeddedArtwork failed for M4B: %v", err)
	}

	if mime != "image/png" {
		t.Errorf("expected mime image/png, got %s", mime)
	}

	if !bytes.Equal(data, dummyPNG) {
		t.Errorf("extracted image bytes do not match original")
	}
}

func TestExtractEmbeddedArtwork_NoArtwork(t *testing.T) {
	tempDir := t.TempDir()
	plainMp3 := filepath.Join(tempDir, "plain.mp3")
	if err := os.WriteFile(plainMp3, []byte{0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00}, 0644); err != nil {
		t.Fatalf("write plain mp3: %v", err)
	}

	_, _, err := ExtractEmbeddedArtwork(plainMp3)
	if err == nil {
		t.Errorf("expected error for file without artwork, got nil")
	}
}
