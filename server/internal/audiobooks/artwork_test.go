package audiobooks

import (
	"bytes"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

var (
	testJPEG = []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46}
	testPNG  = []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
)

func buildMP4WithCovr(dummyImage []byte, typeCode uint32) []byte {
	var dataBox bytes.Buffer
	dataPayloadSize := 8 + 8 + len(dummyImage)
	binary.Write(&dataBox, binary.BigEndian, uint32(dataPayloadSize))
	dataBox.WriteString("data")
	binary.Write(&dataBox, binary.BigEndian, typeCode)
	binary.Write(&dataBox, binary.BigEndian, uint32(0)) // locale
	dataBox.Write(dummyImage)

	var covrBox bytes.Buffer
	binary.Write(&covrBox, binary.BigEndian, uint32(8+dataBox.Len()))
	covrBox.WriteString("covr")
	covrBox.Write(dataBox.Bytes())

	var ilstBox bytes.Buffer
	binary.Write(&ilstBox, binary.BigEndian, uint32(8+covrBox.Len()))
	ilstBox.WriteString("ilst")
	ilstBox.Write(covrBox.Bytes())

	var metaBox bytes.Buffer
	binary.Write(&metaBox, binary.BigEndian, uint32(8+4+ilstBox.Len()))
	metaBox.WriteString("meta")
	metaBox.Write([]byte{0, 0, 0, 0}) // 4 bytes version/flags
	metaBox.Write(ilstBox.Bytes())

	var udtaBox bytes.Buffer
	binary.Write(&udtaBox, binary.BigEndian, uint32(8+metaBox.Len()))
	udtaBox.WriteString("udta")
	udtaBox.Write(metaBox.Bytes())

	var moovBox bytes.Buffer
	binary.Write(&moovBox, binary.BigEndian, uint32(8+udtaBox.Len()))
	moovBox.WriteString("moov")
	moovBox.Write(udtaBox.Bytes())

	var fileBuf bytes.Buffer
	fileBuf.Write([]byte{0x00, 0x00, 0x00, 0x14, 'f', 't', 'y', 'p', 'M', '4', 'B', ' ', 0x00, 0x00, 0x00, 0x00, 'M', '4', 'B', ' '})
	fileBuf.Write(moovBox.Bytes())
	return fileBuf.Bytes()
}

func encodeSynchsafe(n uint32) [4]byte {
	return [4]byte{
		byte((n >> 21) & 0x7F),
		byte((n >> 14) & 0x7F),
		byte((n >> 7) & 0x7F),
		byte(n & 0x7F),
	}
}

