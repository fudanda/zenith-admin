package zenith

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/filestorageconfig"
	"github.com/fudanda/zenith-admin/backend/ent/managedfile"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

const maxSingleUploadBytes int64 = 100 * 1024 * 1024

func fileScope(_ *principal) predicate.ManagedFile {
	return managedfile.Not(managedfile.IDEQ(uuid.Nil))
}

func (f *Framework) defaultStorage(ctx context.Context) (*ent.FileStorageConfig, error) {
	return f.Store.Client.FileStorageConfig.Query().Where(filestorageconfig.IsDefault(true), filestorageconfig.StatusEQ("enabled")).Only(ctx)
}

func cleanFileName(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		return "upload"
	}
	return string([]rune(name)[:min(len([]rune(name)), 256)])
}

func (f *Framework) fileView(ctx context.Context, row *ent.ManagedFile) (map[string]any, error) {
	storage, err := f.Store.Client.FileStorageConfig.Get(ctx, row.StorageConfigID)
	if err != nil {
		return nil, err
	}
	account, err := f.Store.Client.User.Get(ctx, row.UploaderID)
	if err != nil {
		return nil, err
	}
	id := row.ID.String()
	contentURL := "/api/v1/files/" + id + "/content"
	if row.Visibility == "restricted" {
		contentURL = "/api/v1/files/" + id + "/private-content"
	}
	return map[string]any{"id": id, "storageConfigId": storage.ID, "storageName": storage.Name, "provider": "local", "originalName": row.OriginalName,
		"objectKey": row.ObjectKey, "size": row.Size, "mimeType": row.MimeType, "extension": row.Extension, "visibility": row.Visibility,
		"contentHash": row.ContentHash, "url": contentURL, "directUrl": nil, "uploaderName": account.Nickname,
		"createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}, nil
}

func (f *Framework) listFiles(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	q := r.URL.Query()
	page, err := positiveInt(q.Get("page"), 1, 1000000)
	if err != nil {
		fail(w, 400, "invalid_page", err.Error())
		return
	}
	size, err := positiveInt(q.Get("pageSize"), 10, 200)
	if err != nil {
		fail(w, 400, "invalid_page_size", err.Error())
		return
	}
	query := f.Store.Client.ManagedFile.Query().Where(fileScope(p), managedfile.DeletePending(false))
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(managedfile.Or(managedfile.OriginalNameContainsFold(keyword), managedfile.ObjectKeyContainsFold(keyword)))
	}
	if provider := q.Get("provider"); provider != "" && provider != "local" {
		fail(w, 400, "invalid_provider", "仅支持本地存储")
		return
	}
	if fileType := q.Get("fileType"); fileType != "" {
		switch fileType {
		case "image", "video", "audio":
			query = query.Where(managedfile.MimeTypeHasPrefix(fileType + "/"))
		case "document":
			query = query.Where(managedfile.Not(managedfile.Or(managedfile.MimeTypeHasPrefix("image/"), managedfile.MimeTypeHasPrefix("video/"), managedfile.MimeTypeHasPrefix("audio/"))))
		default:
			fail(w, 400, "invalid_file_type", "文件类型无效")
			return
		}
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startDate", false}, {"endDate", true}} {
		if raw := q.Get(bound.key); raw != "" {
			value, err := parseFilterDateBound(raw, bound.end)
			if err != nil {
				fail(w, 400, "invalid_date", err.Error())
				return
			}
			if bound.end {
				query = query.Where(managedfile.CreatedAtLTE(value))
			} else {
				query = query.Where(managedfile.CreatedAtGTE(value))
			}
		}
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Desc(managedfile.FieldCreatedAt)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.fileView(r.Context(), row)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func fileID(r *http.Request) (uuid.UUID, error) { return uuid.Parse(mux.Vars(r)["id"]) }
func (f *Framework) scopedFile(ctx context.Context, p *principal, id uuid.UUID) (*ent.ManagedFile, error) {
	return f.Store.Client.ManagedFile.Query().Where(managedfile.IDEQ(id), fileScope(p), managedfile.DeletePending(false)).Only(ctx)
}

func (f *Framework) getFile(w http.ResponseWriter, r *http.Request) {
	id, err := fileID(r)
	if err != nil {
		fail(w, 400, "invalid_id", "文件 ID 无效")
		return
	}
	row, err := f.scopedFile(r.Context(), fromContext(r.Context()), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "文件不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	view, err := f.fileView(r.Context(), row)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}

func (f *Framework) uploadOne(w http.ResponseWriter, r *http.Request) {
	settings, _, err := f.loadFileSettings(r.Context())
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取上传策略失败")
		return
	}
	maxBytes := maxSingleUploadBytes
	if settings.UploadMaxSizeMb > 0 && int64(settings.UploadMaxSizeMb)*mib < maxBytes {
		maxBytes = int64(settings.UploadMaxSizeMb) * mib
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+1024*1024)
	visibility := r.URL.Query().Get("visibility")
	if visibility == "" {
		visibility = "public"
	}
	if visibility != "public" && visibility != "restricted" {
		fail(w, 400, "invalid_visibility", "文件可见性无效")
		return
	}
	reader, err := r.MultipartReader()
	if err != nil {
		fail(w, 400, "invalid_multipart", "上传内容无效")
		return
	}
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
		view, err := f.persistFile(r.Context(), fromContext(r.Context()), part, part.FileName(), visibility, requestID(r), maxBytes)
		part.Close()
		if err != nil {
			fail(w, 400, "upload_failed", err.Error())
			return
		}
		respond(w, 200, view)
		return
	}
	fail(w, 400, "missing_file", "请选择文件")
}

func (f *Framework) persistFile(ctx context.Context, p *principal, input io.Reader, rawName, visibility, trace string, maxBytes int64) (map[string]any, error) {
	return f.persistFileWithLimit(ctx, p, input, rawName, visibility, trace, maxBytes, -1, nil, nil)
}

func (f *Framework) persistFileWithLimit(ctx context.Context, p *principal, input io.Reader, rawName, visibility, trace string, maxBytes, expected int64, storage *ent.FileStorageConfig, afterSave func(*ent.Tx) error) (map[string]any, error) {
	settings, _, err := f.loadFileSettings(ctx)
	if err != nil {
		return nil, err
	}
	if storage == nil {
		var err error
		storage, err = f.defaultStorage(ctx)
		if err != nil {
			return nil, errors.New("无可用本地存储配置")
		}
	}
	root := storage.LocalRootPath
	rootHandle, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer rootHandle.Close()
	if err := rootHandle.MkdirAll(".tmp", 0700); err != nil {
		return nil, err
	}
	tempKey := ".tmp/upload-" + uuid.NewString()
	temp, err := rootHandle.OpenFile(tempKey, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	defer rootHandle.Remove(tempKey)
	hash := sha256.New()
	head := make([]byte, 512)
	n, readErr := io.ReadFull(input, head)
	if readErr != nil && !errors.Is(readErr, io.EOF) && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		temp.Close()
		return nil, readErr
	}
	mimeType := strings.SplitN(http.DetectContentType(head[:n]), ";", 2)[0]
	expectedMime := expectedSignatureMime(rawName)
	if settings.UploadValidateType && (expectedMime != "" && expectedMime != mimeType || !mimeAllowed(mimeType, settings.UploadAllowedTypes)) {
		temp.Close()
		return nil, errors.New("文件类型不允许")
	}
	if _, err = io.Copy(io.MultiWriter(temp, hash), io.MultiReader(bytes.NewReader(head[:n]), io.LimitReader(input, maxBytes+1))); err != nil {
		temp.Close()
		return nil, err
	}
	size, err := temp.Seek(0, io.SeekCurrent)
	if err != nil {
		temp.Close()
		return nil, err
	}
	if size > maxBytes {
		temp.Close()
		return nil, errors.New("文件超过上传大小限制")
	}
	if expected >= 0 && size != expected {
		temp.Close()
		return nil, errors.New("合并后的文件大小与上传会话不一致")
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return nil, err
	}
	if err := temp.Close(); err != nil {
		return nil, err
	}
	id := uuid.New()
	key := path.Join("objects", id.String()[:2], id.String())
	if err := rootHandle.MkdirAll(path.Dir(key), 0700); err != nil {
		return nil, err
	}
	if err := rootHandle.Rename(tempKey, key); err != nil {
		return nil, err
	}
	name := cleanFileName(rawName)
	extension := strings.ToLower(path.Ext(name))
	if len(extension) > 32 {
		extension = ""
	}
	var row *ent.ManagedFile
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		create := tx.ManagedFile.Create().SetID(id).SetStorageConfigID(storage.ID).SetUploaderID(p.User.ID).SetOriginalName(name).SetObjectKey(key).SetSize(size).SetMimeType(mimeType).SetExtension(extension).SetVisibility(visibility).SetContentHash(hex.EncodeToString(hash.Sum(nil)))

		var err error
		row, err = create.Save(ctx)
		if err != nil {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetOperation("upload").SetResource("files").SetRequestID(trace)

		if err := audit.Exec(ctx); err != nil {
			return err
		}
		if afterSave != nil {
			return afterSave(tx)
		}
		return nil
	})
	if err != nil {
		_ = rootHandle.Remove(key)
		return nil, err
	}
	return f.fileView(ctx, row)
}

func (f *Framework) fileContent(w http.ResponseWriter, r *http.Request) {
	id, err := fileID(r)
	if err != nil {
		fail(w, 404, "not_found", "文件不存在")
		return
	}
	row, err := f.Store.Client.ManagedFile.Query().Where(managedfile.IDEQ(id), managedfile.VisibilityEQ("public"), managedfile.DeletePending(false)).Only(r.Context())
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "文件不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	f.serveFileBytes(w, r, row)
}

func (f *Framework) privateFileContent(w http.ResponseWriter, r *http.Request) {
	id, err := fileID(r)
	if err != nil {
		fail(w, 404, "not_found", "文件不存在")
		return
	}
	p := fromContext(r.Context())
	row, err := f.scopedFile(r.Context(), p, id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "文件不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if !f.canReadPrivateFile(w, r, p, row) {
		return
	}
	f.serveFileBytes(w, r, row)
}

func (f *Framework) canReadPrivateFile(w http.ResponseWriter, r *http.Request, p *principal, row *ent.ManagedFile) bool {
	if row.Visibility == "public" || row.UploaderID == p.User.ID {
		return true
	}
	allowed, err := f.permitted(r.Context(), p, "system:file:list")
	if err != nil {
		fail(w, 503, "database_unavailable", "授权服务不可用")
		return false
	}
	if !allowed {
		fail(w, 403, "forbidden", "没有文件访问权限")
		return false
	}
	return true
}

func (f *Framework) serveFileBytes(w http.ResponseWriter, r *http.Request, row *ent.ManagedFile) {
	storage, err := f.Store.Client.FileStorageConfig.Get(r.Context(), row.StorageConfigID)
	if err != nil {
		fail(w, 503, "database_unavailable", "存储不可用")
		return
	}
	root, err := os.OpenRoot(storage.LocalRootPath)
	if err != nil {
		fail(w, 503, "storage_unavailable", "存储不可用")
		return
	}
	defer root.Close()
	file, err := root.Open(row.ObjectKey)
	if errors.Is(err, os.ErrNotExist) {
		fail(w, 404, "not_found", "文件内容不存在")
		return
	}
	if err != nil {
		fail(w, 503, "storage_unavailable", "文件读取失败")
		return
	}
	defer file.Close()
	if row.MimeType != nil {
		w.Header().Set("Content-Type", *row.MimeType)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	disposition := "inline"
	if r.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disposition, url.PathEscape(row.OriginalName)))
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, row.OriginalName, row.UpdatedAt, file)
}

