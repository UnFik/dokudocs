package utils

import "golang.org/x/crypto/bcrypt"

func ComparePasswordHash(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
