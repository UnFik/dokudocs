package handler

import (
	"errors"
	"io"
	"net/http"

	"backend/constant"
	"backend/internal/application/user/usecase"
	_ "backend/internal/domain/model"
	"backend/internal/presentation/middleware"
	"backend/internal/presentation/response"

	"github.com/google/uuid"
)

// multipartOverhead is room for the form fields around the file.
const multipartOverhead = 64 << 10

// UploadAvatar replaces the picture of the current user.
// @Summary Upload an avatar
// @Tags User
// @Accept mpfd
// @Produce json
// @Security BearerAuth
// @Param file formData file true "PNG, JPEG or WebP, up to 512 KB and 1024 by 1024 pixels"
// @Success 200 {object} response.Envelope{data=model.UserProfile}
// @Failure 400 {object} response.ErrorEnvelope
// @Failure 401 {object} response.ErrorEnvelope
// @Failure 413 {object} response.ErrorEnvelope
// @Router /users/me/avatar [put]
func (h *Handler) UploadAvatar(w http.ResponseWriter, r *http.Request) {
	u, ok := middleware.UserFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	userID, err := uuid.Parse(u.ID)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, "invalid user id")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, usecase.MaxAvatarBytes+multipartOverhead)
	file, _, err := r.FormFile("file")
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			response.Error(w, http.StatusRequestEntityTooLarge, constant.ErrAvatarTooLarge.Error())
			return
		}
		response.Error(w, http.StatusBadRequest, "send the picture as multipart form field \"file\"")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, usecase.MaxAvatarBytes+1))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "could not read the picture")
		return
	}
	profile, err := h.service.SetAvatar(r.Context(), userID, data)
	switch {
	case err == nil:
		_ = response.Data(w, http.StatusOK, profile)
	case errors.Is(err, constant.ErrAvatarTooLarge):
		response.Error(w, http.StatusRequestEntityTooLarge, err.Error())
	case errors.Is(err, constant.ErrInvalidAvatar):
		response.Error(w, http.StatusBadRequest, err.Error())
	default:
		response.Error(w, http.StatusInternalServerError, "failed to save the avatar")
	}
}

// RemoveAvatar clears the picture of the current user.
// @Summary Remove the avatar
// @Tags User
// @Security BearerAuth
// @Success 204
// @Failure 401 {object} response.ErrorEnvelope
// @Router /users/me/avatar [delete]
func (h *Handler) RemoveAvatar(w http.ResponseWriter, r *http.Request) {
	u, ok := middleware.UserFromContext(r.Context())
	if !ok {
		response.Error(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	userID, err := uuid.Parse(u.ID)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, "invalid user id")
		return
	}
	if err := h.service.RemoveAvatar(r.Context(), userID); err != nil {
		response.Error(w, http.StatusInternalServerError, "failed to remove the avatar")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetAvatar serves a stored picture. It is public: an <img> cannot send a bearer
// token, and the key cannot be guessed.
// @Summary Fetch an avatar
// @Tags User
// @Produce image/png,image/jpeg,image/webp
// @Param key path string true "Avatar key"
// @Success 200 {file} binary
// @Failure 404 {object} response.ErrorEnvelope
// @Router /avatars/{key} [get]
func (h *Handler) GetAvatar(w http.ResponseWriter, r *http.Request) {
	data, contentType, err := h.service.OpenAvatar(r.Context(), r.PathValue("key"))
	switch {
	case err == nil:
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(data)
	case errors.Is(err, constant.ErrAvatarNotFound):
		response.Error(w, http.StatusNotFound, err.Error())
	default:
		response.Error(w, http.StatusInternalServerError, "failed to read the avatar")
	}
}
