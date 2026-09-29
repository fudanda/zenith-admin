package zenith

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"sort"
	"strconv"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/uploadchunk"
	"github.com/fudanda/zenith-admin/backend/ent/uploadsession"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

const minChunkBytes int64 = 5 << 20
const maxChunkBytes int64 = 32 << 20
const maxChunks int64 = 10000

func uploadScope(p *principal) predicate.UploadSession {
	if p.TenantID == nil {
		return uploadsession.TenantIDIsNil()
	}
	return uploadsession.TenantIDEQ(*p.TenantID)
}

func (f *Framework) ownedUpload(ctx context.Context, p *principal, id string) (*ent.UploadSession, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, &ent.NotFoundError{}
	}
	return f.Store.Client.UploadSession.Query().Where(uploadsession.IDEQ(id), uploadsession.UploaderIDEQ(p.User.ID), uploadScope(p)).Only(ctx)
}

func uploadPartsKey(id string) (string, error) {
	if _, err := uuid.Parse(id); err != nil {
		return "", err
	}
	return path.Join(".chunks", id), nil
}

func (f *Framework) uploadInit(w http.ResponseWriter, r *http.Request) {
	var in struct {
		FileName   string `json:"fileName"`
		FileSize   int64  `json:"fileSize"`
		MimeType   string `json:"mimeType"`
		ChunkSize  int64  `json:"chunkSize"`
		Visibility string `json:"visibility"`
	}
	if err := decode(r, &in); err != nil || in.FileName == "" || len([]rune(in.FileName)) > 256 || in.FileSize < 0 || in.ChunkSize < minChunkBytes || in.ChunkSize > maxChunkBytes || len(in.MimeType) > 128 || (in.Visibility != "" && in.Visibility != "public" && in.Visibility != "restricted") {
		fail(w, 400, "invalid_upload", "分片上传参数无效")
		return
	}
	if in.Visibility == "" {
		in.Visibility = "public"
	}
	settings, _, err := f.loadFileSettings(r.Context())
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取上传策略失败")
		return
	}
	if settings.UploadMaxSizeMb > 0 && in.FileSize > int64(settings.UploadMaxSizeMb)*mib {
		fail(w, 400, "file_too_large", "文件超过上传大小限制")
		return
	}
	if baseline := int64(settings.ChunkSizeMb) * mib; in.ChunkSize < baseline {
		in.ChunkSize = baseline
	}
	total := (in.FileSize + in.ChunkSize - 1) / in.ChunkSize
	if total == 0 {
		total = 1
	}
	if total > maxChunks {
		fail(w, 400, "too_many_chunks", "分片数超过上限")
		return
	}
	storage, err := f.defaultStorage(r.Context())
	if err != nil {
		fail(w, 409, "storage_unavailable", "请先配置默认本地存储")
		return
	}
	id := uuid.NewString()
	p := fromContext(r.Context())
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		create := tx.UploadSession.Create().SetID(id).SetStorageConfigID(storage.ID).SetUploaderID(p.User.ID).SetFileName(cleanFileName(in.FileName)).SetFileSize(in.FileSize).SetChunkSize(in.ChunkSize).SetTotalChunks(int(total)).SetVisibility(in.Visibility).SetExpiresAt(time.Now().Add(24 * time.Hour))
		if in.MimeType != "" {
			create.SetMimeType(in.MimeType)
		}
		if p.TenantID != nil {
			create.SetTenantID(*p.TenantID)
		}
		if err := create.Exec(r.Context()); err != nil {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetOperation("upload_init").SetResource("upload_sessions").SetRequestID(requestID(r))
		if p.TenantID != nil {
			audit.SetTenantID(*p.TenantID)
		}
		return audit.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "无法初始化上传")
		return
	}
	respond(w, 200, map[string]any{"uploadId": id, "chunkSize": in.ChunkSize, "totalChunks": total, "received": []int{}})
}

