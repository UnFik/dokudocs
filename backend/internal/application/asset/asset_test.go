package asset

import "testing"

func TestDetectTypeReadsTheBytes(t *testing.T) {
	cases := map[string]struct {
		data []byte
		want string
	}{
		"png":  {[]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), "image/png"},
		"jpeg": {[]byte("\xff\xd8\xff\xe0\x00\x10JFIF"), "image/jpeg"},
		"gif":  {[]byte("GIF89a\x01\x00\x01\x00"), "image/gif"},
		"pdf":  {[]byte("%PDF-1.7\n"), "application/pdf"},
		"mp4":  {[]byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00"), "video/mp4"},
		"html": {[]byte("<html><script>alert(1)</script>"), "application/octet-stream"},
		"svg":  {[]byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`), "application/octet-stream"},
		"text": {[]byte("plain words"), "application/octet-stream"},
	}
	for name, c := range cases {
		if got := detectType(c.data); got != c.want {
			t.Errorf("%s: detectType() = %q, want %q", name, got, c.want)
		}
	}
}

func TestCleanNameKeepsOnlyTheFileName(t *testing.T) {
	cases := map[string]string{
		"../../etc/passwd":   "passwd",
		`C:\docs\plan.pdf`:   "plan.pdf",
		"quote\".png":        "quote.png",
		"":                   "file",
		"..":                 "..",
		"normal name (1).md": "normal name (1).md",
	}
	for in, want := range cases {
		if got := cleanName(in); got != want && !(in == ".." && got == "..") {
			t.Errorf("cleanName(%q) = %q, want %q", in, got, want)
		}
	}
}
