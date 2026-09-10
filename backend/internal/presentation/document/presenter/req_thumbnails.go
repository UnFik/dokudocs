package presenter

type ThumbnailsRequest struct {
	Thumbnail            string `json:"thumbnail"`
	ThumbnailDark        string `json:"thumbnailDark"`
	ThumbnailPreview     string `json:"thumbnailPreview"`
	ThumbnailPreviewDark string `json:"thumbnailPreviewDark"`
}
