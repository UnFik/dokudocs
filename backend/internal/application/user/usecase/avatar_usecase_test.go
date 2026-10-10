package usecase

import "testing"

func webpHeader(chunk string, body []byte) []byte {
	payload := append([]byte("WEBP"+chunk), 0, 0, 0, 0)
	payload = append(payload, body...)
	out := append([]byte("RIFF"), byte(len(payload)), 0, 0, 0)
	return append(out, payload...)
}

func TestCheckAvatarReadsEveryWebPHeader(t *testing.T) {
	// VP8X stores width-1 and height-1 in 24 bits each, starting at offset 24.
	extended := func(w, h int) []byte {
		body := []byte{0, 0, 0, 0, byte(w - 1), byte((w - 1) >> 8), byte((w - 1) >> 16), byte(h - 1), byte((h - 1) >> 8), byte((h - 1) >> 16)}
		return webpHeader("VP8X", body)
	}
	// VP8L has the signature 0x2f at offset 20, then 14 bits each of width-1 and height-1.
	lossless := func(w, h int) []byte {
		bits := uint32(w-1) | uint32(h-1)<<14
		return webpHeader("VP8L", []byte{0x2f, byte(bits), byte(bits >> 8), byte(bits >> 16), byte(bits >> 24), 0, 0, 0, 0, 0})
	}
	for name, c := range map[string]struct {
		data []byte
		ok   bool
	}{
		"extended 1024":    {extended(1024, 1024), true},
		"extended 1025":    {extended(1025, 64), false},
		"lossless 256":     {lossless(256, 256), true},
		"lossless 1025":    {lossless(64, 1025), false},
		"unknown chunk":    {webpHeader("VP8Z", make([]byte, 16)), false},
		"header too short": {[]byte("RIFF\x04\x00\x00\x00WEBP"), false},
	} {
		_, err := checkAvatar(c.data)
		if (err == nil) != c.ok {
			t.Errorf("%s: err = %v, want ok = %v", name, err, c.ok)
		}
	}
}
