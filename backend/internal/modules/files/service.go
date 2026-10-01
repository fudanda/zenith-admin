package files

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
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/filestorageconfig"
	"github.com/fudanda/zenith-admin/backend/ent/managedfile"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/uploadchunk"
	"github.com/fudanda/zenith-admin/backend/ent/uploadsession"
	"github.com/fudanda/zenith-admin/backend/internal/data"
	"github.com/fudanda/zenith-admin/backend/internal/kernel"
	"github.com/fudanda/zenith-admin/backend/internal/storage"
	"github.com/fudanda/zenith-admin/backend/internal/validation"
	"github.com/google/uuid"
)

type Dependencies struct {
	Permitted func(context.Context, *kernel.Principal, string) (bool, error)

	LoadFileSettings func(ctx context.Context) (kernel.FileSettings, *ent.SystemSetting, error)
}

type Service struct {
	FileStorage   storage.Provider
	EncryptionKey []byte
	StagingPath   string
	Store         *data.Store
	deps          Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

const minChunkBytes int64 = 5 << 20

const maxChunkBytes int64 = 32 << 20

const maxChunks int64 = 10000

func uploadScope(_ *kernel.Principal) predicate.UploadSession { return uploadsession.IDNEQ("") }

func uploadPartsKey(id string) (string, error) {
	if _, err := uuid.Parse(id); err != nil {
		return "", err
	}
	return path.Join(".chunks", id), nil
}

func hashFile(root storage.Root, name string) (string, error) {
	file, err := root.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

type storageConfigInput struct {
	Name, Provider, Status, LocalRootPath string
	IsDefault                             bool
	Remark                                *string
}

func validateStorageConfig(in storageConfigInput) error {
	if len([]rune(strings.TrimSpace(in.Name))) == 0 || len([]rune(in.Name)) > 64 {
		return errors.New("配置名称无效")
	}
	if in.Provider != "local" {
		return errors.New("首版仅支持本地存储")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("状态无效")
	}
	if in.IsDefault && in.Status != "enabled" {
		return errors.New("默认存储必须启用")
	}
	if !filepath.IsAbs(in.LocalRootPath) || len(in.LocalRootPath) > 512 {
		return errors.New("存储目录必须是绝对路径")
	}
	if in.Remark != nil && len([]rune(*in.Remark)) > 256 {
		return errors.New("备注过长")
	}
	return nil
}

func checkWritableDirectory(path string) error {
	if err := os.MkdirAll(path, 0700); err != nil {
		return err
	}
	file, err := os.CreateTemp(path, ".zenith-check-")
	if err != nil {
		return err
	}
	name := file.Name()
	if err := file.Close(); err != nil {
		return err
	}
	return os.Remove(name)
}

const maxSingleUploadBytes int64 = 100 * 1024 * 1024

func fileScope(_ *kernel.Principal) predicate.ManagedFile {
	return managedfile.Not(managedfile.IDEQ(uuid.Nil))
}

func cleanFileName(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		return "upload"
	}
	return string([]rune(name)[:min(len([]rune(name)), 256)])
}

func (f *Service) UploadFiles(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	settings, _, err := f.deps.LoadFileSettings(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取上传策略失败")
	}
	maxBytes := maxSingleUploadBytes
	if settings.UploadMaxSizeMb > 0 && int64(settings.UploadMaxSizeMb)*kernel.Mib < maxBytes {
		maxBytes = int64(settings.UploadMaxSizeMb) * kernel.Mib
	}
	reader := inArgs.Files
	visibility := inArgs.Filter.Get("visibility")
	if visibility == "" {
		visibility = "public"
	}
	if visibility != "public" && visibility != "restricted" {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_visibility", "文件可见性无效")
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
				err = f.RemovePendingFile(cleanup, row)
			}
			if err != nil {
				log.Printf("failed upload cleanup %s: %v", id, err)
			}
		}
	}()
	for {
		part, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_multipart", "上传内容无效")
		}

		if len(result) >= 20 {
			part.Reader.Close()
			return kernel.Outcome{}, kernel.Fail(400, "too_many_files", "单次最多上传 20 个文件")
		}
		view, err := f.PersistFile(ctx, kernel.FromContext(ctx), part.Reader, part.Name, visibility, inArgs.TraceID, maxBytes)
		part.Reader.Close()
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "upload_failed", err.Error())
		}
		result = append(result, view)
	}
	if len(result) == 0 {
		return kernel.Outcome{}, kernel.Fail(400, "missing_file", "请选择文件")
	}
	succeeded = true
	return kernel.Success(200, result)
}

func (f *Service) BrowseFiles(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Filter.Get("storageConfigId"))
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	if _, err = f.Store.Client.FileStorageConfig.Get(ctx, id); err != nil {
		if ent.IsNotFound(err) {
			return kernel.Outcome{}, kernel.Fail(404, "not_found", "存储配置不存在")
		} else {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "存储查询失败")
		}

	}
	current := strings.Trim(inArgs.Filter.Get("path"), "/")
	if strings.Contains(current, "\\") || current != "" && path.Clean(current) != current || current == ".." || strings.HasPrefix(current, "../") {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_path", "目录路径无效")
	}
	prefix := ""
	if current != "" {
		prefix = current + "/"
	}
	rows, err := f.Store.Client.ManagedFile.Query().Where(managedfile.StorageConfigIDEQ(id), managedfile.DeletePending(false), managedfile.ObjectKeyHasPrefix(prefix)).Order(ent.Desc(managedfile.FieldCreatedAt)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "文件查询失败")
	}
	dirs := map[string]bool{}
	files := []any{}
	for _, row := range rows {
		relative := strings.TrimPrefix(row.ObjectKey, prefix)
		if index := strings.Index(relative, "/"); index >= 0 {
			dirs[relative[:index]] = true
			continue
		}
		view, err := f.FileView(ctx, row)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "文件查询失败")
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
	return kernel.Success(200, map[string]any{"folders": folders, "files": files, "currentPath": current, "basePath": ""})
}