func (f *Framework) accessFileURL(w http.ResponseWriter, r *http.Request) {
	id, err := fileID(r)
	if err != nil {
		fail(w, 400, "invalid_id", "文件 ID 无效")
		return
	}
	p := fromContext(r.Context())
	row, err := f.scopedFile(r.Context(), p, id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "文件不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if !f.canReadPrivateFile(w, r, p, row) {
		return
	}
	suffix := "/content"
	if row.Visibility != "public" {
		suffix = "/private-content"
	}
	if r.URL.Query().Get("purpose") == "download" {
		suffix += "?download=1"
	}
	respond(w, 200, map[string]any{"url": "/api/v1/files/" + id.String() + suffix, "strategy": "proxy", "expiresAt": nil})
}

func (f *Framework) deleteFile(w http.ResponseWriter, r *http.Request) {
	id, err := fileID(r)
	if err != nil {
		fail(w, 400, "invalid_id", "文件 ID 无效")
		return
	}
	p := fromContext(r.Context())
	row, err := f.Store.Client.ManagedFile.Query().Where(managedfile.IDEQ(id), fileScope(p)).Only(r.Context())
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "文件不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.ManagedFile.UpdateOneID(id).SetDeletePending(true).Exec(r.Context()); err != nil {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("delete").SetResource("files")

		return audit.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "删除失败")
		return
	}
	if err := f.removePendingFile(r.Context(), row); err != nil {
		fail(w, 503, "storage_unavailable", "删除等待重试")
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) deleteFilesBatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := decode(r, &body); err != nil || len(body.IDs) == 0 || len(body.IDs) > 500 {
		fail(w, 400, "invalid_request", "文件 ID 列表无效")
		return
	}
	ids := make([]uuid.UUID, 0, len(body.IDs))
	seen := map[uuid.UUID]bool{}
	for _, raw := range body.IDs {
		id, err := uuid.Parse(raw)
		if err != nil || seen[id] {
			fail(w, 400, "invalid_id", "文件 ID 无效或重复")
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	p := fromContext(r.Context())
	var rows []*ent.ManagedFile
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		rows, err = tx.ManagedFile.Query().Where(managedfile.IDIn(ids...), fileScope(p)).All(r.Context())
		if err != nil {
			return err
		}
		if len(rows) != len(ids) {
			return &ent.NotFoundError{}
		}
		if _, err := tx.ManagedFile.Update().Where(managedfile.IDIn(ids...)).SetDeletePending(true).Save(r.Context()); err != nil {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("delete_batch").SetResource("files")

		return audit.Exec(r.Context())
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "部分文件不存在或不在当前组织")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "批量删除失败")
		return
	}
	var storageErr error
	for _, row := range rows {
		if err := f.removePendingFile(r.Context(), row); err != nil {
			storageErr = errors.Join(storageErr, err)
		}
	}
	if storageErr != nil {
		fail(w, 503, "storage_unavailable", "部分文件删除等待重试")
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) downloadFilesBatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := decode(r, &body); err != nil || len(body.IDs) == 0 || len(body.IDs) > 100 {
		fail(w, 400, "invalid_request", "文件 ID 列表无效")
		return
	}
	ids := make([]uuid.UUID, 0, len(body.IDs))
	seen := map[uuid.UUID]bool{}
	for _, raw := range body.IDs {
		id, err := uuid.Parse(raw)
		if err != nil || seen[id] {
			fail(w, 400, "invalid_id", "文件 ID 无效或重复")
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	p := fromContext(r.Context())
	rows, err := f.Store.Client.ManagedFile.Query().Where(managedfile.IDIn(ids...), fileScope(p)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if len(rows) != len(ids) {
		fail(w, 404, "not_found", "部分文件不存在或不在当前组织")
		return
	}
	byID := make(map[uuid.UUID]*ent.ManagedFile, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	type source struct {
		file *os.File
		name string
	}
	sources := make([]source, 0, len(ids))
	defer func() {
		for _, item := range sources {
			_ = item.file.Close()
		}
	}()
	names := map[string]int{}
	for _, id := range ids {
		row := byID[id]
		storage, err := f.Store.Client.FileStorageConfig.Get(r.Context(), row.StorageConfigID)
		if err != nil {
			fail(w, 503, "database_unavailable", "存储不可用")
			return
		}
		root, err := os.OpenRoot(storage.LocalRootPath)
		if err != nil {
			fail(w, 503, "storage_unavailable", "存储不可用")
			return
		}
		file, openErr := root.Open(row.ObjectKey)
		_ = root.Close()
		if openErr != nil {
			fail(w, 503, "storage_unavailable", "文件读取失败")
			return
		}
		name := cleanFileName(row.OriginalName)
		names[name]++
		if names[name] > 1 {
			name = fmt.Sprintf("%d_%s", names[name], name)
		}
		sources = append(sources, source{file: file, name: name})
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=zenith-files.zip")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	archive := zip.NewWriter(w)
	for _, item := range sources {
		entry, err := archive.Create(item.name)
		if err != nil {
			log.Printf("batch download zip header: %v", err)
			return
		}
		if _, err := io.Copy(entry, item.file); err != nil {
			log.Printf("batch download read: %v", err)
			return
		}
	}
	if err := archive.Close(); err != nil {
		log.Printf("batch download close: %v", err)
	}
}

func (f *Framework) removePendingFile(ctx context.Context, row *ent.ManagedFile) error {
	storage, err := f.Store.Client.FileStorageConfig.Get(ctx, row.StorageConfigID)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(storage.LocalRootPath)
	if err != nil {
		return err
	}
	defer root.Close()
	if err := root.Remove(row.ObjectKey); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return f.Store.Client.ManagedFile.DeleteOneID(row.ID).Exec(ctx)
}

func (f *Framework) fileStats(w http.ResponseWriter, r *http.Request) {
	rows, err := f.Store.Client.ManagedFile.Query().Where(fileScope(fromContext(r.Context())), managedfile.DeletePending(false)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	now := time.Now()
	summary := map[string]int64{"totalFiles": 0, "totalSize": 0, "imageCount": 0, "docCount": 0, "videoCount": 0, "audioCount": 0, "todayCount": 0, "thisMonthCount": 0}
	type typeStat struct {
		Type  string `json:"type"`
		Label string `json:"label"`
		Count int64  `json:"count"`
		Size  int64  `json:"size"`
	}
	type providerStat struct {
		Provider string `json:"provider"`
		Count    int64  `json:"count"`
		Size     int64  `json:"size"`
	}
	type monthlyStat struct {
		Month string `json:"month"`
		Count int64  `json:"count"`
	}
	type uploaderStat struct {
		Username string `json:"username"`
		Count    int64  `json:"count"`
		Size     int64  `json:"size"`
	}
	type sizeRangeStat struct {
		Range string `json:"range"`
		Count int64  `json:"count"`
	}
	types := map[string]*typeStat{"image": {Type: "image", Label: "图片"}, "document": {Type: "document", Label: "文档"}, "video": {Type: "video", Label: "视频"}, "audio": {Type: "audio", Label: "音频"}}
	provider := providerStat{Provider: "local"}
	months := map[string]int64{}
	uploaders := map[int]*uploaderStat{}
	ranges := map[string]int64{"<1MB": 0, "1-10MB": 0, "10-100MB": 0, ">=100MB": 0}
	for _, row := range rows {
		summary["totalFiles"]++
		summary["totalSize"] += row.Size
		mime := ""
		if row.MimeType != nil {
			mime = *row.MimeType
		}
		fileType := "document"
		switch {
		case strings.HasPrefix(mime, "image/"):
			summary["imageCount"]++
			fileType = "image"
		case strings.HasPrefix(mime, "video/"):
			summary["videoCount"]++
			fileType = "video"
		case strings.HasPrefix(mime, "audio/"):
			summary["audioCount"]++
			fileType = "audio"
		default:
			summary["docCount"]++
		}
		types[fileType].Count++
		types[fileType].Size += row.Size
		provider.Count++
		provider.Size += row.Size
		months[row.CreatedAt.Format("2006-01")]++
		if uploaders[row.UploaderID] == nil {
			user, err := f.Store.Client.User.Get(r.Context(), row.UploaderID)
			if err != nil {
				fail(w, 503, "database_unavailable", "查询失败")
				return
			}
			uploaders[row.UploaderID] = &uploaderStat{Username: user.Username}
		}
		uploaders[row.UploaderID].Count++
		uploaders[row.UploaderID].Size += row.Size
		switch {
		case row.Size < 1<<20:
			ranges["<1MB"]++
		case row.Size < 10<<20:
			ranges["1-10MB"]++
		case row.Size < 100<<20:
			ranges["10-100MB"]++
		default:
			ranges[">=100MB"]++
		}
		if row.CreatedAt.Year() == now.Year() && row.CreatedAt.YearDay() == now.YearDay() {
			summary["todayCount"]++
		}
		if row.CreatedAt.Year() == now.Year() && row.CreatedAt.Month() == now.Month() {
			summary["thisMonthCount"]++
		}
	}
	typeStats := make([]typeStat, 0, len(types))
	for _, key := range []string{"image", "document", "video", "audio"} {
		typeStats = append(typeStats, *types[key])
	}
	providerStats := []providerStat{provider}
	monthlyStats := make([]monthlyStat, 0, len(months))
	for month, count := range months {
		monthlyStats = append(monthlyStats, monthlyStat{month, count})
	}
	sort.Slice(monthlyStats, func(i, j int) bool { return monthlyStats[i].Month < monthlyStats[j].Month })
	uploaderStats := make([]uploaderStat, 0, len(uploaders))
	for _, value := range uploaders {
		uploaderStats = append(uploaderStats, *value)
	}
	sort.Slice(uploaderStats, func(i, j int) bool { return uploaderStats[i].Count > uploaderStats[j].Count })
	sizeRangeStats := make([]sizeRangeStat, 0, len(ranges))
	for _, key := range []string{"<1MB", "1-10MB", "10-100MB", ">=100MB"} {
		sizeRangeStats = append(sizeRangeStats, sizeRangeStat{key, ranges[key]})
	}
	respond(w, 200, map[string]any{"summary": summary, "typeStats": typeStats, "providerStats": providerStats, "monthlyStats": monthlyStats, "uploaderStats": uploaderStats, "sizeRangeStats": sizeRangeStats})
}
