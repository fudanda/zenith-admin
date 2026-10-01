package zenith

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/managedfile"
)

func (f *Framework) uploadFiles(w http.ResponseWriter, r *http.Request) {
	settings, _, err := f.loadFileSettings(r.Context())
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取上传策略失败")
		return
	}
	maxBytes := maxSingleUploadBytes
	if settings.UploadMaxSizeMb > 0 && int64(settings.UploadMaxSizeMb)*mib < maxBytes {
		maxBytes = int64(settings.UploadMaxSizeMb) * mib
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+2*mib)
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "invalid_multipart", "上传内容无效")
		return
	}
	visibility := r.URL.Query().Get("visibility")
	if visibility == "" {
		visibility = "public"
	}
	if visibility != "public" && visibility != "restricted" {
		fail(w, 400, "invalid_visibility", "文件可见性无效")
		return
	}
	result := []any{}
	succeeded := false
	defer func() {
		if succeeded || len(result) == 0 {
			return
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		for _, value := range result {
			id, err := uuid.Parse(fmt.Sprint(value.(map[string]any)["id"]))
			if err != nil {
				continue
			}
			row, err := f.Store.Client.ManagedFile.UpdateOneID(id).SetDeletePending(true).Save(cleanup)
			if err == nil {
				err = f.removePendingFile(cleanup, row)
			}
			if err != nil {
				log.Printf("failed upload cleanup %s: %v", id, err)
			}
		}
	}()
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			fail(w, 400, "invalid_multipart", "上传内容无效")
			return
		}
		if part.FormName() != "file" || part.FileName() == "" {
			part.Close()
			continue
		}
		if len(result) >= 20 {
			part.Close()
			fail(w, 400, "too_many_files", "单次最多上传 20 个文件")
			return
		}
		view, err := f.persistFile(r.Context(), fromContext(r.Context()), part, part.FileName(), visibility, requestID(r), maxBytes)
		part.Close()
		if err != nil {
			fail(w, 400, "upload_failed", err.Error())
			return
		}
		result = append(result, view)
	}
	if len(result) == 0 {
		fail(w, 400, "missing_file", "请选择文件")
		return
	}
	succeeded = true
	respond(w, 200, result)
}

// Browse only managed objects, never unrelated disk contents or absolute paths.
func (f *Framework) browseFiles(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(r.URL.Query().Get("storageConfigId"))
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	if _, err = f.Store.Client.FileStorageConfig.Get(r.Context(), id); err != nil {
		if ent.IsNotFound(err) {
			fail(w, 404, "not_found", "存储配置不存在")
		} else {
			fail(w, 503, "database_unavailable", "存储查询失败")
		}
		return
	}
	current := strings.Trim(r.URL.Query().Get("path"), "/")
	if strings.Contains(current, "\\") || current != "" && path.Clean(current) != current || current == ".." || strings.HasPrefix(current, "../") {
		fail(w, 400, "invalid_path", "目录路径无效")
		return
	}
	prefix := ""
	if current != "" {
		prefix = current + "/"
	}
	rows, err := f.Store.Client.ManagedFile.Query().Where(managedfile.StorageConfigIDEQ(id), managedfile.DeletePending(false), managedfile.ObjectKeyHasPrefix(prefix)).Order(ent.Desc(managedfile.FieldCreatedAt)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "文件查询失败")
		return
	}
	dirs := map[string]bool{}
	files := []any{}
	for _, row := range rows {
		relative := strings.TrimPrefix(row.ObjectKey, prefix)
		if index := strings.Index(relative, "/"); index >= 0 {
			dirs[relative[:index]] = true
			continue
		}
		view, err := f.fileView(r.Context(), row)
		if err != nil {
			fail(w, 503, "database_unavailable", "文件查询失败")
			return
		}
		files = append(files, view)
	}
	names := []string{}
	for name := range dirs {
		names = append(names, name)
	}
	sort.Strings(names)
	folders := []map[string]string{}
	for _, name := range names {
		folders = append(folders, map[string]string{"name": name, "path": prefix + name})
	}
	respond(w, 200, map[string]any{"folders": folders, "files": files, "currentPath": current, "basePath": ""})
}