func (f *Framework) uploadChunk(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxChunkBytes+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		fail(w, 400, "invalid_multipart", "分片内容无效")
		return
	}
	defer r.MultipartForm.RemoveAll()
	id := r.FormValue("uploadId")
	index, err := strconv.Atoi(r.FormValue("index"))
	if err != nil {
		fail(w, 400, "invalid_index", "分片序号无效")
		return
	}
	p := fromContext(r.Context())
	session, err := f.ownedUpload(r.Context(), p, id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "上传会话不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if session.Status != "uploading" || session.ExpiresAt.Before(time.Now()) || index < 0 || index >= session.TotalChunks {
		fail(w, 409, "invalid_session", "上传会话不可接收分片")
		return
	}
	storage, err := f.Store.Client.FileStorageConfig.Get(r.Context(), session.StorageConfigID)
	if err != nil {
		fail(w, 503, "storage_unavailable", "存储不可用")
		return
	}
	key, err := uploadPartsKey(id)
	if err != nil {
		fail(w, 400, "invalid_upload", "上传会话无效")
		return
	}
	root, err := os.OpenRoot(storage.LocalRootPath)
	if err != nil {
		fail(w, 503, "storage_unavailable", "存储不可用")
		return
	}
	defer root.Close()
	if err := root.MkdirAll(key, 0700); err != nil {
		fail(w, 503, "storage_unavailable", "分片目录不可用")
		return
	}
	dir, err := root.OpenRoot(key)
	if err != nil {
		fail(w, 503, "storage_unavailable", "分片目录不可用")
		return
	}
	defer dir.Close()
	file, _, err := r.FormFile("chunk")
	if err != nil {
		fail(w, 400, "missing_chunk", "缺少分片内容")
		return
	}
	defer file.Close()
	tempKey := ".part-" + uuid.NewString()
	temp, err := dir.OpenFile(tempKey, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		fail(w, 503, "storage_unavailable", "无法写入分片")
		return
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
		fail(w, 400, "invalid_chunk_size", "分片大小与上传会话不一致")
		return
	}
	checksum := hex.EncodeToString(hash.Sum(nil))
	final := strconv.Itoa(index)
	linkErr := dir.Link(tempKey, final)
	if linkErr != nil && !errors.Is(linkErr, os.ErrExist) {
		fail(w, 503, "storage_unavailable", "分片保存失败")
		return
	}
	linked := linkErr == nil
	if _, err := dir.Stat(final); err == nil {
		checksumOnDisk, hashErr := hashFile(dir, final)
		if hashErr != nil || checksumOnDisk != checksum {
			fail(w, 409, "chunk_conflict", "该序号分片内容不一致")
			return
		}
	}
	row, err := f.Store.Client.UploadChunk.Query().Where(uploadchunk.UploadIDEQ(id), uploadchunk.ChunkIndexEQ(index)).Only(r.Context())
	if ent.IsNotFound(err) {
		err = f.Store.Client.UploadChunk.Create().SetUploadID(id).SetChunkIndex(index).SetSize(size).SetHash(checksum).Exec(r.Context())
		if ent.IsConstraintError(err) {
			row, err = f.Store.Client.UploadChunk.Query().Where(uploadchunk.UploadIDEQ(id), uploadchunk.ChunkIndexEQ(index)).Only(r.Context())
			if err == nil && row.Hash != checksum {
				fail(w, 409, "chunk_conflict", "该序号分片内容不一致")
				return
			}
		}
	} else if err == nil && row.Hash != checksum {
		fail(w, 409, "chunk_conflict", "该序号分片内容不一致")
		return
	}
	if err != nil {
		if linked {
			_ = dir.Remove(final)
		}
		fail(w, 503, "database_unavailable", "分片记录失败")
		return
	}
	count, err := f.Store.Client.UploadChunk.Query().Where(uploadchunk.UploadIDEQ(id)).Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, map[string]any{"index": index, "receivedCount": count})
}