func (f *Service) OwnedUpload(ctx context.Context, p *kernel.Principal, id string) (*ent.UploadSession, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, &ent.NotFoundError{}
	}
	return f.Store.Client.UploadSession.Query().Where(uploadsession.IDEQ(id), uploadsession.UploaderIDEQ(p.User.ID), uploadScope(p)).Only(ctx)
}

func (f *Service) UploadInit(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var in struct {
		FileName   string `json:"fileName"`
		FileSize   int64  `json:"fileSize"`
		MimeType   string `json:"mimeType"`
		ChunkSize  int64  `json:"chunkSize"`
		Visibility string `json:"visibility"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || in.FileName == "" || len([]rune(in.FileName)) > 256 || in.FileSize < 0 || in.ChunkSize < minChunkBytes || in.ChunkSize > maxChunkBytes || len(in.MimeType) > 128 || (in.Visibility != "" && in.Visibility != "public" && in.Visibility != "restricted") {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_upload", "分片上传参数无效")
	}
	if in.Visibility == "" {
		in.Visibility = "public"
	}
	settings, _, err := f.deps.LoadFileSettings(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取上传策略失败")
	}
	if settings.UploadMaxSizeMb > 0 && in.FileSize > int64(settings.UploadMaxSizeMb)*kernel.Mib {
		return kernel.Outcome{}, kernel.Fail(400, "file_too_large", "文件超过上传大小限制")
	}
	if baseline := int64(settings.ChunkSizeMb) * kernel.Mib; in.ChunkSize < baseline {
		in.ChunkSize = baseline
	}
	total := (in.FileSize + in.ChunkSize - 1) / in.ChunkSize
	if total == 0 {
		total = 1
	}
	if total > maxChunks {
		return kernel.Outcome{}, kernel.Fail(400, "too_many_chunks", "分片数超过上限")
	}
	storage, err := f.DefaultStorage(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "storage_unavailable", "请先配置默认本地存储")
	}
	id := uuid.NewString()
	p := kernel.FromContext(ctx)
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		create := tx.UploadSession.Create().SetID(id).SetStorageConfigID(storage.ID).SetUploaderID(p.User.ID).SetFileName(cleanFileName(in.FileName)).SetFileSize(in.FileSize).SetChunkSize(in.ChunkSize).SetTotalChunks(int(total)).SetVisibility(in.Visibility).SetExpiresAt(time.Now().Add(24 * time.Hour))
		if in.MimeType != "" {
			create.SetMimeType(in.MimeType)
		}

		if err := create.Exec(ctx); err != nil {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetOperation("upload_init").SetResource("upload_sessions").SetRequestID(inArgs.TraceID)

		return audit.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "无法初始化上传")
	}
	return kernel.Success(200, map[string]any{"uploadId": id, "chunkSize": in.ChunkSize, "totalChunks": total, "received": []int{}})
}

func (f *Service) UploadChunk(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id := inArgs.UploadId
	index, err := strconv.Atoi(inArgs.Index)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_index", "分片序号无效")
	}
	p := kernel.FromContext(ctx)
	session, err := f.OwnedUpload(ctx, p, id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "上传会话不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if session.Status != "uploading" || session.ExpiresAt.Before(time.Now()) || index < 0 || index >= session.TotalChunks {
		return kernel.Outcome{}, kernel.Fail(409, "invalid_session", "上传会话不可接收分片")
	}
	storage, err := f.Store.Client.FileStorageConfig.Get(ctx, session.StorageConfigID)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "存储不可用")
	}
	key, err := uploadPartsKey(id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_upload", "上传会话无效")
	}
	root, err := f.FileStorage.OpenRoot(storage.LocalRootPath)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "存储不可用")
	}
	defer root.Close()
	if err := root.MkdirAll(key, 0700); err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "分片目录不可用")
	}
	dir, err := root.OpenRoot(key)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "分片目录不可用")
	}
	defer dir.Close()
	file := inArgs.Upload
	tempKey := ".part-" + uuid.NewString()
	temp, err := dir.OpenFile(tempKey, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "无法写入分片")
	}
	defer dir.Remove(tempKey)
	hash := sha256.New()
	size, copyErr := io.Copy(io.MultiWriter(temp, hash), io.LimitReader(file, maxChunkBytes+1))
	closeErr := temp.Close()
	want := session.ChunkSize
	if index == session.TotalChunks-1 {
		want = session.FileSize - int64(index)*session.ChunkSize
	}
	if copyErr != nil || closeErr != nil || size != want {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_chunk_size", "分片大小与上传会话不一致")
	}
	checksum := hex.EncodeToString(hash.Sum(nil))
	final := strconv.Itoa(index)
	linkErr := dir.Link(tempKey, final)
	if linkErr != nil && !errors.Is(linkErr, os.ErrExist) {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "分片保存失败")
	}
	linked := linkErr == nil
	if _, err := dir.Stat(final); err == nil {
		checksumOnDisk, hashErr := hashFile(dir, final)
		if hashErr != nil || checksumOnDisk != checksum {
			return kernel.Outcome{}, kernel.Fail(409, "chunk_conflict", "该序号分片内容不一致")
		}
	}
	row, err := f.Store.Client.UploadChunk.Query().Where(uploadchunk.UploadIDEQ(id), uploadchunk.ChunkIndexEQ(index)).Only(ctx)
	if ent.IsNotFound(err) {
		err = f.Store.Client.UploadChunk.Create().SetUploadID(id).SetChunkIndex(index).SetSize(size).SetHash(checksum).Exec(ctx)
		if ent.IsConstraintError(err) {
			row, err = f.Store.Client.UploadChunk.Query().Where(uploadchunk.UploadIDEQ(id), uploadchunk.ChunkIndexEQ(index)).Only(ctx)
			if err == nil && row.Hash != checksum {
				return kernel.Outcome{}, kernel.Fail(409, "chunk_conflict", "该序号分片内容不一致")
			}
		}
	} else if err == nil && row.Hash != checksum {
		return kernel.Outcome{}, kernel.Fail(409, "chunk_conflict", "该序号分片内容不一致")
	}
	if err != nil {
		if linked {
			_ = dir.Remove(final)
		}
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "分片记录失败")
	}
	count, err := f.Store.Client.UploadChunk.Query().Where(uploadchunk.UploadIDEQ(id)).Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, map[string]any{"index": index, "receivedCount": count})
}

func (f *Service) UploadStatus(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id := inArgs.UploadId
	session, err := f.OwnedUpload(ctx, kernel.FromContext(ctx), id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "上传会话不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	chunks, err := f.Store.Client.UploadChunk.Query().Where(uploadchunk.UploadIDEQ(id)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	received := make([]int, 0, len(chunks))
	for _, chunk := range chunks {
		received = append(received, chunk.ChunkIndex)
	}
	sort.Ints(received)
	return kernel.Success(200, map[string]any{"uploadId": id, "status": session.Status, "chunkSize": session.ChunkSize, "totalChunks": session.TotalChunks, "received": received})
}

func (f *Service) UploadComplete(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var in struct {
		UploadID string `json:"uploadId"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "上传会话无效")
	}
	p := kernel.FromContext(ctx)
	session, err := f.OwnedUpload(ctx, p, in.UploadID)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "上传会话不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if session.Status != "uploading" || session.ExpiresAt.Before(time.Now()) {
		return kernel.Outcome{}, kernel.Fail(409, "invalid_session", "上传会话不可合并")
	}
	settings, _, err := f.deps.LoadFileSettings(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取上传策略失败")
	}
	if settings.UploadMaxSizeMb > 0 && session.FileSize > int64(settings.UploadMaxSizeMb)*kernel.Mib {
		return kernel.Outcome{}, kernel.Fail(400, "file_too_large", "文件超过上传大小限制")
	}
	chunks, err := f.Store.Client.UploadChunk.Query().Where(uploadchunk.UploadIDEQ(in.UploadID)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if len(chunks) != session.TotalChunks {
		return kernel.Outcome{}, kernel.Fail(409, "incomplete_upload", "仍有分片未上传")
	}
	seen := make([]bool, session.TotalChunks)
	byIndex := make(map[int]*ent.UploadChunk, len(chunks))
	for _, chunk := range chunks {
		if chunk.ChunkIndex < 0 || chunk.ChunkIndex >= len(seen) || seen[chunk.ChunkIndex] {
			return kernel.Outcome{}, kernel.Fail(409, "invalid_chunks", "分片记录无效")
		}
		seen[chunk.ChunkIndex] = true
		byIndex[chunk.ChunkIndex] = chunk
	}
	claimed, err := f.Store.Client.UploadSession.Update().Where(uploadsession.IDEQ(in.UploadID), uploadsession.StatusEQ("uploading")).SetStatus("completing").Save(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "无法抢占合并权")
	}
	if claimed != 1 {
		return kernel.Outcome{}, kernel.Fail(409, "upload_in_progress", "上传正在合并")
	}
	completed := false
	defer func() {
		if !completed {
			_, _ = f.Store.Client.UploadSession.Update().Where(uploadsession.IDEQ(in.UploadID), uploadsession.StatusEQ("completing")).SetStatus("uploading").Save(context.Background())
		}
	}()
	storage, err := f.Store.Client.FileStorageConfig.Get(ctx, session.StorageConfigID)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "存储不可用")
	}
	key, err := uploadPartsKey(in.UploadID)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(500, "invalid_storage_key", "分片路径无效")
	}
	root, err := f.FileStorage.OpenRoot(storage.LocalRootPath)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "存储不可用")
	}
	defer root.Close()
	dir, err := root.OpenRoot(key)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "分片目录不可用")
	}
	defer dir.Close()
	if err := root.MkdirAll(".tmp", 0700); err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "临时目录不可用")
	}
	mergedKey := ".tmp/merge-" + uuid.NewString()
	merged, err := root.OpenFile(mergedKey, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "无法合并分片")
	}
	defer root.Remove(mergedKey)
	for index := 0; index < session.TotalChunks; index++ {
		part, openErr := dir.Open(strconv.Itoa(index))
		if openErr != nil {
			merged.Close()
			return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "分片内容缺失")
		}
		partHash := sha256.New()
		partSize, copyErr := io.Copy(io.MultiWriter(merged, partHash), part)
		part.Close()
		if copyErr != nil || partSize != byIndex[index].Size || hex.EncodeToString(partHash.Sum(nil)) != byIndex[index].Hash {
			merged.Close()
			return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "分片校验失败")
		}
	}
	if _, err := merged.Seek(0, io.SeekStart); err != nil {
		merged.Close()
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "分片合并失败")
	}
	view, err := f.PersistFileWithLimit(ctx, p, merged, session.FileName, session.Visibility, inArgs.TraceID, session.FileSize, session.FileSize, storage, func(tx *ent.Tx) error {
		return tx.UploadSession.UpdateOneID(in.UploadID).SetStatus("completed").Exec(ctx)
	})
	merged.Close()
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "upload_failed", err.Error())
	}
	completed = true
	if err := root.RemoveAll(key); err != nil { /* Maintenance removes expired chunk directories. */
	}
	return kernel.Success(200, view)
}

