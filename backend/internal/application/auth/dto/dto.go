package dto

type LoginRequest struct {
	Email    string
	Password string
}

type LoginResponse struct {
	AccessToken string       `json:"accessToken"`
	User        ResponseUser `json:"user"`
}

type ResponseUser struct {
	AccountNo string   `json:"accountNo"`
	Email     string   `json:"email"`
	Role      []string `json:"role"`
	Exp       int64    `json:"exp"`
}
