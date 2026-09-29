package zenith

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/filestorageconfig"
	"github.com/fudanda/zenith-admin/backend/ent/managedfile"
	"github.com/fudanda/zenith-admin/backend/ent/uploadsession"
	"github.com/gorilla/mux"
)

func storageConfigView(row *ent.FileStorageConfig) map[string]any {
	return map[string]any{
		"id": row.ID, "name": row.Name, "provider": "local", "status": row.Status, "isDefault": row.IsDefault, "basePath": nil, "objectAcl": "default",
		"urlStrategy": "proxy", "publicBaseUrl": nil, "presignedExpirySeconds": 3600, "localRootPath": row.LocalRootPath, "remark": row.Remark,
		"createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt,
	}
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
	if !filepath.IsAbs(in.LocalRootPath) || len(in.LocalRootPath) > 512 {
		return errors.New("存储目录必须是绝对路径")
	}
	if in.Remark != nil && len([]rune(*in.Remark)) > 256 {
		return errors.New("备注过长")
	}
	return nil
}

func (f *Framework) listFileConfigs(w http.ResponseWriter, r *http.Request) {
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
	query := f.Store.Client.FileStorageConfig.Query()
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			fail(w, 400, "invalid_status", "状态无效")
			return
		}
		query = query.Where(filestorageconfig.StatusEQ(status))
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Desc(filestorageconfig.FieldID)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, storageConfigView(row))
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) defaultFileConfig(w http.ResponseWriter, r *http.Request) {
	row, err := f.Store.Client.FileStorageConfig.Query().Where(filestorageconfig.IsDefault(true), filestorageconfig.StatusEQ("enabled")).Only(r.Context())
	if ent.IsNotFound(err) {
		respond(w, 200, nil)
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, storageConfigView(row))
}

