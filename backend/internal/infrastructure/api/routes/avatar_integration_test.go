//go:build integration

package routes

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"backend/internal/config"
)

var avatarURLPattern = regexp.MustCompile(`^/api/v1/avatars/([0-9a-f]{32})$`)

func samplePNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for x := 0; x < width; x++ {
		for y := 0; y < height; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 120, A: 255})
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// riffWebP builds the header of a lossy WebP of the given size; the avatar rules
// only read the header, so the picture data can be filler.
func riffWebP(width, height int) []byte {
	chunk := make([]byte, 10+8)
	copy(chunk, "VP8 ")
	chunk[4] = 10
	copy(chunk[11:14], []byte{0x9d, 0x01, 0x2a}) // after the 3-byte frame tag
	chunk[14] = byte(width)
	chunk[15] = byte(width >> 8)
	chunk[16] = byte(height)
	chunk[17] = byte(height >> 8)
	body := append([]byte("WEBP"), chunk...)
	out := append([]byte("RIFF"), byte(len(body)), 0, 0, 0)
	return append(out, body...)
}

type avatarEnv struct {
	*signInEnv
	dir string
}

func newAvatarEnv(t *testing.T) *avatarEnv {
	dir := t.TempDir()
	env := newSignInEnv(t, func(c *config.Config) {
		c.AssetDir = dir
		c.MaxUploadBytes = 25 << 20
	})
	return &avatarEnv{signInEnv: env, dir: dir}
}

func (e *avatarEnv) upload(token string, body []byte) reply {
	e.t.Helper()
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	part, _ := writer.CreateFormFile("file", "me.png")
	_, _ = part.Write(body)
	_ = writer.Close()
	return e.send(http.MethodPut, "/api/v1/users/me/avatar", &form, writer.FormDataContentType(), token)
}

func (e *avatarEnv) send(method, path string, body *bytes.Buffer, contentType, token string) reply {
	e.t.Helper()
	if body == nil {
		body = &bytes.Buffer{}
	}
	req := httptest.NewRequest(method, path, body)
	req.RemoteAddr = "203.0.113.7:5000"
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.api.ServeHTTP(rec, req)
	return reply{rec}
}

type profileBody struct {
	Data struct {
		AvatarURL string `json:"avatarUrl"`
		FullName  string `json:"fullName"`
	} `json:"data"`
}

func (e *avatarEnv) avatarURL(token string) string {
	e.t.Helper()
	var out profileBody
	res := e.do(http.MethodGet, "/api/v1/users/me/profile", nil, bearer(token), "")
	res.json(&out)
	return out.Data.AvatarURL
}

func (e *avatarEnv) files() int {
	n := 0
	_ = filepath.Walk(filepath.Join(e.dir, "avatars"), func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			n++
		}
		return nil
	})
	return n
}

func TestAUserUploadsAnAvatarAndAnyoneCanFetchIt(t *testing.T) {
	env := newAvatarEnv(t)
	_, _, token := env.localUser("avatar")

	res := env.upload(token, samplePNG(t, 256, 256))
	var out profileBody
	res.json(&out)
	if res.Code != http.StatusOK || !avatarURLPattern.MatchString(out.Data.AvatarURL) {
		t.Fatalf("upload = %d %s, want 200 with an /api/v1/avatars/<key> url", res.Code, res.Body.String())
	}
	if got := env.avatarURL(token); got != out.Data.AvatarURL {
		t.Fatalf("profile avatarUrl = %q, want %q", got, out.Data.AvatarURL)
	}

	// An <img> cannot send a bearer token, so the picture is public by its key.
	got := env.send(http.MethodGet, out.Data.AvatarURL, nil, "", "")
	if got.Code != http.StatusOK || got.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("fetch = %d %s, want 200 image/png", got.Code, got.Header().Get("Content-Type"))
	}
	if cc := got.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") || !strings.Contains(cc, "public") {
		t.Fatalf("Cache-Control = %q, want public and immutable", cc)
	}
	if got.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("an avatar must be served with nosniff")
	}
	if !bytes.Equal(got.Body.Bytes(), samplePNG(t, 256, 256)) {
		t.Fatal("the stored picture must be the one that was uploaded")
	}
}

func TestReplacingAnAvatarRemovesTheOldFile(t *testing.T) {
	env := newAvatarEnv(t)
	_, _, token := env.localUser("replace")
	var first, second profileBody
	env.upload(token, samplePNG(t, 64, 64)).json(&first)
	env.upload(token, samplePNG(t, 65, 65)).json(&second)
	if first.Data.AvatarURL == "" || first.Data.AvatarURL == second.Data.AvatarURL {
		t.Fatalf("a new upload must get a new key, got %q then %q", first.Data.AvatarURL, second.Data.AvatarURL)
	}
	if res := env.send(http.MethodGet, first.Data.AvatarURL, nil, "", ""); res.Code != http.StatusNotFound {
		t.Fatalf("the old avatar = %d, want 404", res.Code)
	}
	if env.files() != 1 {
		t.Fatalf("files on disk = %d, want 1", env.files())
	}
}

