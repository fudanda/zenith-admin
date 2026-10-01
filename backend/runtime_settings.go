package zenith

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"sort"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/systemsetting"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
)

func copyDocument(value map[string]any) map[string]any {
	raw, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	return result
}
func (f *Framework) loadSetting(ctx context.Context, module string) (map[string]any, *ent.SystemSetting, error) {
	return f.Store.loadSetting(ctx, module)
}

func (s *Store) loadSetting(ctx context.Context, module string) (map[string]any, *ent.SystemSetting, error) {
	def, ok := contracts.Settings[module]
	if !ok {
		return nil, nil, errors.New("设置模块不存在")
	}
	value := copyDocument(def.Defaults)
	row, err := s.Client.SystemSetting.Query().Where(systemsetting.ModuleEQ(module)).Only(ctx)
	if ent.IsNotFound(err) {
		return value, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	for key, item := range row.Data {
		if _, supported := value[key]; supported {
			value[key] = item
		}
	}
	return value, row, nil
}
func overriddenPaths(value, defaults map[string]any, prefix string) []string {
	result := []string{}
	for key, item := range value {
		path := key
		if prefix != "" {
			path = prefix + "." + key
		}
		left, nested := item.(map[string]any)
		right, other := defaults[key].(map[string]any)
		if nested && other {
			result = append(result, overriddenPaths(left, right, path)...)
		} else if !reflect.DeepEqual(item, defaults[key]) {
			result = append(result, path)
		}
	}
	sort.Strings(result)
	return result
}
func settingEnvelope(module string, value map[string]any, row *ent.SystemSetting) map[string]any {
	version := 0
	var updatedAt any
	if row != nil {
		version = row.Version
		updatedAt = row.UpdatedAt
	}
	return map[string]any{"module": module, "scope": "platform", "version": version, "effective": value, "inherited": contracts.Settings[module].Defaults, "overriddenPaths": overriddenPaths(value, contracts.Settings[module].Defaults, ""), "updatedAt": updatedAt}
}
func (f *Framework) getRuntimeSetting(w http.ResponseWriter, r *http.Request) {
	module := settingModule(r.URL.Path)
	value, row, err := f.loadSetting(r.Context(), module)
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取设置失败")
		return
	}
	respond(w, 200, settingEnvelope(module, value, row))
}
func settingModule(path string) string {
	slug := strings.TrimPrefix(path, "/api/v1/settings/")
	for key, def := range contracts.Settings {
		if strings.TrimPrefix(def.Path, "/") == slug {
			return key
		}
	}
	return ""
}
func (f *Framework) runtimeSettingsList(w http.ResponseWriter, r *http.Request) {
	p := fromContext(r.Context())
	list := make([]map[string]any, 0)
	for _, module := range []string{"auth", "identitySecurity", "ui", "files"} {
		def := contracts.Settings[module]
		read, err := f.permitted(r.Context(), p, def.ReadPermission)
		if err != nil {
			fail(w, 503, "settings_unavailable", "设置权限查询失败")
			return
		}
		if !read {
			continue
		}
		write, err := f.permitted(r.Context(), p, def.WritePermission)
		if err != nil {
			fail(w, 503, "settings_unavailable", "设置权限查询失败")
			return
		}
		value, row, err := f.loadSetting(r.Context(), module)
		if err != nil {
			fail(w, 503, "settings_unavailable", "读取设置失败")
			return
		}
		envelope := settingEnvelope(module, value, row)
		list = append(list, map[string]any{"module": module, "path": def.Path, "title": def.Title, "description": def.Description, "scope": "platform", "feature": nil, "page": def.Page, "canWrite": write, "version": envelope["version"], "overriddenCount": len(envelope["overriddenPaths"].([]string)), "updatedAt": envelope["updatedAt"]})
	}
	respond(w, 200, list)
}
func (f *Framework) updateRuntimeSetting(w http.ResponseWriter, r *http.Request) {
	module := settingModule(r.URL.Path)
	var in struct {
		Version *int           `json:"version"`
		Data    map[string]any `json:"data"`
	}
	if err := decode(r, &in); err != nil || in.Version == nil || *in.Version < 0 || in.Data == nil || contracts.ValidateSetting(module, in.Data) != nil {
		fail(w, 400, "invalid_settings", "设置参数无效")
		return
	}
	if module == "ui" {
		policy := in.Data["preferences"].(map[string]any)
		defaults := policy["defaults"].(map[string]any)
		allowed := policy["allowUserOverride"].(map[string]any)
		for _, key := range []string{"showQuickChat", "enableLockScreen", "notificationSound", "desktopNotification"} {
			if defaults[key] == true || allowed[key] == true {
				fail(w, 400, "unsupported_settings", "未迁移功能不能开启")
				return
			}
		}
	}
	p := fromContext(r.Context())
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if *in.Version == 0 {
			if err := tx.SystemSetting.Create().SetModule(module).SetVersion(1).SetData(in.Data).Exec(r.Context()); err != nil {
				if ent.IsConstraintError(err) {
					return errSettingsConflict
				}
				return err
			}
		} else {
			count, err := tx.SystemSetting.Update().Where(systemsetting.ModuleEQ(module), systemsetting.VersionEQ(*in.Version)).SetVersion(*in.Version + 1).SetData(in.Data).Save(r.Context())
			if err != nil {
				return err
			}
			if count != 1 {
				return errSettingsConflict
			}
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("settings_update").SetResource(module).Exec(r.Context())
	})
	if errors.Is(err, errSettingsConflict) {
		fail(w, 409, "version_conflict", "设置已被修改，请刷新后重试")
		return
	}
	if err != nil {
		fail(w, 503, "settings_unavailable", "保存设置失败")
		return
	}
	f.getRuntimeSetting(w, r)
}
func (f *Framework) settingsProjection(w http.ResponseWriter, r *http.Request) {
	auth, _, err := f.loadSetting(r.Context(), "auth")
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取设置失败")
		return
	}
	auth["allowRegistration"] = false
	auth["forgotPasswordEnabled"] = false
	security, _, err := f.loadSetting(r.Context(), "identitySecurity")
	if err != nil {
		fail(w, 503, "settings_unavailable", "读取设置失败")
		return
	}
	projection := map[string]any{"auth": auth, "identitySecurity": map[string]any{"password": security["password"]}}
	if strings.HasSuffix(r.URL.Path, "/me") {
		projection["identitySecurity"].(map[string]any)["session"] = security["session"]
		ui, _, err := f.loadSetting(r.Context(), "ui")
		if err != nil {
			fail(w, 503, "settings_unavailable", "读取设置失败")
			return
		}
		ui["quickChatEnabled"] = false
		ui["feedbackEntryEnabled"] = false
		projection["ui"] = ui
		projection["identitySecurity"].(map[string]any)["session"] = security["session"]
		// This closed capability is required by the retained legacy projection.
		projection["identitySecurity"].(map[string]any)["impersonation"] = map[string]any{"enabled": false, "maxMinutes": 30, "allowWrite": false, "notifyTarget": false}
		files, _, err := f.loadSetting(r.Context(), "files")
		if err != nil {
			fail(w, 503, "settings_unavailable", "读取设置失败")
			return
		}
		projection["files"] = map[string]any{"chunkThresholdMb": files["chunkThresholdMb"], "chunkSizeMb": files["chunkSizeMb"]}
	}
	respond(w, 200, projection)
}
