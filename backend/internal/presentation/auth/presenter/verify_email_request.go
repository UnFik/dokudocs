package presenter

type VerifyEmailRequest struct {
	Token string `json:"token" validate:"required"`
}
