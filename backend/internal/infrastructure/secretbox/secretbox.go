// Package secretbox seals small secrets, such as a provider API key, with AES-GCM.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
)

type Box struct{ aead cipher.AEAD }

// New builds a Box from a base64-encoded 32-byte key.
func New(base64Key string) (*Box, error) {
	key, err := base64.StdEncoding.DecodeString(base64Key)
	if err != nil || len(key) != 32 {
		return nil, errors.New("the encryption key must be 32 bytes, base64-encoded")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Seal returns the nonce followed by the ciphertext.
func (b *Box) Seal(plain string) ([]byte, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return b.aead.Seal(nonce, nonce, []byte(plain), nil), nil
}

func (b *Box) Open(sealed []byte) (string, error) {
	size := b.aead.NonceSize()
	if len(sealed) < size+b.aead.Overhead() {
		return "", errors.New("the sealed value is too short")
	}
	plain, err := b.aead.Open(nil, sealed[:size], sealed[size:], nil)
	if err != nil {
		return "", errors.New("the sealed value could not be opened")
	}
	return string(plain), nil
}