func (f *Service) UploadAbort(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id := inArgs.UploadId
	session, err := f.OwnedUpload(ctx, kernel.FromContext(ctx), id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "上传会话不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if session.Status == "completing" || session.Status == "completed" {
		return kernel.Outcome{}, kernel.Fail(409, "upload_in_progress", "上传已进入合并阶段")
	}
	changed := 0
	p := kernel.FromContext(ctx)
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		changed, err = tx.UploadSession.Update().Where(uploadsession.IDEQ(id), uploadsession.StatusEQ("uploading")).SetStatus("aborted").Save(ctx)
		if err != nil || changed == 0 {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetOperation("upload_abort").SetResource("upload_sessions").SetRequestID(inArgs.TraceID)

		return audit.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "无法取消上传")
	}
	if changed == 0 && session.Status != "aborted" {
		return kernel.Outcome{}, kernel.Fail(409, "upload_in_progress", "上传状态已经改变")
	}
	if _, err := f.Store.Client.UploadChunk.Delete().Where(uploadchunk.UploadIDEQ(id)).Exec(ctx); err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "分片清理失败")
	}
	storage, err := f.Store.Client.FileStorageConfig.Get(ctx, session.StorageConfigID)
	if err == nil {
		if key, pathErr := uploadPartsKey(id); pathErr == nil {
			if root, openErr := f.FileStorage.OpenRoot(storage.LocalRootPath); openErr == nil {
				_ = root.RemoveAll(key)
				root.Close()
			}
		}
	}
	return kernel.Success(200, nil)
}

