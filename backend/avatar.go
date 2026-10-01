package zenith

import (
	"bytes"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
)

func (f *Framework) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 3<<20)
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		fail(w, 400, "invalid_upload", "头像不得超过 2 MB")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		fail(w, 400, "invalid_upload", "请选择头像")
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, (2<<20)+1))
	if err != nil || len(raw) > 2<<20 {
		fail(w, 400, "invalid_upload", "头像不得超过 2 MB")
		return
	}
	dimensions, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png") || dimensions.Width > 4096 || dimensions.Height > 4096 {
		fail(w, 400, "invalid_avatar", "头像需要有效 JPEG 或 PNG 图片，尺寸不超过 4096")
		return
	}
	if _, _, err := image.Decode(bytes.NewReader(raw)); err != nil {
		fail(w, 400, "invalid_avatar", "头像图片不完整或已损坏")
		return
	}
	name := "avatar.jpg"
	if format == "png" {
		name = "avatar.png"
	}
	view, err := f.persistFile(r.Context(), fromContext(r.Context()), bytes.NewReader(raw), name, "public", requestID(r), 2<<20)
	if err != nil {
		fail(w, 400, "upload_failed", err.Error())
		return
	}
	respond(w, 200, view)
}
