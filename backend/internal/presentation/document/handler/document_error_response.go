package handler

import (
	"errors"
	"net/http"

	"backend/constant"
	appdoc "backend/internal/application/document/usecase"
	"backend/internal/presentation/response"
)

func writeDocumentError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, constant.ErrUnauthorized):
		response.Error(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, constant.ErrForbidden):
		response.Error(w, http.StatusForbidden, err.Error())
	case errors.Is(err, constant.ErrUserNotFound),
		errors.Is(err, constant.ErrWorkspaceNotFound),
		errors.Is(err, constant.ErrProjectNotFound),
		errors.Is(err, constant.ErrCategoryNotFound),
		errors.Is(err, constant.ErrDocumentNotFound),
		errors.Is(err, constant.ErrAccessNotFound):
		response.Error(w, http.StatusNotFound, err.Error())
	case errors.Is(err, constant.ErrDocumentConflict):
		response.Error(w, http.StatusConflict, err.Error())
	case errors.Is(err, appdoc.ErrInvalidContentJSON):
		response.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, constant.ErrInvalidIdempotencyKey):
		response.Error(w, http.StatusBadRequest, err.Error())
	default:
		response.Error(w, http.StatusInternalServerError, "internal server error")
	}
}
