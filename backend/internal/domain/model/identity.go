package model

// ProviderIdentity is who a sign-in provider says the person is.
type ProviderIdentity struct {
	// Subject is the provider's stable id for the person; the email can change.
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	AvatarURL     string
}
