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

type SetPasswordRequest struct {
	Password string `json:"password" validate:"required"`
}
