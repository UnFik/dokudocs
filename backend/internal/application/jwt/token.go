package jwt

import (
	"time"

	"backend/constant"
	"backend/internal/application/auth/dto"
	"backend/internal/domain/model"

	jwtlib "github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	AccountNo string   `json:"accountNo"`
	Email     string   `json:"email"`
	Role      []string `json:"role"`
	jwtlib.RegisteredClaims
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
	expiresAt := m.now().Add(m.ttl)
	responseUser := dto.ResponseUser{
		AccountNo: user.AccountNo,
		Email:     user.Email,
		Role:      user.Roles,
		Exp:       expiresAt.Unix(),
	}
	claims := Claims{
		AccountNo: user.AccountNo,
		Email:     user.Email,
		Role:      user.Roles,
		RegisteredClaims: jwtlib.RegisteredClaims{
			Subject:   user.ID.String(),
			ExpiresAt: jwtlib.NewNumericDate(expiresAt),
			IssuedAt:  jwtlib.NewNumericDate(m.now()),
		},
	}
	token := jwtlib.NewWithClaims(jwtlib.SigningMethodHS256, claims)
	accessToken, err := token.SignedString(m.secret)
	if err != nil {
		return dto.LoginResponse{}, err
	}
	return dto.LoginResponse{AccessToken: accessToken, User: responseUser}, nil
}

func (m *Manager) Verify(tokenString string) (dto.ResponseUser, error) {
	claims := &Claims{}
	parser := jwtlib.NewParser(jwtlib.WithTimeFunc(m.now))
	token, err := parser.ParseWithClaims(tokenString, claims, func(token *jwtlib.Token) (any, error) {
		if token.Method != jwtlib.SigningMethodHS256 {
			return nil, constant.ErrInvalidToken
		}
		return m.secret, nil
	})
	if err != nil || !token.Valid {
		return dto.ResponseUser{}, constant.ErrInvalidToken
	}
	return dto.ResponseUser{
		AccountNo: claims.AccountNo,
		Email:     claims.Email,
		Role:      claims.Role,
		Exp:       claims.ExpiresAt.Unix(),
	}, nil
}
