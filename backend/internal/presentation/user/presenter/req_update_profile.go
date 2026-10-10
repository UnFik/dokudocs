package presenter

type UpdateProfileRequest struct {
	FullName    string `json:"fullName"`
	PhoneNumber string `json:"phoneNumber"`
	Bio         string `json:"bio"`
}