func (f *Service) CleanupExpiredUploads(ctx context.Context) error {
	sessions, err := f.Store.Client.UploadSession.Query().Where(uploadsession.ExpiresAtLT(time.Now())).Limit(100).All(ctx)
	if err != nil {
		return err
	}
	for _, session := range sessions {
		storage, err := f.Store.Client.FileStorageConfig.Get(ctx, session.StorageConfigID)
		if err != nil {
			return err
		}
		key, err := uploadPartsKey(session.ID)
		if err != nil {
			return err
		}
		root, err := f.FileStorage.OpenRoot(storage.LocalRootPath)
		if err != nil {
			return err
		}
		if err := root.RemoveAll(key); err != nil {
			root.Close()
			return err
		}
		root.Close()
		if err := f.Store.Client.UploadSession.DeleteOneID(session.ID).Exec(ctx); err != nil {
			return err
		}
	}
	configs, err := f.Store.Client.FileStorageConfig.Query().All(ctx)
	if err != nil {
		return err
	}
	for _, config := range configs {
		root, err := f.FileStorage.OpenRoot(config.LocalRootPath)
		if err != nil {
			return err
		}
		dir, err := root.Open(".tmp")
		if errors.Is(err, os.ErrNotExist) {
			root.Close()
			continue
		}
		if err != nil {
			root.Close()
			return err
		}
		entries, err := dir.ReadDir(-1)
		if err != nil {
			dir.Close()
			root.Close()
			return err
		}
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			name := entry.Name()
			if len(name) < 7 || (name[:7] != "upload-" && name[:6] != "merge-") {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				continue
			}
			if info.ModTime().Before(time.Now().Add(-24 * time.Hour)) {
				_ = root.Remove(path.Join(".tmp", name))
			}
		}
		dir.Close()
		root.Close()
	}
	return nil
}

func (f *Service) ListFileConfigs(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	q := inArgs.Filter
	page, err := kernel.PositiveInt(q.Get("page"), 1, 1000000)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_page", err.Error())
	}
	size, err := kernel.PositiveInt(q.Get("pageSize"), 10, 200)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_page_size", err.Error())
	}
	query := f.Store.Client.FileStorageConfig.Query()
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_status", "状态无效")
		}
		query = query.Where(filestorageconfig.StatusEQ(status))
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startTime", false}, {"endTime", true}} {
		if raw := q.Get(bound.key); raw != "" {
			value, err := validation.DateBound(raw, bound.end)
			if err != nil {
				return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
			}
			if bound.end {
				query = query.Where(filestorageconfig.UpdatedAtLTE(value))
			} else {
				query = query.Where(filestorageconfig.UpdatedAtGTE(value))
			}
		}
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	rows, err := query.Order(ent.Desc(filestorageconfig.FieldID)).Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, kernel.StorageConfigView(row))
	}
	return kernel.Success(200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Service) DefaultFileConfig(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	row, err := f.Store.Client.FileStorageConfig.Query().Where(filestorageconfig.IsDefault(true), filestorageconfig.StatusEQ("enabled")).Only(ctx)
	if ent.IsNotFound(err) {
		return kernel.Success(200, nil)
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, kernel.StorageConfigView(row))
}