// 1. Valid MP3 ID3v2.2/v2.3/v2.4 APIC/PIC and MP4 covr continue returning image & MIME
func TestExtractEmbeddedArtwork_ValidFormats(t *testing.T) {
	tempDir := t.TempDir()

	t.Run("ID3v2.2_PIC_JPEG", func(t *testing.T) {
		var picBody bytes.Buffer
		picBody.WriteByte(0)          // ISO-8859-1
		picBody.WriteString("JPG")    // 3-byte format
		picBody.WriteByte(3)          // Cover front
		picBody.WriteString("Pic\x00") // Description null terminated
		picBody.Write(testJPEG)

		var frameBuf bytes.Buffer
		frameBuf.WriteString("PIC")
		bodyLen := picBody.Len()
		frameBuf.WriteByte(byte((bodyLen >> 16) & 0xFF))
		frameBuf.WriteByte(byte((bodyLen >> 8) & 0xFF))
		frameBuf.WriteByte(byte(bodyLen & 0xFF))
		frameBuf.Write(picBody.Bytes())

		tagLen := uint32(frameBuf.Len())
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x02\x00\x00")
		ss := encodeSynchsafe(tagLen)
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBuf.Bytes())
		tagBuf.Write([]byte{0xFF, 0xFB, 0x90, 0x64}) // dummy audio frame

		mp3Path := filepath.Join(tempDir, "v22.mp3")
		if err := os.WriteFile(mp3Path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		data, mime, err := ExtractEmbeddedArtwork(mp3Path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mime != "image/jpeg" {
			t.Errorf("expected image/jpeg, got %s", mime)
		}
		if !bytes.Equal(data, testJPEG) {
			t.Errorf("image data mismatch")
		}
	})

	t.Run("ID3v2.2_PIC_PNG", func(t *testing.T) {
		var picBody bytes.Buffer
		picBody.WriteByte(0)
		picBody.WriteString("PNG")
		picBody.WriteByte(3)
		picBody.WriteString("\x00") // empty description
		picBody.Write(testPNG)

		var frameBuf bytes.Buffer
		frameBuf.WriteString("PIC")
		bodyLen := picBody.Len()
		frameBuf.WriteByte(byte((bodyLen >> 16) & 0xFF))
		frameBuf.WriteByte(byte((bodyLen >> 8) & 0xFF))
		frameBuf.WriteByte(byte(bodyLen & 0xFF))
		frameBuf.Write(picBody.Bytes())

		tagLen := uint32(frameBuf.Len())
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x02\x00\x00")
		ss := encodeSynchsafe(tagLen)
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBuf.Bytes())

		mp3Path := filepath.Join(tempDir, "v22_png.mp3")
		if err := os.WriteFile(mp3Path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		data, mime, err := ExtractEmbeddedArtwork(mp3Path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mime != "image/png" {
			t.Errorf("expected image/png, got %s", mime)
		}
		if !bytes.Equal(data, testPNG) {
			t.Errorf("image data mismatch")
		}
	})

	t.Run("ID3v2.3_APIC_JPEG", func(t *testing.T) {
		var apicBody bytes.Buffer
		apicBody.WriteByte(0) // ISO-8859-1
		apicBody.WriteString("image/jpeg\x00")
		apicBody.WriteByte(3)
		apicBody.WriteString("Front Cover\x00")
		apicBody.Write(testJPEG)

		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		var sz [4]byte
		binary.BigEndian.PutUint32(sz[:], uint32(apicBody.Len()))
		frameBuf.Write(sz[:])
		frameBuf.Write([]byte{0, 0}) // flags
		frameBuf.Write(apicBody.Bytes())

		tagLen := uint32(frameBuf.Len())
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(tagLen)
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBuf.Bytes())

		mp3Path := filepath.Join(tempDir, "v23.mp3")
		if err := os.WriteFile(mp3Path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		data, mime, err := ExtractEmbeddedArtwork(mp3Path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mime != "image/jpeg" {
			t.Errorf("expected image/jpeg, got %s", mime)
		}
		if !bytes.Equal(data, testJPEG) {
			t.Errorf("image data mismatch")
		}
	})

	t.Run("ID3v2.3_APIC_PNG_UTF16", func(t *testing.T) {
		var apicBody bytes.Buffer
		apicBody.WriteByte(1) // UTF-16 with BOM
		apicBody.WriteString("image/png\x00")
		apicBody.WriteByte(3)
		// UTF-16 BOM (FF FE) + 'C' (43 00) + double null (00 00)
		apicBody.Write([]byte{0xFF, 0xFE, 0x43, 0x00, 0x00, 0x00})
		apicBody.Write(testPNG)

		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		var sz [4]byte
		binary.BigEndian.PutUint32(sz[:], uint32(apicBody.Len()))
		frameBuf.Write(sz[:])
		frameBuf.Write([]byte{0, 0})
		frameBuf.Write(apicBody.Bytes())

		tagLen := uint32(frameBuf.Len())
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(tagLen)
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBuf.Bytes())

		mp3Path := filepath.Join(tempDir, "v23_utf16.mp3")
		if err := os.WriteFile(mp3Path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		data, mime, err := ExtractEmbeddedArtwork(mp3Path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mime != "image/png" {
			t.Errorf("expected image/png, got %s", mime)
		}
		if !bytes.Equal(data, testPNG) {
			t.Errorf("image data mismatch")
		}
	})

	t.Run("ID3v2.4_APIC_JPEG_UTF8", func(t *testing.T) {
		var apicBody bytes.Buffer
		apicBody.WriteByte(3) // UTF-8
		apicBody.WriteString("image/jpeg\x00")
		apicBody.WriteByte(3)
		apicBody.WriteString("Front\x00")
		apicBody.Write(testJPEG)

		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		// In v2.4, frame size is synchsafe
		ssFrame := encodeSynchsafe(uint32(apicBody.Len()))
		frameBuf.Write(ssFrame[:])
		frameBuf.Write([]byte{0, 0}) // flags
		frameBuf.Write(apicBody.Bytes())

		tagLen := uint32(frameBuf.Len())
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x04\x00\x00")
		ss := encodeSynchsafe(tagLen)
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBuf.Bytes())

		mp3Path := filepath.Join(tempDir, "v24.mp3")
		if err := os.WriteFile(mp3Path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		data, mime, err := ExtractEmbeddedArtwork(mp3Path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mime != "image/jpeg" {
			t.Errorf("expected image/jpeg, got %s", mime)
		}
		if !bytes.Equal(data, testJPEG) {
			t.Errorf("image data mismatch")
		}
	})

	t.Run("MP4_Covr_PNG", func(t *testing.T) {
		m4bBytes := buildMP4WithCovr(testPNG, 14)
		m4bPath := filepath.Join(tempDir, "test.m4b")
		if err := os.WriteFile(m4bPath, m4bBytes, 0644); err != nil {
			t.Fatal(err)
		}

		data, mime, err := ExtractEmbeddedArtwork(m4bPath)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mime != "image/png" {
			t.Errorf("expected image/png, got %s", mime)
		}
		if !bytes.Equal(data, testPNG) {
			t.Errorf("image data mismatch")
		}
	})

	t.Run("MP4_Covr_JPEG", func(t *testing.T) {
		m4bBytes := buildMP4WithCovr(testJPEG, 13) // 13 = JPEG
		m4bPath := filepath.Join(tempDir, "test_jpg.m4a")
		if err := os.WriteFile(m4bPath, m4bBytes, 0644); err != nil {
			t.Fatal(err)
		}

		data, mime, err := ExtractEmbeddedArtwork(m4bPath)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if mime != "image/jpeg" {
			t.Errorf("expected image/jpeg, got %s", mime)
		}
		if !bytes.Equal(data, testJPEG) {
			t.Errorf("image data mismatch")
		}
	})
}

// 2. Declared ID3 tag larger than actual file, > 64 MiB, and near-overflow does not cause large allocation/read
func TestExtractEmbeddedArtwork_ID3TagLimits(t *testing.T) {
	tempDir := t.TempDir()

	t.Run("DeclaredTagLargerThanFile", func(t *testing.T) {
		// File is only 20 bytes, but ID3 header claims 1000 bytes
		var buf bytes.Buffer
		buf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(1000)
		buf.Write(ss[:])
		buf.Write([]byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A})

		path := filepath.Join(tempDir, "short_tag.mp3")
		if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		var m1, m2 runtime.MemStats
		runtime.ReadMemStats(&m1)
		_, _, err := ExtractEmbeddedArtwork(path)
		runtime.ReadMemStats(&m2)

		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
		if alloc := m2.TotalAlloc - m1.TotalAlloc; alloc > 1024*1024 {
			t.Errorf("excessive allocation on oversized tag header: %d bytes", alloc)
		}
	})

	t.Run("DeclaredTagLargerThan64MiB", func(t *testing.T) {
		// File is ~20 bytes, but ID3 header claims 65 MiB
		var buf bytes.Buffer
		buf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(65 * 1024 * 1024)
		buf.Write(ss[:])
		buf.Write([]byte{0x01, 0x02, 0x03, 0x04, 0x05})

		path := filepath.Join(tempDir, "over64mb_tag.mp3")
		if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		var m1, m2 runtime.MemStats
		runtime.ReadMemStats(&m1)
		_, _, err := ExtractEmbeddedArtwork(path)
		runtime.ReadMemStats(&m2)

		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
		if alloc := m2.TotalAlloc - m1.TotalAlloc; alloc > 1024*1024 {
			t.Errorf("excessive allocation on >64MiB tag header: %d bytes", alloc)
		}
	})

	t.Run("DeclaredTagNearOverflow", func(t *testing.T) {
		// Synchsafe with max 7-bit values (0x7F 0x7F 0x7F 0x7F = 256 MiB) or non-synchsafe 0xFF
		for _, sizeBytes := range [][]byte{
			{0x7F, 0x7F, 0x7F, 0x7F},
			{0xFF, 0xFF, 0xFF, 0xFF},
		} {
			var buf bytes.Buffer
			buf.WriteString("ID3\x03\x00\x00")
			buf.Write(sizeBytes)
			buf.Write([]byte{0x00, 0x00, 0x00, 0x00})

			path := filepath.Join(tempDir, "overflow_tag.mp3")
			if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
				t.Fatal(err)
			}

			var m1, m2 runtime.MemStats
			runtime.ReadMemStats(&m1)
			_, _, err := ExtractEmbeddedArtwork(path)
			runtime.ReadMemStats(&m2)

			if !errors.Is(err, ErrNoEmbeddedArtwork) {
				t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
			}
			if alloc := m2.TotalAlloc - m1.TotalAlloc; alloc > 1024*1024 {
				t.Errorf("excessive allocation on overflow tag header: %d bytes", alloc)
			}
		}
	})
}

// 3. APIC/covr payload > 32 MiB rejected before allocation; exact 32 MiB accepted with service fields not reducing payload
func TestExtractEmbeddedArtwork_PayloadLimits(t *testing.T) {
	tempDir := t.TempDir()

	t.Run("APIC_PayloadExact32MiB_Accepted", func(t *testing.T) {
		// APIC envelope header: encoding(1) + mime("image/jpeg\x00", 11) + picType(1) + description("Cover\x00", 6) = 19 bytes
		var apicHdr bytes.Buffer
		apicHdr.WriteByte(0)
		apicHdr.WriteString("image/jpeg\x00")
		apicHdr.WriteByte(3)
		apicHdr.WriteString("Cover\x00")
		hdrBytes := apicHdr.Bytes()

		const exact32MiB = 32 * 1024 * 1024
		frameBodySize := uint32(len(hdrBytes) + exact32MiB)

		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		var sz [4]byte
		binary.BigEndian.PutUint32(sz[:], frameBodySize)
		frameBuf.Write(sz[:])
		frameBuf.Write([]byte{0, 0}) // flags
		frameBuf.Write(hdrBytes)
		frameBuf.Write(testJPEG)

		frameBytes := frameBuf.Bytes()
		totalTagSize := uint32(len(frameBytes) - len(testJPEG) + exact32MiB)

		var tagHdr bytes.Buffer
		tagHdr.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(totalTagSize)
		tagHdr.Write(ss[:])
		tagHdr.Write(frameBytes)

		totalFileSize := int64(tagHdr.Len() - len(testJPEG) + exact32MiB)

		path := filepath.Join(tempDir, "apic_exact32mb.mp3")
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write(tagHdr.Bytes()); err != nil {
			f.Close()
			t.Fatal(err)
		}
		if err := f.Truncate(totalFileSize); err != nil {
			f.Close()
			t.Fatal(err)
		}
		f.Close()

		data, mime, err := ExtractEmbeddedArtwork(path)
		if err != nil {
			t.Fatalf("unexpected error for exact 32 MiB payload: %v", err)
		}
		if len(data) != exact32MiB {
			t.Fatalf("expected exactly %d bytes, got %d", exact32MiB, len(data))
		}
		if mime != "image/jpeg" {
			t.Errorf("expected mime image/jpeg, got %s", mime)
		}
		if !bytes.Equal(data[:len(testJPEG)], testJPEG) {
			t.Errorf("image header bytes mismatch")
		}
	})

	t.Run("APIC_Payload32MiBPlusOne_Rejected", func(t *testing.T) {
		var apicHdr bytes.Buffer
		apicHdr.WriteByte(0)
		apicHdr.WriteString("image/jpeg\x00")
		apicHdr.WriteByte(3)
		apicHdr.WriteString("Cover\x00")
		hdrBytes := apicHdr.Bytes()

		const overLimit = 32*1024*1024 + 1
		frameBodySize := uint32(len(hdrBytes) + overLimit)

		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		var sz [4]byte
		binary.BigEndian.PutUint32(sz[:], frameBodySize)
		frameBuf.Write(sz[:])
		frameBuf.Write([]byte{0, 0})
		frameBuf.Write(hdrBytes)
		frameBuf.Write(testJPEG)

		frameBytes := frameBuf.Bytes()
		totalTagSize := uint32(len(frameBytes) - len(testJPEG) + overLimit)

		var tagHdr bytes.Buffer
		tagHdr.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(totalTagSize)
		tagHdr.Write(ss[:])
		tagHdr.Write(frameBytes)

		totalFileSize := int64(tagHdr.Len() - len(testJPEG) + overLimit)

		path := filepath.Join(tempDir, "apic_32mb_plus_1.mp3")
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write(tagHdr.Bytes()); err != nil {
			f.Close()
			t.Fatal(err)
		}
		if err := f.Truncate(totalFileSize); err != nil {
			f.Close()
			t.Fatal(err)
		}
		f.Close()

		var m1, m2 runtime.MemStats
		runtime.ReadMemStats(&m1)
		_, _, err = ExtractEmbeddedArtwork(path)
		runtime.ReadMemStats(&m2)

		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Fatalf("expected ErrNoEmbeddedArtwork for 32MiB+1, got %v", err)
		}
		if alloc := m2.TotalAlloc - m1.TotalAlloc; alloc > 1024*1024 {
			t.Fatalf("excessive allocation on 32MiB+1 rejection: %d bytes", alloc)
		}
	})

	t.Run("APIC_PayloadExceeds32MiB", func(t *testing.T) {
		// Valid ID3 tag header with size 100, but APIC frame claims 33 MiB
		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		var sz [4]byte
		binary.BigEndian.PutUint32(sz[:], 33*1024*1024)
		frameBuf.Write(sz[:])
		frameBuf.Write([]byte{0, 0}) // flags
		frameBuf.Write([]byte{0, 'i', 'm', 'a', 'g', 'e', '/', 'j', 'p', 'g', 0})

		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(uint32(frameBuf.Len()))
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBuf.Bytes())

		path := filepath.Join(tempDir, "large_apic.mp3")
		if err := os.WriteFile(path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		var m1, m2 runtime.MemStats
		runtime.ReadMemStats(&m1)
		_, _, err := ExtractEmbeddedArtwork(path)
		runtime.ReadMemStats(&m2)

		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
		if alloc := m2.TotalAlloc - m1.TotalAlloc; alloc > 1024*1024 {
			t.Errorf("excessive allocation on >32MiB APIC: %d bytes", alloc)
		}
	})

	t.Run("MP4_Covr_PayloadExceeds32MiB", func(t *testing.T) {
		// MP4 hierarchy where data box claims 33 MiB
		var dataBox bytes.Buffer
		binary.Write(&dataBox, binary.BigEndian, uint32(33*1024*1024))
		dataBox.WriteString("data")
		binary.Write(&dataBox, binary.BigEndian, uint32(14))
		binary.Write(&dataBox, binary.BigEndian, uint32(0))
		dataBox.Write([]byte{0x01, 0x02, 0x03, 0x04})

		var covrBox bytes.Buffer
		binary.Write(&covrBox, binary.BigEndian, uint32(8+dataBox.Len()))
		covrBox.WriteString("covr")
		covrBox.Write(dataBox.Bytes())

		var ilstBox bytes.Buffer
		binary.Write(&ilstBox, binary.BigEndian, uint32(8+covrBox.Len()))
		ilstBox.WriteString("ilst")
		ilstBox.Write(covrBox.Bytes())

		var metaBox bytes.Buffer
		binary.Write(&metaBox, binary.BigEndian, uint32(8+4+ilstBox.Len()))
		metaBox.WriteString("meta")
		metaBox.Write([]byte{0, 0, 0, 0})
		metaBox.Write(ilstBox.Bytes())

		var udtaBox bytes.Buffer
		binary.Write(&udtaBox, binary.BigEndian, uint32(8+metaBox.Len()))
		udtaBox.WriteString("udta")
		udtaBox.Write(metaBox.Bytes())

		var moovBox bytes.Buffer
		binary.Write(&moovBox, binary.BigEndian, uint32(8+udtaBox.Len()))
		moovBox.WriteString("moov")
		moovBox.Write(udtaBox.Bytes())

		path := filepath.Join(tempDir, "large_covr.m4b")
		if err := os.WriteFile(path, moovBox.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		var m1, m2 runtime.MemStats
		runtime.ReadMemStats(&m1)
		_, _, err := ExtractEmbeddedArtwork(path)
		runtime.ReadMemStats(&m2)

		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
		if alloc := m2.TotalAlloc - m1.TotalAlloc; alloc > 1024*1024 {
			t.Errorf("excessive allocation on >32MiB covr data: %d bytes", alloc)
		}
	})
}

// Tests for streaming envelope delimiter search, UTF-16 chunk boundary straddling, and malformed frames
func TestExtractEmbeddedArtwork_DescriptionStreamingAndStraddling(t *testing.T) {
	tempDir := t.TempDir()

	t.Run("APIC_DescriptionOver64KiB", func(t *testing.T) {
		// ID3v2.3 APIC with description longer than 64 KiB (70 KiB of ASCII) and a valid small JPEG
		const descLen = 70 * 1024
		descBytes := make([]byte, descLen)
		for i := range descBytes {
			descBytes[i] = 'D'
		}

		var apicBody bytes.Buffer
		apicBody.WriteByte(0) // ISO-8859-1
		apicBody.WriteString("image/jpeg\x00")
		apicBody.WriteByte(3) // cover front
		apicBody.Write(descBytes)
		apicBody.WriteByte(0) // null terminator for description
		apicBody.Write(testJPEG)

		apicBytes := apicBody.Bytes()
		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		var sz [4]byte
		binary.BigEndian.PutUint32(sz[:], uint32(len(apicBytes)))
		frameBuf.Write(sz[:])
		frameBuf.Write([]byte{0, 0}) // flags
		frameBuf.Write(apicBytes)

		frameBytes := frameBuf.Bytes()
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(uint32(len(frameBytes)))
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBytes)

		path := filepath.Join(tempDir, "apic_desc_over_64kb.mp3")
		if err := os.WriteFile(path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		data, mime, err := ExtractEmbeddedArtwork(path)
		if err != nil {
			t.Fatalf("unexpected error for APIC with >64KiB description: %v", err)
		}
		if mime != "image/jpeg" {
			t.Errorf("expected image/jpeg, got %s", mime)
		}
		if !bytes.Equal(data, testJPEG) {
			t.Errorf("extracted image bytes mismatch")
		}
	})

	t.Run("APIC_MIMEOver64KiB", func(t *testing.T) {
		// ID3v2.3 APIC with MIME field longer than 64 KiB (70 KiB) and a valid small JPEG
		const mimePaddingLen = 70 * 1024
		mimeBytes := make([]byte, mimePaddingLen)
		for i := range mimeBytes {
			mimeBytes[i] = ' '
		}

		var apicBody bytes.Buffer
		apicBody.WriteByte(0) // ISO-8859-1
		apicBody.WriteString("image/jpeg")
		apicBody.Write(mimeBytes)
		apicBody.WriteByte(0) // null terminator for MIME
		apicBody.WriteByte(3) // cover front
		apicBody.WriteString("Desc\x00")
		apicBody.Write(testJPEG)

		apicBytes := apicBody.Bytes()
		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		var sz [4]byte
		binary.BigEndian.PutUint32(sz[:], uint32(len(apicBytes)))
		frameBuf.Write(sz[:])
		frameBuf.Write([]byte{0, 0}) // flags
		frameBuf.Write(apicBytes)

		frameBytes := frameBuf.Bytes()
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(uint32(len(frameBytes)))
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBytes)

		path := filepath.Join(tempDir, "apic_mime_over_64kb.mp3")
		if err := os.WriteFile(path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		data, _, err := ExtractEmbeddedArtwork(path)
		if err != nil {
			t.Fatalf("unexpected error for APIC with >64KiB MIME: %v", err)
		}
		if !bytes.Equal(data, testJPEG) {
			t.Errorf("extracted image bytes mismatch")
		}
	})

	t.Run("UTF16_TerminatorStraddlesChunkBoundary", func(t *testing.T) {
		// Set internal chunk size to an odd number (63 bytes) so that an aligned UTF-16
		// code unit (at even offset 62) has its first 0x00 byte at index 62 (end of chunk 1)
		// and its second 0x00 byte at index 63 (start of chunk 2).
		origChunkSize := envelopeChunkSize
		envelopeChunkSize = 63
		defer func() {
			envelopeChunkSize = origChunkSize
		}()

		var descBuf bytes.Buffer
		descBuf.Write([]byte{0xFF, 0xFE}) // BOM (2 bytes, offsets 0-1)
		// 30 UTF-16 'A' characters = 60 bytes (offsets 2-61)
		for i := 0; i < 30; i++ {
			descBuf.Write([]byte{'A', 0})
		}
		// Terminator: 2 null bytes at offsets 62 and 63
		descBuf.Write([]byte{0x00, 0x00})

		var apicBody bytes.Buffer
		apicBody.WriteByte(1) // UTF-16 with BOM
		apicBody.WriteString("image/jpeg\x00")
		apicBody.WriteByte(3) // cover front
		apicBody.Write(descBuf.Bytes())
		apicBody.Write(testJPEG)

		apicBytes := apicBody.Bytes()
		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		var sz [4]byte
		binary.BigEndian.PutUint32(sz[:], uint32(len(apicBytes)))
		frameBuf.Write(sz[:])
		frameBuf.Write([]byte{0, 0})
		frameBuf.Write(apicBytes)

		frameBytes := frameBuf.Bytes()
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(uint32(len(frameBytes)))
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBytes)

		path := filepath.Join(tempDir, "utf16_straddle.mp3")
		if err := os.WriteFile(path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		data, mime, err := ExtractEmbeddedArtwork(path)
		if err != nil {
			t.Fatalf("unexpected error on chunk-straddling UTF-16 terminator: %v", err)
		}
		if mime != "image/jpeg" {
			t.Errorf("expected image/jpeg, got %s", mime)
		}
		if !bytes.Equal(data, testJPEG) {
			t.Errorf("extracted image bytes mismatch")
		}
	})

	t.Run("APIC_MissingTerminator_SafeError", func(t *testing.T) {
		// APIC frame where description runs until end of frame without null terminator
		const descLen = 16 * 1024
		descBytes := make([]byte, descLen)
		for i := range descBytes {
			descBytes[i] = 'X' // no null byte anywhere
		}

		var apicBody bytes.Buffer
		apicBody.WriteByte(0) // ISO-8859-1
		apicBody.WriteString("image/jpeg\x00")
		apicBody.WriteByte(3)
		apicBody.Write(descBytes)

		apicBytes := apicBody.Bytes()
		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		var sz [4]byte
		binary.BigEndian.PutUint32(sz[:], uint32(len(apicBytes)))
		frameBuf.Write(sz[:])
		frameBuf.Write([]byte{0, 0})
		frameBuf.Write(apicBytes)

		frameBytes := frameBuf.Bytes()
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(uint32(len(frameBytes)))
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBytes)

		path := filepath.Join(tempDir, "apic_no_terminator.mp3")
		if err := os.WriteFile(path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		var m1, m2 runtime.MemStats
		runtime.ReadMemStats(&m1)
		_, _, err := ExtractEmbeddedArtwork(path)
		runtime.ReadMemStats(&m2)

		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Fatalf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
		if alloc := m2.TotalAlloc - m1.TotalAlloc; alloc > 1024*1024 {
			t.Fatalf("excessive allocation on missing terminator: %d bytes", alloc)
		}
	})

	t.Run("APIC_MIMEMissingTerminator_SafeError", func(t *testing.T) {
		// APIC frame where MIME runs until end of frame without null terminator
		const mimeLen = 16 * 1024
		mimeBytes := make([]byte, mimeLen)
		for i := range mimeBytes {
			mimeBytes[i] = 'M' // no null byte anywhere
		}

		var apicBody bytes.Buffer
		apicBody.WriteByte(0) // ISO-8859-1
		apicBody.Write(mimeBytes)

		apicBytes := apicBody.Bytes()
		var frameBuf bytes.Buffer
		frameBuf.WriteString("APIC")
		var sz [4]byte
		binary.BigEndian.PutUint32(sz[:], uint32(len(apicBytes)))
		frameBuf.Write(sz[:])
		frameBuf.Write([]byte{0, 0})
		frameBuf.Write(apicBytes)

		frameBytes := frameBuf.Bytes()
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(uint32(len(frameBytes)))
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBytes)

		path := filepath.Join(tempDir, "apic_mime_no_terminator.mp3")
		if err := os.WriteFile(path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		var m1, m2 runtime.MemStats
		runtime.ReadMemStats(&m1)
		_, _, err := ExtractEmbeddedArtwork(path)
		runtime.ReadMemStats(&m2)

		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Fatalf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
		if alloc := m2.TotalAlloc - m1.TotalAlloc; alloc > 1024*1024 {
			t.Fatalf("excessive allocation on missing MIME terminator: %d bytes", alloc)
		}
	})

	t.Run("PIC_MissingTerminator_SafeError", func(t *testing.T) {
		// ID3v2.2 PIC frame without description null terminator
		const descLen = 8 * 1024
		descBytes := make([]byte, descLen)
		for i := range descBytes {
			descBytes[i] = 'Y'
		}

		var picBody bytes.Buffer
		picBody.WriteByte(0)       // ISO-8859-1
		picBody.WriteString("JPG") // 3-byte format
		picBody.WriteByte(3)       // picType
		picBody.Write(descBytes)   // no null terminator

		bodyBytes := picBody.Bytes()
		var frameBuf bytes.Buffer
		frameBuf.WriteString("PIC")
		bLen := len(bodyBytes)
		frameBuf.WriteByte(byte((bLen >> 16) & 0xFF))
		frameBuf.WriteByte(byte((bLen >> 8) & 0xFF))
		frameBuf.WriteByte(byte(bLen & 0xFF))
		frameBuf.Write(bodyBytes)

		frameBytes := frameBuf.Bytes()
		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x02\x00\x00")
		ss := encodeSynchsafe(uint32(len(frameBytes)))
		tagBuf.Write(ss[:])
		tagBuf.Write(frameBytes)

		path := filepath.Join(tempDir, "pic_no_terminator.mp3")
		if err := os.WriteFile(path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		var m1, m2 runtime.MemStats
		runtime.ReadMemStats(&m1)
		_, _, err := ExtractEmbeddedArtwork(path)
		runtime.ReadMemStats(&m2)

		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Fatalf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
		if alloc := m2.TotalAlloc - m1.TotalAlloc; alloc > 1024*1024 {
			t.Fatalf("excessive allocation on missing terminator: %d bytes", alloc)
		}
	})
}

// MP4 metadata container (moov.udta.meta) limit tests
func TestExtractEmbeddedArtwork_MP4MetadataContainerLimits(t *testing.T) {
	tempDir := t.TempDir()

	t.Run("MetaExceeds64MiB_SparseFile", func(t *testing.T) {
		// Formal container/file bounds are valid (total file size 70 MiB), but meta is 65 MiB (> 64 MiB)
		const totalFileSize = int64(70 * 1024 * 1024)
		const metaSize = uint32(65 * 1024 * 1024)

		path := filepath.Join(tempDir, "meta_over64mb.m4b")
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}

		// ftyp: 20 bytes
		ftyp := []byte{0x00, 0x00, 0x00, 0x14, 'f', 't', 'y', 'p', 'M', '4', 'B', ' ', 0x00, 0x00, 0x00, 0x00, 'M', '4', 'B', ' '}
		f.Write(ftyp)

		// moov: size = 70 MiB - 20
		var moovHdr [8]byte
		binary.BigEndian.PutUint32(moovHdr[0:4], uint32(totalFileSize-20))
		copy(moovHdr[4:8], "moov")
		f.Write(moovHdr[:])

		// udta: size = 70 MiB - 28
		var udtaHdr [8]byte
		binary.BigEndian.PutUint32(udtaHdr[0:4], uint32(totalFileSize-28))
		copy(udtaHdr[4:8], "udta")
		f.Write(udtaHdr[:])

		// meta: size = 65 MiB
		var metaHdr [8]byte
		binary.BigEndian.PutUint32(metaHdr[0:4], metaSize)
		copy(metaHdr[4:8], "meta")
		f.Write(metaHdr[:])
		f.Write([]byte{0, 0, 0, 0}) // version & flags

		if err := f.Truncate(totalFileSize); err != nil {
			f.Close()
			t.Fatal(err)
		}
		f.Close()

		var m1, m2 runtime.MemStats
		runtime.ReadMemStats(&m1)
		_, _, err = ExtractEmbeddedArtwork(path)
		runtime.ReadMemStats(&m2)

		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Fatalf("expected ErrNoEmbeddedArtwork for meta > 64MiB, got %v", err)
		}
		if alloc := m2.TotalAlloc - m1.TotalAlloc; alloc > 1024*1024 {
			t.Fatalf("excessive allocation on meta > 64MiB: %d bytes", alloc)
		}
	})

	t.Run("MetaAt64MiBBoundary_ValidCovr", func(t *testing.T) {
		// meta is exactly 64 MiB, with valid ilst -> covr -> data and free padding
		const metaTotalSize = int64(MaxMetadataContainerSize) // 64 * 1024 * 1024

		// Build ilst box with testPNG
		var dataBox bytes.Buffer
		binary.Write(&dataBox, binary.BigEndian, uint32(8+8+len(testPNG)))
		dataBox.WriteString("data")
		binary.Write(&dataBox, binary.BigEndian, uint32(14)) // PNG
		binary.Write(&dataBox, binary.BigEndian, uint32(0))  // locale
		dataBox.Write(testPNG)

		var covrBox bytes.Buffer
		binary.Write(&covrBox, binary.BigEndian, uint32(8+dataBox.Len()))
		covrBox.WriteString("covr")
		covrBox.Write(dataBox.Bytes())

		var ilstBox bytes.Buffer
		binary.Write(&ilstBox, binary.BigEndian, uint32(8+covrBox.Len()))
		ilstBox.WriteString("ilst")
		ilstBox.Write(covrBox.Bytes())

		// Free box to pad meta up to exactly 64 MiB
		usedInMeta := int64(8 + 4 + ilstBox.Len()) // header(8) + flags(4) + ilst
		freeBoxSize := metaTotalSize - usedInMeta
		var freeHdr [8]byte
		binary.BigEndian.PutUint32(freeHdr[0:4], uint32(freeBoxSize))
		copy(freeHdr[4:8], "free")

		// moov and udta sizes
		udtaTotalSize := 8 + metaTotalSize
		moovTotalSize := 8 + udtaTotalSize
		totalFileSize := int64(20 + moovTotalSize)

		path := filepath.Join(tempDir, "meta_exact64mb.m4b")
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}

		ftyp := []byte{0x00, 0x00, 0x00, 0x14, 'f', 't', 'y', 'p', 'M', '4', 'B', ' ', 0x00, 0x00, 0x00, 0x00, 'M', '4', 'B', ' '}
		f.Write(ftyp)

		var moovHdr [8]byte
		binary.BigEndian.PutUint32(moovHdr[0:4], uint32(moovTotalSize))
		copy(moovHdr[4:8], "moov")
		f.Write(moovHdr[:])

		var udtaHdr [8]byte
		binary.BigEndian.PutUint32(udtaHdr[0:4], uint32(udtaTotalSize))
		copy(udtaHdr[4:8], "udta")
		f.Write(udtaHdr[:])

		var metaHdr [8]byte
		binary.BigEndian.PutUint32(metaHdr[0:4], uint32(metaTotalSize))
		copy(metaHdr[4:8], "meta")
		f.Write(metaHdr[:])
		f.Write([]byte{0, 0, 0, 0}) // version & flags
		f.Write(ilstBox.Bytes())
		f.Write(freeHdr[:])

		if err := f.Truncate(totalFileSize); err != nil {
			f.Close()
			t.Fatal(err)
		}
		f.Close()

		data, mime, err := ExtractEmbeddedArtwork(path)
		if err != nil {
			t.Fatalf("unexpected error on 64 MiB boundary meta: %v", err)
		}
		if mime != "image/png" {
			t.Errorf("expected mime image/png, got %s", mime)
		}
		if !bytes.Equal(data, testPNG) {
			t.Errorf("extracted image bytes mismatch")
		}
	})

	t.Run("LargeMoovWithNormalMeta_Accepted", func(t *testing.T) {
		// moov is >64 MiB (e.g. 70 MiB media container with long audio tracks), but meta is small
		const totalFileSize = int64(70 * 1024 * 1024)

		m4bBytes := buildMP4WithCovr(testPNG, 14)
		// Extract moov box content from normal build
		// m4bBytes has: ftyp (20 bytes) + moov (rest)
		normalMoovBytes := m4bBytes[20:]

		path := filepath.Join(tempDir, "large_moov_normal_meta.m4b")
		f, err := os.Create(path)
		if err != nil {
			t.Fatal(err)
		}

		ftyp := m4bBytes[:20]
		f.Write(ftyp)

		// Overwrite moov header with large size
		var largeMoovHdr [8]byte
		binary.BigEndian.PutUint32(largeMoovHdr[0:4], uint32(totalFileSize-20))
		copy(largeMoovHdr[4:8], "moov")
		f.Write(largeMoovHdr[:])
		// Write the actual moov children (udta->meta->ilst->covr->data)
		f.Write(normalMoovBytes[8:])

		if err := f.Truncate(totalFileSize); err != nil {
			f.Close()
			t.Fatal(err)
		}
		f.Close()

		data, mime, err := ExtractEmbeddedArtwork(path)
		if err != nil {
			t.Fatalf("unexpected error for large moov: %v", err)
		}
		if mime != "image/png" {
			t.Errorf("expected mime image/png, got %s", mime)
		}
		if !bytes.Equal(data, testPNG) {
			t.Errorf("extracted image bytes mismatch")
		}
	})
}

// 4. MP4 box size=0/1, 64-bit size, size < header, child exceeds parent/file, truncated header/data end with controlled error
func TestExtractEmbeddedArtwork_MP4CorruptedBoxes(t *testing.T) {
	tempDir := t.TempDir()

	t.Run("BoxSizeZeroInsideContainer", func(t *testing.T) {
		// udta containing meta with size 0 (invalid inside container)
		var udta bytes.Buffer
		binary.Write(&udta, binary.BigEndian, uint32(16))
		udta.WriteString("udta")
		binary.Write(&udta, binary.BigEndian, uint32(0)) // size 0
		udta.WriteString("meta")

		var moov bytes.Buffer
		binary.Write(&moov, binary.BigEndian, uint32(8+udta.Len()))
		moov.WriteString("moov")
		moov.Write(udta.Bytes())

		path := filepath.Join(tempDir, "size0.m4b")
		if err := os.WriteFile(path, moov.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		_, _, err := ExtractEmbeddedArtwork(path)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})

	t.Run("BoxSizeOne_64BitUnder16", func(t *testing.T) {
		// Box size = 1, but 64-bit extended size is 10 (< 16)
		var buf bytes.Buffer
		binary.Write(&buf, binary.BigEndian, uint32(1))
		buf.WriteString("moov")
		binary.Write(&buf, binary.BigEndian, uint64(10)) // < 16 is invalid

		path := filepath.Join(tempDir, "size1_under16.m4b")
		if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		_, _, err := ExtractEmbeddedArtwork(path)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})

	t.Run("BoxSizeOne_64BitOverflow", func(t *testing.T) {
		// Box size = 1, extended size = 0xFFFFFFFFFFFFFFFF
		var buf bytes.Buffer
		binary.Write(&buf, binary.BigEndian, uint32(1))
		buf.WriteString("moov")
		binary.Write(&buf, binary.BigEndian, uint64(0xFFFFFFFFFFFFFFFF))

		path := filepath.Join(tempDir, "size1_overflow.m4b")
		if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		_, _, err := ExtractEmbeddedArtwork(path)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})

	t.Run("BoxSizeSmallerThanHeader", func(t *testing.T) {
		// Box size = 4 (smaller than 8-byte header)
		var buf bytes.Buffer
		binary.Write(&buf, binary.BigEndian, uint32(4))
		buf.WriteString("moov")

		path := filepath.Join(tempDir, "size_less_than_header.m4b")
		if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		_, _, err := ExtractEmbeddedArtwork(path)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})

	t.Run("ChildExceedsParent", func(t *testing.T) {
		// moov declared size 20, but child udta claims size 40
		var buf bytes.Buffer
		binary.Write(&buf, binary.BigEndian, uint32(20))
		buf.WriteString("moov")
		binary.Write(&buf, binary.BigEndian, uint32(40))
		buf.WriteString("udta")
		buf.Write(make([]byte, 20))

		path := filepath.Join(tempDir, "child_exceeds_parent.m4b")
		if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		_, _, err := ExtractEmbeddedArtwork(path)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})

	t.Run("ChildExceedsFile", func(t *testing.T) {
		// moov claims size 500 in a 20-byte file
		var buf bytes.Buffer
		binary.Write(&buf, binary.BigEndian, uint32(500))
		buf.WriteString("moov")
		buf.Write([]byte{1, 2, 3, 4, 5, 6, 7, 8})

		path := filepath.Join(tempDir, "child_exceeds_file.m4b")
		if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		_, _, err := ExtractEmbeddedArtwork(path)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})

	t.Run("TruncatedHeader", func(t *testing.T) {
		// File has only 4 bytes (truncated 8-byte header)
		path := filepath.Join(tempDir, "trunc_header.m4b")
		if err := os.WriteFile(path, []byte{0x00, 0x00, 0x00, 0x20}, 0644); err != nil {
			t.Fatal(err)
		}

		_, _, err := ExtractEmbeddedArtwork(path)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})

	t.Run("TruncatedCovrData", func(t *testing.T) {
		// Valid moov->udta->meta->ilst->covr->data, but data payload is truncated before completion
		fullBytes := buildMP4WithCovr(testPNG, 14)
		// Truncate the last 4 bytes of the image data
		truncBytes := fullBytes[:len(fullBytes)-4]

		path := filepath.Join(tempDir, "trunc_data.m4b")
		if err := os.WriteFile(path, truncBytes, 0644); err != nil {
			t.Fatal(err)
		}

		_, _, err := ExtractEmbeddedArtwork(path)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})
}

// 5. Audio file without embedded artwork preserves fallback
func TestExtractEmbeddedArtwork_NoArtwork_Fallback(t *testing.T) {
	tempDir := t.TempDir()

	t.Run("PlainMP3WithoutID3", func(t *testing.T) {
		plainMp3 := filepath.Join(tempDir, "plain.mp3")
		if err := os.WriteFile(plainMp3, []byte{0xFF, 0xFB, 0x90, 0x64, 0x00, 0x00}, 0644); err != nil {
			t.Fatal(err)
		}
		_, _, err := ExtractEmbeddedArtwork(plainMp3)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})

	t.Run("MP3WithID3NoAPIC", func(t *testing.T) {
		// ID3 tag with TIT2 (Title) frame only
		var tit2 bytes.Buffer
		tit2.WriteString("TIT2")
		binary.Write(&tit2, binary.BigEndian, uint32(6))
		tit2.Write([]byte{0, 0}) // flags
		tit2.WriteString("\x00Test")

		var tagBuf bytes.Buffer
		tagBuf.WriteString("ID3\x03\x00\x00")
		ss := encodeSynchsafe(uint32(tit2.Len()))
		tagBuf.Write(ss[:])
		tagBuf.Write(tit2.Bytes())

		mp3Path := filepath.Join(tempDir, "tit2_only.mp3")
		if err := os.WriteFile(mp3Path, tagBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		_, _, err := ExtractEmbeddedArtwork(mp3Path)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})

	t.Run("MP4WithoutCovr", func(t *testing.T) {
		// Valid MP4 with ftyp and moov containing only an empty trak box
		var trakBox bytes.Buffer
		binary.Write(&trakBox, binary.BigEndian, uint32(8))
		trakBox.WriteString("trak")

		var moovBox bytes.Buffer
		binary.Write(&moovBox, binary.BigEndian, uint32(8+trakBox.Len()))
		moovBox.WriteString("moov")
		moovBox.Write(trakBox.Bytes())

		var fileBuf bytes.Buffer
		fileBuf.Write([]byte{0x00, 0x00, 0x00, 0x14, 'f', 't', 'y', 'p', 'M', '4', 'B', ' ', 0x00, 0x00, 0x00, 0x00, 'M', '4', 'B', ' '})
		fileBuf.Write(moovBox.Bytes())

		path := filepath.Join(tempDir, "no_covr.m4b")
		if err := os.WriteFile(path, fileBuf.Bytes(), 0644); err != nil {
			t.Fatal(err)
		}

		_, _, err := ExtractEmbeddedArtwork(path)
		if !errors.Is(err, ErrNoEmbeddedArtwork) {
			t.Errorf("expected ErrNoEmbeddedArtwork, got %v", err)
		}
	})
}

// 6. Corrupted file does not break directory scanning of remaining books
func TestScanDirectory_CorruptedArtworkTolerance(t *testing.T) {
	tempDir := t.TempDir()

	// Book 1: Corrupted artwork in MP3 (oversized tag header)
	book1Dir := filepath.Join(tempDir, "CorruptBook")
	if err := os.MkdirAll(book1Dir, 0755); err != nil {
		t.Fatal(err)
	}
	var corruptTag bytes.Buffer
	corruptTag.WriteString("ID3\x03\x00\x00")
	ss := encodeSynchsafe(65 * 1024 * 1024)
	corruptTag.Write(ss[:])
	corruptTag.Write([]byte{0x00, 0x00, 0x00, 0x00})
	if err := os.WriteFile(filepath.Join(book1Dir, "track01.mp3"), corruptTag.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	// Book 2: Valid embedded artwork MP3
	book2Dir := filepath.Join(tempDir, "ValidBook")
	if err := os.MkdirAll(book2Dir, 0755); err != nil {
		t.Fatal(err)
	}
	var apicBody bytes.Buffer
	apicBody.WriteByte(0)
	apicBody.WriteString("image/jpeg\x00")
	apicBody.WriteByte(3)
	apicBody.WriteString("Cover\x00")
	apicBody.Write(testJPEG)

	var frameBuf bytes.Buffer
	frameBuf.WriteString("APIC")
	var sz [4]byte
	binary.BigEndian.PutUint32(sz[:], uint32(apicBody.Len()))
	frameBuf.Write(sz[:])
	frameBuf.Write([]byte{0, 0})
	frameBuf.Write(apicBody.Bytes())

	var validTag bytes.Buffer
	validTag.WriteString("ID3\x03\x00\x00")
	ssValid := encodeSynchsafe(uint32(frameBuf.Len()))
	validTag.Write(ssValid[:])
	validTag.Write(frameBuf.Bytes())
	validTag.Write([]byte{0xFF, 0xFB, 0x90, 0x64}) // dummy audio frame
	if err := os.WriteFile(filepath.Join(book2Dir, "chapter01.mp3"), validTag.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	books, err := ScanDirectory(tempDir)
	if err != nil {
		t.Fatalf("ScanDirectory failed unexpectedly: %v", err)
	}

	if len(books) != 2 {
		t.Fatalf("expected 2 books, got %d", len(books))
	}

	bookMap := make(map[string]ScannedBook)
	for _, b := range books {
		bookMap[b.Title] = b
	}

	corruptBook, ok := bookMap["CorruptBook"]
	if !ok {
		t.Errorf("missing CorruptBook")
	} else if corruptBook.CoverPath != "" {
		t.Errorf("expected empty CoverPath for CorruptBook, got %s", corruptBook.CoverPath)
	}

	validBook, ok := bookMap["ValidBook"]
	if !ok {
		t.Errorf("missing ValidBook")
	} else if validBook.CoverPath != "embedded:ValidBook/chapter01.mp3" {
		t.Errorf("expected embedded cover for ValidBook, got %s", validBook.CoverPath)
	}
}
