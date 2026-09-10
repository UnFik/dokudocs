package dto

type LoginRequest struct {
	Email    string
	Password string
}

type LoginResponse struct {
	AccessToken string
	User        ResponseUser
}

type ResponseUser struct {
	ID        string
	AccountNo string
	Email     string
	Role      []string
	Exp       int64
}

type RegisterRequest struct {
	Email    string
	Password string
	FullName string
}