func (f *Service) GetFileConfig(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	row, err := f.Store.Client.FileStorageConfig.Get(ctx, id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "存储配置不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, kernel.StorageConfigView(row))
}

func (f *Service) SaveFileConfig(ctx context.Context, in kernel.Input) (kernel.Outcome, error) {
	return f.SaveStorageConfig(ctx, in)
}

func (f *Service) SetDefaultFileConfig(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	var saved *ent.FileStorageConfig
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		row, err := tx.FileStorageConfig.Get(ctx, id)
		if err != nil {
			return err
		}
		if row.Status != "enabled" {
			return errors.New("停用配置不能设为默认")
		}
		if _, err = tx.FileStorageConfig.Update().Where(filestorageconfig.IsDefault(true)).SetIsDefault(false).Save(ctx); err != nil {
			return err
		}
		saved, err = tx.FileStorageConfig.UpdateOneID(id).SetIsDefault(true).Save(ctx)
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("set_default").SetResource("file_storage_configs").SetResourceID(id).Exec(ctx)
	})
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "存储配置不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "storage_conflict", err.Error())
	}
	return kernel.Success(200, kernel.StorageConfigView(saved))
}

func (f *Service) DeleteFileConfig(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	count, err := f.Store.Client.ManagedFile.Query().Where(managedfile.StorageConfigIDEQ(id)).Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	active, err := f.Store.Client.UploadSession.Query().Where(uploadsession.StorageConfigIDEQ(id), uploadsession.StatusEQ("uploading")).Exist(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if count > 0 || active {
		return kernel.Outcome{}, kernel.Fail(409, "storage_in_use", "存储配置仍有文件或上传任务")
	}
	p := kernel.FromContext(ctx)
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.FileStorageConfig.DeleteOneID(id).Exec(ctx); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("delete").SetResource("file_storage_configs").SetResourceID(id).Exec(ctx)
	})
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "存储配置不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "删除失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) TestFileConfig(ctx context.Context, in kernel.Input) (kernel.Outcome, error) {
	return f.TestStorage(ctx, in)
}

func (f *Service) RetryPendingFileDeletes(ctx context.Context) error {
	if err := f.retryObjectCleanup(ctx); err != nil {
		return err
	}
	rows, err := f.Store.Client.ManagedFile.Query().Where(managedfile.DeletePending(true)).Limit(100).All(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := f.RemovePendingFile(ctx, row); err != nil {
			log.Printf("file delete retry %s: %v", row.ID, err)
		}
	}
	return nil
}

func (f *Service) DefaultStorage(ctx context.Context) (*ent.FileStorageConfig, error) {
	return f.Store.Client.FileStorageConfig.Query().Where(filestorageconfig.IsDefault(true), filestorageconfig.StatusEQ("enabled")).Only(ctx)
}

func (f *Service) FileView(ctx context.Context, row *ent.ManagedFile) (map[string]any, error) {
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
	return map[string]any{"id": id, "storageConfigId": storage.ID, "storageName": storage.Name, "provider": storage.Provider, "originalName": row.OriginalName,
		"objectKey": row.ObjectKey, "size": row.Size, "mimeType": row.MimeType, "extension": row.Extension, "visibility": row.Visibility,
		"contentHash": row.ContentHash, "url": contentURL, "directUrl": nil, "uploaderName": account.Nickname,
		"createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}, nil
}

func (f *Service) ListFiles(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	q := inArgs.Filter
	page, err := kernel.PositiveInt(q.Get("page"), 1, 1000000)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_page", err.Error())
	}
	size, err := kernel.PositiveInt(q.Get("pageSize"), 10, 200)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_page_size", err.Error())
	}
	query := f.Store.Client.ManagedFile.Query().Where(fileScope(p), managedfile.DeletePending(false))
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(managedfile.Or(managedfile.OriginalNameContainsFold(keyword), managedfile.ObjectKeyContainsFold(keyword)))
	}
	if provider := q.Get("provider"); provider != "" {
		if provider != "local" && provider != "s3" {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_provider", "存储类型无效")
		}
		configs, err := f.Store.Client.FileStorageConfig.Query().Where(filestorageconfig.ProviderEQ(provider)).All(ctx)
		if err != nil {
			return kernel.Outcome{}, err
		}
		ids := []int{}
		for _, config := range configs {
			ids = append(ids, config.ID)
		}
		query = query.Where(managedfile.StorageConfigIDIn(ids...))
	}
	if fileType := q.Get("fileType"); fileType != "" {
		switch fileType {
		case "image", "video", "audio":
			query = query.Where(managedfile.MimeTypeHasPrefix(fileType + "/"))
		case "document":
			query = query.Where(managedfile.Not(managedfile.Or(managedfile.MimeTypeHasPrefix("image/"), managedfile.MimeTypeHasPrefix("video/"), managedfile.MimeTypeHasPrefix("audio/"))))
		default:
			return kernel.Outcome{}, kernel.Fail(400, "invalid_file_type", "文件类型无效")
		}
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startDate", false}, {"endDate", true}} {
		if raw := q.Get(bound.key); raw != "" {
			value, err := validation.DateBound(raw, bound.end)
			if err != nil {
				return kernel.Outcome{}, kernel.Fail(400, "invalid_date", err.Error())
			}
			if bound.end {
				query = query.Where(managedfile.CreatedAtLTE(value))
			} else {
				query = query.Where(managedfile.CreatedAtGTE(value))
			}
		}
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	rows, err := query.Order(ent.Desc(managedfile.FieldCreatedAt)).Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.FileView(ctx, row)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		list = append(list, view)
	}
	return kernel.Success(200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Service) ScopedFile(ctx context.Context, p *kernel.Principal, id uuid.UUID) (*ent.ManagedFile, error) {
	return f.Store.Client.ManagedFile.Query().Where(managedfile.IDEQ(id), fileScope(p), managedfile.DeletePending(false)).Only(ctx)
}