func hashFile(root *os.Root, name string) (string, error) {
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

func (f *Framework) uploadStatus(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["uploadId"]
	session, err := f.ownedUpload(r.Context(), fromContext(r.Context()), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "上传会话不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	chunks, err := f.Store.Client.UploadChunk.Query().Where(uploadchunk.UploadIDEQ(id)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	received := make([]int, 0, len(chunks))
	for _, chunk := range chunks {
		received = append(received, chunk.ChunkIndex)
	}
	sort.Ints(received)
	respond(w, 200, map[string]any{"uploadId": id, "status": session.Status, "chunkSize": session.ChunkSize, "totalChunks": session.TotalChunks, "received": received})
}

func (f *Framework) uploadComplete(w http.ResponseWriter, r *http.Request) {
	var in struct {
		UploadID string `json:"uploadId"`
	}
	if err := decode(r, &in); err != nil {
		fail(w, 400, "invalid_request", "上传会话无效")
		return
	}
	p := fromContext(r.Context())
	session, err := f.ownedUpload(r.Context(), p, in.UploadID)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "上传会话不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if session.Status != "uploading" || session.ExpiresAt.Before(time.Now()) {
		fail(w, 409, "invalid_session", "上传会话不可合并")
		return
	}
	settings, _, err := f.loadFileSettings(r.Context())
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取上传策略失败")
		return
	}
	if settings.UploadMaxSizeMb > 0 && session.FileSize > int64(settings.UploadMaxSizeMb)*mib {
		fail(w, 400, "file_too_large", "文件超过上传大小限制")
		return
	}
	chunks, err := f.Store.Client.UploadChunk.Query().Where(uploadchunk.UploadIDEQ(in.UploadID)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if len(chunks) != session.TotalChunks {
		fail(w, 409, "incomplete_upload", "仍有分片未上传")
		return
	}
	seen := make([]bool, session.TotalChunks)
	byIndex := make(map[int]*ent.UploadChunk, len(chunks))
	for _, chunk := range chunks {
		if chunk.ChunkIndex < 0 || chunk.ChunkIndex >= len(seen) || seen[chunk.ChunkIndex] {
			fail(w, 409, "invalid_chunks", "分片记录无效")
			return
		}
		seen[chunk.ChunkIndex] = true
		byIndex[chunk.ChunkIndex] = chunk
	}
	claimed, err := f.Store.Client.UploadSession.Update().Where(uploadsession.IDEQ(in.UploadID), uploadsession.StatusEQ("uploading")).SetStatus("completing").Save(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "无法抢占合并权")
		return
	}
	if claimed != 1 {
		fail(w, 409, "upload_in_progress", "上传正在合并")
		return
	}
	completed := false
	defer func() {
		if !completed {
			_, _ = f.Store.Client.UploadSession.Update().Where(uploadsession.IDEQ(in.UploadID), uploadsession.StatusEQ("completing")).SetStatus("uploading").Save(context.Background())
		}
	}()
	storage, err := f.Store.Client.FileStorageConfig.Get(r.Context(), session.StorageConfigID)
	if err != nil {
		fail(w, 503, "storage_unavailable", "存储不可用")
		return
	}
	key, err := uploadPartsKey(in.UploadID)
	if err != nil {
		fail(w, 500, "invalid_storage_key", "分片路径无效")
		return
	}
	root, err := os.OpenRoot(storage.LocalRootPath)
	if err != nil {
		fail(w, 503, "storage_unavailable", "存储不可用")
		return
	}
	defer root.Close()
	dir, err := root.OpenRoot(key)
	if err != nil {
		fail(w, 503, "storage_unavailable", "分片目录不可用")
		return
	}
	defer dir.Close()
	if err := root.MkdirAll(".tmp", 0700); err != nil {
		fail(w, 503, "storage_unavailable", "临时目录不可用")
		return
	}
	mergedKey := ".tmp/merge-" + uuid.NewString()
	merged, err := root.OpenFile(mergedKey, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		fail(w, 503, "storage_unavailable", "无法合并分片")
		return
	}
	defer root.Remove(mergedKey)
	for index := 0; index < session.TotalChunks; index++ {
		part, openErr := dir.Open(strconv.Itoa(index))
		if openErr != nil {
			merged.Close()
			fail(w, 503, "storage_unavailable", "分片内容缺失")
			return
		}
		partHash := sha256.New()
		partSize, copyErr := io.Copy(io.MultiWriter(merged, partHash), part)
		part.Close()
		if copyErr != nil || partSize != byIndex[index].Size || hex.EncodeToString(partHash.Sum(nil)) != byIndex[index].Hash {
			merged.Close()
			fail(w, 503, "storage_unavailable", "分片校验失败")
			return
		}
	}
	if _, err := merged.Seek(0, io.SeekStart); err != nil {
		merged.Close()
		fail(w, 503, "storage_unavailable", "分片合并失败")
		return
	}
	view, err := f.persistFileWithLimit(r.Context(), p, merged, session.FileName, session.Visibility, requestID(r), session.FileSize, session.FileSize, storage, func(tx *ent.Tx) error {
		return tx.UploadSession.UpdateOneID(in.UploadID).SetStatus("completed").Exec(r.Context())
	})
	merged.Close()
	if err != nil {
		fail(w, 503, "upload_failed", err.Error())
		return
	}
	completed = true
	if err := root.RemoveAll(key); err != nil { /* Maintenance removes expired chunk directories. */
	}
	respond(w, 200, view)
}

func (f *Framework) uploadAbort(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["uploadId"]
	session, err := f.ownedUpload(r.Context(), fromContext(r.Context()), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "上传会话不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if session.Status == "completing" || session.Status == "completed" {
		fail(w, 409, "upload_in_progress", "上传已进入合并阶段")
		return
	}
	changed := 0
	p := fromContext(r.Context())
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		changed, err = tx.UploadSession.Update().Where(uploadsession.IDEQ(id), uploadsession.StatusEQ("uploading")).SetStatus("aborted").Save(r.Context())
		if err != nil || changed == 0 {
			return err
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetOperation("upload_abort").SetResource("upload_sessions").SetRequestID(requestID(r))
		if p.TenantID != nil {
			audit.SetTenantID(*p.TenantID)
		}
		return audit.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "无法取消上传")
		return
	}
	if changed == 0 && session.Status != "aborted" {
		fail(w, 409, "upload_in_progress", "上传状态已经改变")
		return
	}
	if _, err := f.Store.Client.UploadChunk.Delete().Where(uploadchunk.UploadIDEQ(id)).Exec(r.Context()); err != nil {
		fail(w, 503, "database_unavailable", "分片清理失败")
		return
	}
	storage, err := f.Store.Client.FileStorageConfig.Get(r.Context(), session.StorageConfigID)
	if err == nil {
		if key, pathErr := uploadPartsKey(id); pathErr == nil {
			if root, openErr := os.OpenRoot(storage.LocalRootPath); openErr == nil {
				_ = root.RemoveAll(key)
				root.Close()
			}
		}
	}
	respond(w, 200, nil)
}

func (f *Framework) cleanupExpiredUploads(ctx context.Context) error {
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
		root, err := os.OpenRoot(storage.LocalRootPath)
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
		root, err := os.OpenRoot(config.LocalRootPath)
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
