package presenter

import "time"

type LinkedIdentity struct {
	Provider string    `json:"provider"`
	Email    string    `json:"email"`
	LinkedAt time.Time `json:"linkedAt"`
}

type SignInMethods struct {
	HasPassword bool             `json:"hasPassword"`
	Identities  []LinkedIdentity `json:"identities"`
}

type PasswordLinkRequest struct {
	Token string `json:"token" validate:"required"`
}

type SetPasswordRequest struct {
	Token    string `json:"token" validate:"required"`
	Password string `json:"password" validate:"required"`
}