func (f *Service) GetFile(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := uuid.Parse(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", "文件 ID 无效")
	}
	row, err := f.ScopedFile(ctx, kernel.FromContext(ctx), id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "文件不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	view, err := f.FileView(ctx, row)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, view)
}

func (f *Service) UploadOne(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	settings, _, err := f.deps.LoadFileSettings(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取上传策略失败")
	}
	maxBytes := maxSingleUploadBytes
	if settings.UploadMaxSizeMb > 0 && int64(settings.UploadMaxSizeMb)*kernel.Mib < maxBytes {
		maxBytes = int64(settings.UploadMaxSizeMb) * kernel.Mib
	}
	visibility := inArgs.Filter.Get("visibility")
	if visibility == "" {
		visibility = "public"
	}
	if visibility != "public" && visibility != "restricted" {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_visibility", "文件可见性无效")
	}
	reader := inArgs.Files
	for {
		part, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_multipart", "上传内容无效")
		}

		view, err := f.PersistFile(ctx, kernel.FromContext(ctx), part.Reader, part.Name, visibility, inArgs.TraceID, maxBytes)
		part.Reader.Close()
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "upload_failed", err.Error())
		}
		return kernel.Success(200, view)

	}
	return kernel.Outcome{}, kernel.Fail(400, "missing_file", "请选择文件")
}

func (f *Service) PersistFile(ctx context.Context, p *kernel.Principal, input io.Reader, rawName, visibility, trace string, maxBytes int64) (map[string]any, error) {
	return f.PersistFileWithLimit(ctx, p, input, rawName, visibility, trace, maxBytes, -1, nil, nil)
}

func (f *Service) PersistFileWithLimit(ctx context.Context, p *kernel.Principal, input io.Reader, rawName, visibility, trace string, maxBytes, expected int64, storage *ent.FileStorageConfig, afterSave func(*ent.Tx) error) (map[string]any, error) {
	settings, _, err := f.deps.LoadFileSettings(ctx)
	if err != nil {
		return nil, err
	}
	if storage == nil {
		var err error
		storage, err = f.DefaultStorage(ctx)
		if err != nil {
			return nil, errors.New("无可用存储配置")
		}
	}
	root := storage.LocalRootPath
	rootHandle, err := f.FileStorage.OpenRoot(root)
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
	mimeType := strings.SplitN(validation.DetectContentType(head[:n]), ";", 2)[0]
	expectedMime := kernel.ExpectedSignatureMime(rawName)
	if settings.UploadValidateType && (expectedMime != "" && expectedMime != mimeType || !kernel.MimeAllowed(mimeType, settings.UploadAllowedTypes)) {
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
	if storage.Provider == "s3" {
		key = path.Join(storage.BasePath, key)
		client, err := f.objects(storage)
		if err != nil {
			return nil, err
		}
		source, err := rootHandle.Open(tempKey)
		if err != nil {
			return nil, err
		}
		err = client.Put(ctx, key, source, size, mimeType)
		source.Close()
		if err != nil {
			_ = f.compensateObject(ctx, storage, key)
			return nil, errors.New("S3 上传失败")
		}
	} else if err := rootHandle.Rename(tempKey, key); err != nil {
		return nil, err
	}
	name := cleanFileName(rawName)
	extension := strings.ToLower(path.Ext(name))
	if len(extension) > 32 {
		extension = ""
	}
	var row *ent.ManagedFile
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		current, err := f.lockConfig(ctx, tx, storage.ID)
		if err != nil {
			return err
		}
		if current.Provider != storage.Provider || current.LocalRootPath != storage.LocalRootPath || current.S3Bucket != storage.S3Bucket || current.S3Endpoint != storage.S3Endpoint || current.BasePath != storage.BasePath {
			return kernel.Fail(409, "storage_changed", "上传期间存储位置已变更，请重试")
		}
		create := tx.ManagedFile.Create().SetID(id).SetStorageConfigID(storage.ID).SetUploaderID(p.User.ID).SetOriginalName(name).SetObjectKey(key).SetSize(size).SetMimeType(mimeType).SetExtension(extension).SetVisibility(visibility).SetContentHash(hex.EncodeToString(hash.Sum(nil)))

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
		_ = f.compensateObject(ctx, storage, key)
		return nil, err
	}
	return f.FileView(ctx, row)
}