func TestBadAvatarUploadsAreRefused(t *testing.T) {
	env := newAvatarEnv(t)
	_, _, token := env.localUser("badavatar")
	gif := append([]byte("GIF89a"), make([]byte, 64)...)
	cases := map[string][]byte{
		"text named .png":      []byte("this is not a picture"),
		"gif":                  gif,
		"empty":                {},
		"over 1024 pixels":     samplePNG(t, 1025, 16),
		"webp over 1024":       riffWebP(1025, 16),
		"png header truncated": samplePNG(t, 64, 64)[:20],
	}
	for name, body := range cases {
		if res := env.upload(token, body); res.Code != http.StatusBadRequest {
			t.Errorf("%s = %d %s, want 400", name, res.Code, res.Body.String())
		}
	}
	tooBig := append(samplePNG(t, 64, 64), make([]byte, 600<<10)...)
	if res := env.upload(token, tooBig); res.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("over 512 KB = %d, want 413", res.Code)
	}
	if res := env.send(http.MethodPut, "/api/v1/users/me/avatar", bytes.NewBufferString("{}"), "application/json", token); res.Code != http.StatusBadRequest {
		t.Errorf("not multipart = %d, want 400", res.Code)
	}
	if env.files() != 0 || env.avatarURL(token) != "" {
		t.Fatal("a refused upload must leave nothing behind")
	}
}

func TestAWebPAvatarWithinTheLimitsIsAccepted(t *testing.T) {
	env := newAvatarEnv(t)
	_, _, token := env.localUser("webp")
	res := env.upload(token, riffWebP(256, 256))
	var out profileBody
	res.json(&out)
	if res.Code != http.StatusOK {
		t.Fatalf("webp = %d %s, want 200", res.Code, res.Body.String())
	}
	if got := env.send(http.MethodGet, out.Data.AvatarURL, nil, "", ""); got.Header().Get("Content-Type") != "image/webp" {
		t.Fatalf("webp served as %q", got.Header().Get("Content-Type"))
	}
}

func TestRemovingAnAvatarDeletesItsFile(t *testing.T) {
	env := newAvatarEnv(t)
	_, _, token := env.localUser("remove")
	var out profileBody
	env.upload(token, samplePNG(t, 64, 64)).json(&out)
	if res := env.send(http.MethodDelete, "/api/v1/users/me/avatar", nil, "", token); res.Code != http.StatusNoContent {
		t.Fatalf("delete = %d, want 204", res.Code)
	}
	if env.avatarURL(token) != "" || env.files() != 0 {
		t.Fatal("deleting must clear the url and remove the file")
	}
	if res := env.send(http.MethodGet, out.Data.AvatarURL, nil, "", ""); res.Code != http.StatusNotFound {
		t.Fatalf("the removed avatar = %d, want 404", res.Code)
	}
	if res := env.send(http.MethodDelete, "/api/v1/users/me/avatar", nil, "", token); res.Code != http.StatusNoContent {
		t.Fatalf("delete with no avatar = %d, want 204", res.Code)
	}
}

func TestAnAvatarFromAnOutsideUrlIsReplacedAndRemovedWithoutTouchingDisk(t *testing.T) {
	env := newAvatarEnv(t)
	id, _, token := env.localUser("outside")
	if _, err := env.db.Exec(`UPDATE users SET avatar_url = 'https://lh3.example.test/a.png' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if res := env.send(http.MethodDelete, "/api/v1/users/me/avatar", nil, "", token); res.Code != http.StatusNoContent || env.avatarURL(token) != "" {
		t.Fatalf("removing an outside avatar = %d, url %q", res.Code, env.avatarURL(token))
	}
	if _, err := env.db.Exec(`UPDATE users SET avatar_url = 'https://lh3.example.test/a.png' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if res := env.upload(token, samplePNG(t, 64, 64)); res.Code != http.StatusOK || !avatarURLPattern.MatchString(env.avatarURL(token)) {
		t.Fatalf("replacing an outside avatar = %d %s", res.Code, res.Body.String())
	}
}

func TestSavingTheProfileLeavesTheAvatarAlone(t *testing.T) {
	env := newAvatarEnv(t)
	_, _, token := env.localUser("keep")
	var out profileBody
	env.upload(token, samplePNG(t, 64, 64)).json(&out)

	res := env.do(http.MethodPut, "/api/v1/users/me/profile", map[string]string{"fullName": "New Name", "phoneNumber": "123", "bio": "hi"}, bearer(token), "")
	var saved profileBody
	res.json(&saved)
	if res.Code != http.StatusOK || saved.Data.FullName != "New Name" || saved.Data.AvatarURL != out.Data.AvatarURL {
		t.Fatalf("save = %d %s, want the avatar kept", res.Code, res.Body.String())
	}
	// The picture is changed only through the avatar endpoints.
	res = env.do(http.MethodPut, "/api/v1/users/me/profile", map[string]string{"fullName": "New Name", "avatarUrl": "https://tracker.example.test/pixel.png"}, bearer(token), "")
	if res.Code != http.StatusBadRequest || env.avatarURL(token) != out.Data.AvatarURL {
		t.Fatalf("a profile save carrying avatarUrl = %d, want 400 and the avatar untouched", res.Code)
	}
}

func TestAvatarKeysThatAreNotKeysAreNotFound(t *testing.T) {
	env := newAvatarEnv(t)
	for _, path := range []string{"/api/v1/avatars/" + strings.Repeat("0", 32), "/api/v1/avatars/..%2Fsecret", "/api/v1/avatars/short", "/api/v1/avatars/" + strings.Repeat("G", 32)} {
		if res := env.send(http.MethodGet, path, nil, "", ""); res.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, res.Code)
		}
	}
}

func TestAvatarEndpointsNeedASignedInUser(t *testing.T) {
	env := newAvatarEnv(t)
	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		if res := env.send(method, "/api/v1/users/me/avatar", nil, "", ""); res.Code != http.StatusUnauthorized {
			t.Errorf("%s without a token = %d, want 401", method, res.Code)
		}
	}
}