func (f *Framework) getFileConfig(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	row, err := f.Store.Client.FileStorageConfig.Get(r.Context(), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "存储配置不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, storageConfigView(row))
}

func (f *Framework) saveFileConfig(w http.ResponseWriter, r *http.Request) {
	id := 0
	if r.Method == http.MethodPut {
		var err error
		id, err = intParam(mux.Vars(r)["id"])
		if err != nil {
			fail(w, 400, "invalid_id", err.Error())
			return
		}
	}
	in := storageConfigInput{Provider: "local", Status: "enabled"}
	if id != 0 {
		current, err := f.Store.Client.FileStorageConfig.Get(r.Context(), id)
		if ent.IsNotFound(err) {
			fail(w, 404, "not_found", "存储配置不存在")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		in = storageConfigInput{Name: current.Name, Provider: current.Provider, Status: current.Status, IsDefault: current.IsDefault, LocalRootPath: current.LocalRootPath, Remark: current.Remark}
	}
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil || len(patch) == 0 {
		fail(w, 400, "invalid_request", "配置内容无效")
		return
	}
	for key, raw := range patch {
		var err error
		switch key {
		case "name":
			err = json.Unmarshal(raw, &in.Name)
		case "provider":
			err = json.Unmarshal(raw, &in.Provider)
		case "status":
			err = json.Unmarshal(raw, &in.Status)
		case "isDefault":
			err = json.Unmarshal(raw, &in.IsDefault)
		case "localRootPath":
			err = json.Unmarshal(raw, &in.LocalRootPath)
		case "remark":
			err = json.Unmarshal(raw, &in.Remark)
		case "urlStrategy":
			var value string
			err = json.Unmarshal(raw, &value)
			if err == nil && value != "proxy" {
				fail(w, 400, "unsupported_strategy", "本地存储首版仅支持代理访问")
				return
			}
		case "objectAcl":
			var value string
			err = json.Unmarshal(raw, &value)
			if err == nil && value != "default" {
				fail(w, 400, "unsupported_acl", "本地存储不支持对象 ACL")
				return
			}
		case "presignedExpirySeconds":
			var value int
			err = json.Unmarshal(raw, &value)
			if err == nil && value != 3600 {
				fail(w, 400, "unsupported_option", "本地存储固定使用代理访问")
				return
			}
		case "basePath", "publicBaseUrl":
			if string(raw) != "null" && string(raw) != "\"\"" {
				fail(w, 400, "unsupported_option", "首版不支持此存储选项")
				return
			}
		default:
			fail(w, 400, "invalid_request", "不支持的存储字段")
			return
		}
		if err != nil {
			fail(w, 400, "invalid_request", "字段格式无效")
			return
		}
	}
	if err := validateStorageConfig(in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	in.LocalRootPath = filepath.Clean(in.LocalRootPath)
	if err := os.MkdirAll(in.LocalRootPath, 0700); err != nil {
		fail(w, 400, "storage_unavailable", "存储目录不可用")
		return
	}
	p := fromContext(r.Context())
	var saved *ent.FileStorageConfig
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		if in.IsDefault {
			if _, err = tx.FileStorageConfig.Update().Where(filestorageconfig.IsDefault(true)).SetIsDefault(false).Save(r.Context()); err != nil {
				return err
			}
		}
		if id == 0 {
			create := tx.FileStorageConfig.Create().SetName(in.Name).SetProvider("local").SetStatus(in.Status).SetIsDefault(in.IsDefault).SetLocalRootPath(in.LocalRootPath)
			if in.Remark != nil {
				create.SetRemark(*in.Remark)
			}
			saved, err = create.Save(r.Context())
		} else {
			update := tx.FileStorageConfig.UpdateOneID(id).SetName(in.Name).SetProvider("local").SetStatus(in.Status).SetIsDefault(in.IsDefault).SetLocalRootPath(in.LocalRootPath)
			if in.Remark == nil {
				update.ClearRemark()
			} else {
				update.SetRemark(*in.Remark)
			}
			saved, err = update.Save(r.Context())
		}
		if err != nil {
			return err
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("file_storage_configs").SetResourceID(saved.ID).Exec(r.Context())
	})
	if err != nil {
		fail(w, 409, "storage_conflict", err.Error())
		return
	}
	respond(w, 200, storageConfigView(saved))
}

func (f *Framework) setDefaultFileConfig(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	var saved *ent.FileStorageConfig
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		row, err := tx.FileStorageConfig.Get(r.Context(), id)
		if err != nil {
			return err
		}
		if row.Status != "enabled" {
			return errors.New("停用配置不能设为默认")
		}
		if _, err = tx.FileStorageConfig.Update().Where(filestorageconfig.IsDefault(true)).SetIsDefault(false).Save(r.Context()); err != nil {
			return err
		}
		saved, err = tx.FileStorageConfig.UpdateOneID(id).SetIsDefault(true).Save(r.Context())
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("set_default").SetResource("file_storage_configs").SetResourceID(id).Exec(r.Context())
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "存储配置不存在")
		return
	}
	if err != nil {
		fail(w, 409, "storage_conflict", err.Error())
		return
	}
	respond(w, 200, storageConfigView(saved))
}

func (f *Framework) deleteFileConfig(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	count, err := f.Store.Client.ManagedFile.Query().Where(managedfile.StorageConfigIDEQ(id)).Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	active, err := f.Store.Client.UploadSession.Query().Where(uploadsession.StorageConfigIDEQ(id), uploadsession.StatusEQ("uploading")).Exist(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	if count > 0 || active {
		fail(w, 409, "storage_in_use", "存储配置仍有文件或上传任务")
		return
	}
	p := fromContext(r.Context())
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.FileStorageConfig.DeleteOneID(id).Exec(r.Context()); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("delete").SetResource("file_storage_configs").SetResourceID(id).Exec(r.Context())
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "存储配置不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "删除失败")
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) testFileConfig(w http.ResponseWriter, r *http.Request) {
	var in struct{ Provider, LocalRootPath string }
	if err := decode(r, &in); err != nil || in.Provider != "local" || !filepath.IsAbs(in.LocalRootPath) {
		fail(w, 400, "invalid_request", "需要本地绝对目录")
		return
	}
	if err := checkWritableDirectory(in.LocalRootPath); err != nil {
		fail(w, 400, "storage_unavailable", "存储目录不可写")
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
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
