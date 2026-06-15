package request

func ValidationTitle(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