func (f *Service) FileContent(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := uuid.Parse(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "文件不存在")
	}
	row, err := f.Store.Client.ManagedFile.Query().Where(managedfile.IDEQ(id), managedfile.VisibilityEQ("public"), managedfile.DeletePending(false)).Only(ctx)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "文件不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return f.OpenFileBytes(ctx, inArgs, row)
}

func (f *Service) PrivateFileContent(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := uuid.Parse(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "文件不存在")
	}
	p := kernel.FromContext(ctx)
	row, err := f.ScopedFile(ctx, p, id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "文件不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if err := f.CanReadPrivateFile(ctx, p, row); err != nil {
		return kernel.Outcome{}, err
	}
	return f.OpenFileBytes(ctx, inArgs, row)
}

func (f *Service) AccessFileURL(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := uuid.Parse(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", "文件 ID 无效")
	}
	p := kernel.FromContext(ctx)
	row, err := f.ScopedFile(ctx, p, id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "文件不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if err := f.CanReadPrivateFile(ctx, p, row); err != nil {
		return kernel.Outcome{}, err
	}
	suffix := "/content"
	if row.Visibility != "public" {
		suffix = "/private-content"
	}
	if inArgs.Filter.Get("purpose") == "download" {
		suffix += "?download=1"
	}
	return kernel.Success(200, map[string]any{"url": "/api/v1/files/" + id.String() + suffix, "strategy": "proxy", "expiresAt": nil})
}

func (f *Service) DeleteFile(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := uuid.Parse(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", "文件 ID 无效")
	}
	p := kernel.FromContext(ctx)
	row, err := f.Store.Client.ManagedFile.Query().Where(managedfile.IDEQ(id), fileScope(p)).Only(ctx)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "文件不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.ManagedFile.UpdateOneID(id).SetDeletePending(true).Exec(ctx); err != nil {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("delete").SetResource("files")

		return audit.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "删除失败")
	}
	if err := f.RemovePendingFile(ctx, row); err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "删除等待重试")
	}
	return kernel.Success(200, nil)
}

func (f *Service) DeleteFilesBatch(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &body); err != nil || len(body.IDs) == 0 || len(body.IDs) > 500 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "文件 ID 列表无效")
	}
	ids := make([]uuid.UUID, 0, len(body.IDs))
	seen := map[uuid.UUID]bool{}
	for _, raw := range body.IDs {
		id, err := uuid.Parse(raw)
		if err != nil || seen[id] {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_id", "文件 ID 无效或重复")
		}
		seen[id] = true
		ids = append(ids, id)
	}
	p := kernel.FromContext(ctx)
	var rows []*ent.ManagedFile
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		rows, err = tx.ManagedFile.Query().Where(managedfile.IDIn(ids...), fileScope(p)).All(ctx)
		if err != nil {
			return err
		}
		if len(rows) != len(ids) {
			return &ent.NotFoundError{}
		}
		if _, err := tx.ManagedFile.Update().Where(managedfile.IDIn(ids...)).SetDeletePending(true).Save(ctx); err != nil {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("delete_batch").SetResource("files")

		return audit.Exec(ctx)
	})
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "部分文件不存在或不在当前组织")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "批量删除失败")
	}
	var storageErr error
	for _, row := range rows {
		if err := f.RemovePendingFile(ctx, row); err != nil {
			storageErr = errors.Join(storageErr, err)
		}
	}
	if storageErr != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "部分文件删除等待重试")
	}
	return kernel.Success(200, nil)
}

func (f *Service) DownloadFilesBatch(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &body); err != nil || len(body.IDs) == 0 || len(body.IDs) > 100 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "文件 ID 列表无效")
	}
	ids := make([]uuid.UUID, 0, len(body.IDs))
	seen := map[uuid.UUID]bool{}
	for _, raw := range body.IDs {
		id, err := uuid.Parse(raw)
		if err != nil || seen[id] {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_id", "文件 ID 无效或重复")
		}
		seen[id] = true
		ids = append(ids, id)
	}
	p := kernel.FromContext(ctx)
	rows, err := f.Store.Client.ManagedFile.Query().Where(managedfile.IDIn(ids...), fileScope(p)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	if len(rows) != len(ids) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "部分文件不存在或不在当前组织")
	}
	byID := make(map[uuid.UUID]*ent.ManagedFile, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	type source struct {
		file readSeekCloser
		name string
	}
	sources := make([]source, 0, len(ids))
	handedOff := false
	defer func() {
		if handedOff {
			return
		}
		for _, item := range sources {
			_ = item.file.Close()
		}
	}()
	names := map[string]int{}
	for _, id := range ids {
		row := byID[id]
		storage, err := f.Store.Client.FileStorageConfig.Get(ctx, row.StorageConfigID)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "存储不可用")
		}
		file, openErr := f.openBytes(ctx, storage, row.ObjectKey)
		if openErr != nil {
			return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "文件读取失败")
		}
		name := cleanFileName(row.OriginalName)
		names[name]++
		if names[name] > 1 {
			name = fmt.Sprintf("%d_%s", names[name], name)
		}
		sources = append(sources, source{file: file, name: name})
	}
	handedOff = true
	return kernel.Outcome{Status: 200, Filename: "zenith-files.zip", ContentType: "application/zip", Write: func(writer io.Writer) error {
		defer func() {
			for _, item := range sources {
				item.file.Close()
			}
		}()
		archive := zip.NewWriter(writer)
		for _, item := range sources {
			if err := ctx.Err(); err != nil {
				return err
			}
			entry, err := archive.Create(item.name)
			if err != nil {
				return err
			}
			if _, err := io.Copy(entry, item.file); err != nil {
				return err
			}
		}
		return archive.Close()
	}}, nil
}

