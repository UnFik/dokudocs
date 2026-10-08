# Uploaded files live in an asset store, and unreferenced ones are swept

Images, videos, PDFs and other files a person adds to a page are stored outside the document. The document holds only a reference, `/api/v1/documents/{id}/assets/{assetID}`, in an `image`, `video` or `file` node. Putting bytes into the Yjs state or `content_json` would make every edit, revision and sync carry them.

**Where the bytes go.** The API talks to an `AssetStore` port (`Put`, `Open`, `Delete` by key). The first adapter writes to a directory (`ASSET_DIR`, a volume in Docker). An S3-compatible adapter fits the same port and is not built yet; the key is `workspaceID/documentID/assetID`, which works as an object key too. Metadata (name, type, size, SHA-256, uploader, time) is in `document_assets`, so listing and access checks never touch the store.

**Who may read and write.** Uploading needs edit access to the document. Reading needs read access to it, the same policy as the page itself; a page shared by public link serves its assets under `/public/documents/{token}/assets/{assetID}`. A browser `<img>` cannot send the access token, so the editor fetches an asset with the token and shows it from a blob URL.

**What is accepted.** At most 25 MiB. The type is detected from the bytes, not taken from the request. Images (PNG, JPEG, GIF, WebP), video (MP4, WebM) and PDF are shown inline. Anything else is a downloadable file served as `application/octet-stream` with `Content-Disposition: attachment`. SVG is not accepted as an image because it can carry script. Every response carries `X-Content-Type-Options: nosniff`.

**Orphans (#94).** An upload is made before its node is in the page, and a rejected suggestion or a deleted block leaves the file behind. An asset counts as referenced while its ID appears in the document's `content_json` or in any of its revisions. A sweep removes the rows and files of assets older than a day that are not referenced. It runs on a timer in the API process and can be run by hand. An accepted suggestion therefore needs no re-upload: the file is kept while the suggestion that holds it is in the page.

**Not decided here.** Suggest mode still cannot insert uploaded media (#94 keeps that open); the rule above only means it will not leak files when it does.
