package usecase

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"regexp"
	"strings"

	"backend/constant"
	"backend/internal/domain/model"

	"github.com/google/uuid"
)

const (
	// MaxAvatarBytes is the most a picture may weigh; the browser shrinks it first.
	MaxAvatarBytes = 512 << 10
	maxAvatarSide  = 1024

	avatarURLPrefix = "/api/v1/avatars/"
	avatarKeyPrefix = "avatars/"
)

var avatarKeyPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// AvatarContentType names the picture type from its first bytes, or "" for a
// type that is not allowed. The file name and the client's type are never used.
func AvatarContentType(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(data, []byte("\xff\xd8\xff")):
		return "image/jpeg"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp"
	}
	return ""
}

// webpSize reads the picture size from the header: lossy (VP8), lossless (VP8L)
// or extended (VP8X).
func webpSize(data []byte) (width, height int, ok bool) {
	if len(data) < 30 {
		return 0, 0, false
	}
	switch string(data[12:16]) {
	case "VP8 ":
		if data[23] != 0x9d || data[24] != 0x01 || data[25] != 0x2a {
			return 0, 0, false
		}
		return int(binary.LittleEndian.Uint16(data[26:28]) & 0x3fff), int(binary.LittleEndian.Uint16(data[28:30]) & 0x3fff), true
	case "VP8L":
		if data[20] != 0x2f {
			return 0, 0, false
		}
		bits := binary.LittleEndian.Uint32(data[21:25])
		return int(bits&0x3fff) + 1, int((bits>>14)&0x3fff) + 1, true
	case "VP8X":
		return int(uint32(data[24])|uint32(data[25])<<8|uint32(data[26])<<16) + 1,
			int(uint32(data[27])|uint32(data[28])<<8|uint32(data[29])<<16) + 1, true
	}
	return 0, 0, false
}

func checkAvatar(data []byte) (string, error) {
	if len(data) > MaxAvatarBytes {
		return "", constant.ErrAvatarTooLarge
	}
	contentType := AvatarContentType(data)
	if contentType == "" {
		return "", constant.ErrInvalidAvatar
	}
	var width, height int
	if contentType == "image/webp" {
		w, h, ok := webpSize(data)
		if !ok {
			return "", constant.ErrInvalidAvatar
		}
		width, height = w, h
	} else {
		config, _, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return "", constant.ErrInvalidAvatar
		}
		width, height = config.Width, config.Height
	}
	if width < 1 || height < 1 || width > maxAvatarSide || height > maxAvatarSide {
		return "", constant.ErrInvalidAvatar
	}
	return contentType, nil
}

func (u *useCase) SetAvatar(ctx context.Context, userID uuid.UUID, data []byte) (model.UserProfile, error) {
	if u.avatars == nil || u.store == nil {
		return model.UserProfile{}, errors.New("avatar storage is not configured")
	}
	if _, err := checkAvatar(data); err != nil {
		return model.UserProfile{}, err
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return model.UserProfile{}, err
	}
	key := hex.EncodeToString(raw)
	if err := u.store.Put(ctx, avatarKeyPrefix+key, bytes.NewReader(data)); err != nil {
		return model.UserProfile{}, err
	}
	previous, err := u.avatars.SetAvatar(ctx, userID, avatarURLPrefix+key)
	if err != nil {
		_ = u.store.Delete(ctx, avatarKeyPrefix+key)
		return model.UserProfile{}, err
	}
	u.dropAvatarFile(ctx, previous)
	return u.repo.FindByID(ctx, userID)
}

func (u *useCase) RemoveAvatar(ctx context.Context, userID uuid.UUID) error {
	if u.avatars == nil || u.store == nil {
		return errors.New("avatar storage is not configured")
	}
	previous, err := u.avatars.SetAvatar(ctx, userID, "")
	if err != nil {
		return err
	}
	u.dropAvatarFile(ctx, previous)
	return nil
}

// dropAvatarFile removes the file behind one of our own avatar urls, and leaves
// an address outside the app (a Google picture) alone. A failure is not the
// caller's: the file is only unreferenced then.
func (u *useCase) dropAvatarFile(ctx context.Context, url string) {
	key, ok := strings.CutPrefix(url, avatarURLPrefix)
	if !ok || !avatarKeyPattern.MatchString(key) {
		return
	}
	_ = u.store.Delete(ctx, avatarKeyPrefix+key)
}

func (u *useCase) OpenAvatar(ctx context.Context, key string) ([]byte, string, error) {
	if u.store == nil || !avatarKeyPattern.MatchString(key) {
		return nil, "", constant.ErrAvatarNotFound
	}
	file, err := u.store.Open(ctx, avatarKeyPrefix+key)
	if errors.Is(err, os.ErrNotExist) {
		return nil, "", constant.ErrAvatarNotFound
	}
	if err != nil {
		return nil, "", err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, MaxAvatarBytes+1))
	if err != nil {
		return nil, "", err
	}
	contentType := AvatarContentType(data)
	if contentType == "" {
		return nil, "", constant.ErrAvatarNotFound
	}
	return data, contentType, nil
}
