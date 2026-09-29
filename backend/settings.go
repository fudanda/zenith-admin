package zenith

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/systemsetting"
)

const mib int64 = 1 << 20

// These defaults mirror packages/shared/src/settings/modules/files.ts. Only
// the three upload-size fields are editable until MIME inspection is migrated.
var defaultUploadTypes = []string{
	"image/*", "video/*", "audio/*", "application/pdf", "text/plain", "text/csv", "text/vtt",
	"application/zip", "application/x-zip-compressed",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.ms-excel", "application/msword", "application/vnd.ms-powerpoint",
}

type fileSettings struct {
	UploadValidateType bool     `json:"uploadValidateType"`
	UploadAllowedTypes []string `json:"uploadAllowedTypes"`
	UploadMaxSizeMb    int      `json:"uploadMaxSizeMb"`
	ChunkThresholdMb   int      `json:"chunkThresholdMb"`
	ChunkSizeMb        int      `json:"chunkSizeMb"`
}

func defaultFileSettings() fileSettings {
	return fileSettings{UploadValidateType: true, UploadAllowedTypes: slices.Clone(defaultUploadTypes), ChunkThresholdMb: 5, ChunkSizeMb: 5}
}

func (f *Framework) loadFileSettings(ctx context.Context) (fileSettings, *ent.SystemSetting, error) {
	settings := defaultFileSettings()
	row, err := f.Store.Client.SystemSetting.Query().Where(systemsetting.ModuleEQ("files")).Only(ctx)
	if ent.IsNotFound(err) {
		return settings, nil, nil
	}
	if err != nil {
		return settings, nil, err
	}
	max, okMax := row.Data["uploadMaxSizeMb"].(float64)
	threshold, okThreshold := row.Data["chunkThresholdMb"].(float64)
	chunk, okChunk := row.Data["chunkSizeMb"].(float64)
	if !okMax || !okThreshold || !okChunk {
		return settings, nil, errors.New("stored file settings are invalid")
	}
	settings.UploadMaxSizeMb = int(max)
	settings.ChunkThresholdMb = int(threshold)
	settings.ChunkSizeMb = int(chunk)
	return settings, row, nil
}

func fileSettingsEnvelope(settings fileSettings, row *ent.SystemSetting) map[string]any {
	version := 0
	var updatedAt *time.Time
	paths := []string{}
	if row != nil {
		version = row.Version
		updatedAt = &row.UpdatedAt
		defaults := defaultFileSettings()
		if settings.UploadMaxSizeMb != defaults.UploadMaxSizeMb {
			paths = append(paths, "uploadMaxSizeMb")
		}
		if settings.ChunkThresholdMb != defaults.ChunkThresholdMb {
			paths = append(paths, "chunkThresholdMb")
		}
		if settings.ChunkSizeMb != defaults.ChunkSizeMb {
			paths = append(paths, "chunkSizeMb")
		}
	}
	return map[string]any{"module": "files", "scope": "platform", "tenantId": nil, "version": version,
		"effective": settings, "inherited": defaultFileSettings(), "overriddenPaths": paths, "updatedAt": updatedAt}
}

func (f *Framework) getFileSettings(w http.ResponseWriter, r *http.Request) {
	settings, row, err := f.loadFileSettings(r.Context())
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取设置失败")
		return
	}
	respond(w, 200, fileSettingsEnvelope(settings, row))
}

func (f *Framework) listSettings(w http.ResponseWriter, r *http.Request) {
	settings, row, err := f.loadFileSettings(r.Context())
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取设置失败")
		return
	}
	version := 0
	var updatedAt *time.Time
	if row != nil {
		version, updatedAt = row.Version, &row.UpdatedAt
	}
	paths := fileSettingsEnvelope(settings, row)["overriddenPaths"].([]string)
	respond(w, 200, []map[string]any{{"module": "files", "path": "/files", "title": "文件上传", "description": "上传大小与分片策略", "scope": "platform", "feature": nil, "page": "/system/settings/files", "canWrite": fromContext(r.Context()).SuperAdmin, "version": version, "overriddenCount": len(paths), "updatedAt": updatedAt}})
}

func (f *Framework) fileUploadPolicy(w http.ResponseWriter, r *http.Request) {
	settings, _, err := f.loadFileSettings(r.Context())
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取上传策略失败")
		return
	}
	respond(w, 200, map[string]int{"uploadMaxSizeMb": settings.UploadMaxSizeMb, "chunkThresholdMb": settings.ChunkThresholdMb, "chunkSizeMb": settings.ChunkSizeMb})
}

var errSettingsConflict = errors.New("settings version conflict")

func (f *Framework) updateFileSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version int `json:"version"`
		Data    struct {
			UploadValidateType *bool     `json:"uploadValidateType"`
			UploadAllowedTypes *[]string `json:"uploadAllowedTypes"`
			UploadMaxSizeMb    *int      `json:"uploadMaxSizeMb"`
			ChunkThresholdMb   *int      `json:"chunkThresholdMb"`
			ChunkSizeMb        *int      `json:"chunkSizeMb"`
		} `json:"data"`
	}
	if err := decode(r, &in); err != nil || in.Version < 0 || in.Data.UploadValidateType == nil || in.Data.UploadAllowedTypes == nil || in.Data.UploadMaxSizeMb == nil || in.Data.ChunkThresholdMb == nil || in.Data.ChunkSizeMb == nil {
		fail(w, 400, "invalid_settings", "设置参数无效")
		return
	}
	if !*in.Data.UploadValidateType || !slices.Equal(*in.Data.UploadAllowedTypes, defaultUploadTypes) || *in.Data.UploadMaxSizeMb < 0 || *in.Data.UploadMaxSizeMb > 102400 || *in.Data.ChunkThresholdMb < 1 || *in.Data.ChunkThresholdMb > 32 || *in.Data.ChunkSizeMb < 5 || *in.Data.ChunkSizeMb > 32 {
		fail(w, 400, "unsupported_settings", "设置值无效或尚未支持")
		return
	}
	data := map[string]any{"uploadMaxSizeMb": *in.Data.UploadMaxSizeMb, "chunkThresholdMb": *in.Data.ChunkThresholdMb, "chunkSizeMb": *in.Data.ChunkSizeMb}
	p := fromContext(r.Context())
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if in.Version == 0 {
			if err := tx.SystemSetting.Create().SetModule("files").SetVersion(1).SetData(data).Exec(r.Context()); err != nil {
				if ent.IsConstraintError(err) {
					return errSettingsConflict
				}
				return err
			}
		} else {
			changed, err := tx.SystemSetting.Update().Where(systemsetting.ModuleEQ("files"), systemsetting.VersionEQ(in.Version)).SetVersion(in.Version + 1).SetData(data).Save(r.Context())
			if err != nil {
				return err
			}
			if changed != 1 {
				return errSettingsConflict
			}
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetOperation("settings_update").SetResource("files").SetRequestID(requestID(r)).Exec(r.Context())
	})
	if errors.Is(err, errSettingsConflict) {
		fail(w, 409, "version_conflict", "设置已被修改，请刷新后重试")
		return
	}
	if err != nil {
		fail(w, 503, "settings_unavailable", "保存设置失败")
		return
	}
	f.getFileSettings(w, r)
}
