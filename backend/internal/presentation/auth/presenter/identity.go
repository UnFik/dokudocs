package presenter

type StartIdentityRequest struct {
	Redirect string `json:"redirect"`
}

type StartIdentityResponse struct {
	AuthorizationURL string `json:"authorizationUrl"`
}

type ExchangeIdentityRequest struct {
	Code string `json:"code" validate:"required"`
}

type ExchangeIdentityResponse struct {
	AccessToken string       `json:"accessToken"`
	User        ResponseUser `json:"user"`
	Redirect    string       `json:"redirect"`
}
