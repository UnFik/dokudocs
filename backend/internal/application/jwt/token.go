package jwt

import (
	"net/mail"
	"strings"
	"time"

	"backend/constant"
	"backend/internal/application/auth/dto"
	"backend/internal/domain/model"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	AccountNo string   `json:"accountNo"`
	Email     string   `json:"email"`
	Role      []string `json:"role"`
	jwt.RegisteredClaims
}

type Manager struct {
	secret []byte
	ttl    time.Duration
	now    func() time.Time
}

func NewManager(secret string, ttl time.Duration) *Manager {
	return &Manager{secret: []byte(secret), ttl: ttl, now: time.Now}
}

func (m *Manager) SetNow(now func() time.Time) {
	m.now = now
}

func (m *Manager) Issue(user model.AuthUser) (dto.LoginResponse, error) {
	now := m.now()
	expiresAt := now.Add(m.ttl)
	responseUser := dto.ResponseUser{
		ID:        user.ID.String(),
		AccountNo: user.AccountNo,
		Email:     user.Email,
		Role:      user.Roles,
		Exp:       expiresAt.Unix(),
	}
	claims := Claims{
		AccountNo: user.AccountNo,
		Email:     user.Email,
		Role:      user.Roles,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID.String(),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	accessToken, err := token.SignedString(m.secret)
	if err != nil {
		return dto.LoginResponse{}, err
	}
	return dto.LoginResponse{AccessToken: accessToken, User: responseUser}, nil
}

func (m *Manager) Verify(tokenString string) (dto.ResponseUser, error) {
	claims := &Claims{}
	parser := jwt.NewParser(jwt.WithTimeFunc(m.now), jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	token, err := parser.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, constant.ErrInvalidToken
		}
		return m.secret, nil
	})
	if err != nil || !token.Valid || !validClaims(claims, m.now()) {
		return dto.ResponseUser{}, constant.ErrInvalidToken
	}
	return dto.ResponseUser{
		ID:        claims.Subject,
		AccountNo: claims.AccountNo,
		Email:     claims.Email,
		Role:      claims.Role,
		Exp:       claims.ExpiresAt.Unix(),
	}, nil
}

func validClaims(claims *Claims, now time.Time) bool {
	if claims.ExpiresAt == nil || claims.IssuedAt == nil || claims.Subject == "" || claims.AccountNo == "" ||
		!validEmail(claims.Email) || len(claims.Role) == 0 || claims.ExpiresAt.Time.Before(claims.IssuedAt.Time) ||
		claims.IssuedAt.Time.After(now) {
		return false
	}
	if _, err := uuid.Parse(claims.Subject); err != nil {
		return false
	}
	for _, role := range claims.Role {
		if strings.TrimSpace(role) == "" {
			return false
		}
	}
	return true
}

func validEmail(email string) bool {
	parsed, err := mail.ParseAddress(email)
	return len([]byte(email)) <= 255 && err == nil && parsed.Address == email
}