func (f *Service) RemovePendingFile(ctx context.Context, row *ent.ManagedFile) error {
	storage, err := f.Store.Client.FileStorageConfig.Get(ctx, row.StorageConfigID)
	if err != nil {
		return err
	}
	if err := f.removeBytes(ctx, storage, row.ObjectKey); err != nil {
		return err
	}
	return f.Store.Client.ManagedFile.DeleteOneID(row.ID).Exec(ctx)
}

func (f *Service) FileStats(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	rows, err := f.Store.Client.ManagedFile.Query().Where(fileScope(kernel.FromContext(ctx)), managedfile.DeletePending(false)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
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
	providers := map[string]*providerStat{"local": {Provider: "local"}, "s3": {Provider: "s3"}}
	configs, err := f.Store.Client.FileStorageConfig.Query().All(ctx)
	if err != nil {
		return kernel.Outcome{}, err
	}
	configProviders := map[int]string{}
	for _, config := range configs {
		configProviders[config.ID] = config.Provider
	}
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
		provider := providers[configProviders[row.StorageConfigID]]
		if provider != nil {
			provider.Count++
			provider.Size += row.Size
		}
		months[row.CreatedAt.Format("2006-01")]++
		if uploaders[row.UploaderID] == nil {
			user, err := f.Store.Client.User.Get(ctx, row.UploaderID)
			if err != nil {
				return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
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
	providerStats := []providerStat{*providers["local"], *providers["s3"]}
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
	return kernel.Success(200, map[string]any{"summary": summary, "typeStats": typeStats, "providerStats": providerStats, "monthlyStats": monthlyStats, "uploaderStats": uploaderStats, "sizeRangeStats": sizeRangeStats})
}

func (f *Service) OpenFileBytes(ctx context.Context, inArgs kernel.Input, row *ent.ManagedFile) (kernel.Outcome, error) {
	storage, err := f.Store.Client.FileStorageConfig.Get(ctx, row.StorageConfigID)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "存储不可用")
	}
	file, err := f.openBytes(ctx, storage, row.ObjectKey)
	if errors.Is(err, os.ErrNotExist) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "文件内容不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "storage_unavailable", "文件读取失败")
	}
	mimeType := "application/octet-stream"
	if row.MimeType != nil {
		mimeType = *row.MimeType
	}
	return kernel.Outcome{Status: 200, Binary: &kernel.Binary{Name: row.OriginalName, MIME: mimeType, Modified: row.UpdatedAt, Reader: file, Close: file.Close}}, nil
}
func (f *Service) CanReadPrivateFile(ctx context.Context, p *kernel.Principal, row *ent.ManagedFile) error {
	if row.Visibility == "public" || row.UploaderID == p.User.ID {
		return nil
	}
	allowed, err := f.deps.Permitted(ctx, p, "system:file:list")
	if err != nil {
		return kernel.Fail(503, "database_unavailable", "授权服务不可用")
	}
	if !allowed {
		return kernel.Fail(403, "forbidden", "没有文件访问权限")
	}
	return nil
}

func (f *Service) UploadLimit(ctx context.Context) (int64, error) {
	settings, _, err := f.deps.LoadFileSettings(ctx)
	if err != nil {
		return 0, kernel.Fail(503, "settings_unavailable", "读取上传策略失败")
	}
	limit := maxSingleUploadBytes
	if settings.UploadMaxSizeMb > 0 && int64(settings.UploadMaxSizeMb)*kernel.Mib < limit {
		limit = int64(settings.UploadMaxSizeMb) * kernel.Mib
	}
	return limit, nil
}
func (f *Service) ExportFileConfigsCSV(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	q := f.Store.Client.FileStorageConfig.Query()
	if status := inArgs.Filter.Get("status"); status != "" {
		q = q.Where(filestorageconfig.StatusEQ(status))
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startTime", false}, {"endTime", true}} {
		if raw := inArgs.Filter.Get(bound.key); raw != "" {
			value, err := validation.DateBound(raw, bound.end)
			if err != nil {
				return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
			}
			if bound.end {
				q = q.Where(filestorageconfig.UpdatedAtLTE(value))
			} else {
				q = q.Where(filestorageconfig.UpdatedAtGTE(value))
			}
		}
	}
	q.Order(ent.Desc(filestorageconfig.FieldID))
	return kernel.CSV("file-storage-configs.csv", []string{"名称", "类型", "状态", "默认", "备注"}, func(offset int) ([][]string, error) {
		rows, err := q.Clone().Offset(offset).Limit(200).All(ctx)
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(rows))
		for _, row := range rows {
			remark := ""
			if row.Remark != nil {
				remark = *row.Remark
			}
			result = append(result, []string{row.Name, row.Provider, row.Status, strings.ToUpper(boolString(row.IsDefault)), remark})
		}
		return result, nil
	})
}
func boolString(value bool) string {
	if value {
		return "true"
	}
	return "false"
}
