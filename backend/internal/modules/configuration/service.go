package configuration

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/ent/dict"
	"github.com/fudanda/arcbase/backend/ent/dictitem"
	"github.com/fudanda/arcbase/backend/ent/predicate"
	"github.com/fudanda/arcbase/backend/ent/systemsetting"
	"github.com/fudanda/arcbase/backend/internal/contracts"
	"github.com/fudanda/arcbase/backend/internal/data"
	"github.com/fudanda/arcbase/backend/internal/kernel"
	"github.com/fudanda/arcbase/backend/internal/validation"
)

type Dependencies struct {
	Permitted func(ctx context.Context, p *kernel.Principal, permission string) (bool, error)
}

type Service struct {
	Store *data.Store
	deps  Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

func dictItemView(row *ent.DictItem) map[string]any {
	return map[string]any{"id": row.ID, "dictId": row.DictID, "parentId": row.ParentID, "label": row.Label, "value": row.Value,
		"color": row.Color, "sort": row.Sort, "status": row.Status, "remark": row.Remark, "metadata": row.Metadata, "createdBy": row.CreatedBy, "updatedBy": row.UpdatedBy,
		"createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}
}

type dictItemInput struct {
	Label, Value, Status string
	Color, Remark        *string
	ParentID             *int
	Metadata             map[string]any
	Sort                 int
}

func validateDictItem(in dictItemInput) error {
	if len([]rune(strings.TrimSpace(in.Label))) == 0 || len([]rune(in.Label)) > 64 {
		return errors.New("字典项标签无效")
	}
	if len([]rune(strings.TrimSpace(in.Value))) == 0 || len([]rune(in.Value)) > 64 {
		return errors.New("字典项键值无效")
	}
	if in.Color != nil && len(*in.Color) > 32 {
		return errors.New("颜色无效")
	}
	if in.Remark != nil && len([]rune(*in.Remark)) > 256 {
		return errors.New("备注过长")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("状态无效")
	}
	return nil
}

func dictScope(_ *kernel.Principal) predicate.Dict { return dict.IDGT(0) }

func dictView(row *ent.Dict) map[string]any {
	return map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "description": row.Description, "status": row.Status, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}
}

type dictInput struct {
	Name, Code, Status string
	Description        *string
}

func validateDict(in dictInput) error {
	if len([]rune(strings.TrimSpace(in.Name))) == 0 || len([]rune(in.Name)) > 64 {
		return errors.New("字典名称无效")
	}
	if len(in.Code) == 0 || len(in.Code) > 64 || !kernel.RoleCodePattern.MatchString(in.Code) {
		return errors.New("字典编码无效")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("状态无效")
	}
	if in.Description != nil && len([]rune(*in.Description)) > 256 {
		return errors.New("说明过长")
	}
	return nil
}

func copyDocument(value map[string]any) map[string]any {
	raw, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	return result
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

func settingModule(path string) string {
	slug := strings.TrimPrefix(path, "/api/v1/settings/")
	for key, def := range contracts.Settings {
		if strings.TrimPrefix(def.Path, "/") == slug {
			return key
		}
	}
	return ""
}

func fileSettingsEnvelope(settings kernel.FileSettings, row *ent.SystemSetting) map[string]any {
	version := 0
	var updatedAt *time.Time
	paths := []string{}
	if row != nil {
		version = row.Version
		updatedAt = &row.UpdatedAt
		defaults := kernel.DefaultFileSettings()
		if settings.UploadValidateType != defaults.UploadValidateType {
			paths = append(paths, "uploadValidateType")
		}
		if !slices.Equal(settings.UploadAllowedTypes, defaults.UploadAllowedTypes) {
			paths = append(paths, "uploadAllowedTypes")
		}
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
	return map[string]any{"module": "files", "scope": "platform", "version": version,
		"effective": settings, "inherited": kernel.DefaultFileSettings(), "overriddenPaths": paths, "updatedAt": updatedAt}
}

func (f *Service) ListDictItems(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	if _, err = f.ScopedDict(ctx, inArgs, kernel.FromContext(ctx), id); ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "字典不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return f.RespondDictItems(ctx, inArgs, id)
}

func (f *Service) ListDictItemsByCode(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	code := inArgs.Code
	if len(code) == 0 || len(code) > 64 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_code", "字典编码无效")
	}
	row, err := f.Store.Client.Dict.Query().Where(dict.CodeEQ(code), dictScope(kernel.FromContext(ctx)), dict.StatusEQ("enabled")).Only(ctx)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "字典不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return f.RespondDictItems(ctx, inArgs, row.ID)
}

func (f *Service) RespondDictItems(ctx context.Context, inArgs kernel.Input, dictID int) (kernel.Outcome, error) {
	rows, err := f.Store.Client.DictItem.Query().Where(dictitem.DictIDEQ(dictID)).Order(ent.Asc(dictitem.FieldSort), ent.Asc(dictitem.FieldID)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, dictItemView(row))
	}
	return kernel.Success(200, list)
}

func (f *Service) ScopedDictItem(ctx context.Context, inArgs kernel.Input, dictID, itemID int) (*ent.DictItem, error) {
	return f.Store.Client.DictItem.Query().Where(dictitem.IDEQ(itemID), dictitem.DictIDEQ(dictID)).Only(ctx)
}

func (f *Service) GetDictItem(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	dictID, itemID, targetErr := f.DictItemTarget(ctx, inArgs)
	if targetErr != nil {
		return kernel.Outcome{}, targetErr
	}
	row, err := f.ScopedDictItem(ctx, inArgs, dictID, itemID)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "字典项不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, dictItemView(row))
}

func (f *Service) SaveDictItem(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	dictID, itemID, targetErr := f.DictItemTarget(ctx, inArgs)
	if targetErr != nil {
		return kernel.Outcome{}, targetErr
	}
	in := dictItemInput{Status: "enabled"}
	if itemID != 0 {
		current, err := f.ScopedDictItem(ctx, inArgs, dictID, itemID)
		if ent.IsNotFound(err) {
			return kernel.Outcome{}, kernel.Fail(404, "not_found", "字典项不存在")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		in = dictItemInput{Label: current.Label, Value: current.Value, Color: current.Color, Sort: current.Sort, Status: current.Status, ParentID: current.ParentID, Remark: current.Remark, Metadata: current.Metadata}
	}
	var patch map[string]json.RawMessage
	if err := kernel.DecodeBody(inArgs.Body, &patch); err != nil || len(patch) == 0 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "字典项内容无效")
	}
	for key, raw := range patch {
		var err error
		switch key {
		case "label":
			err = json.Unmarshal(raw, &in.Label)
		case "value":
			err = json.Unmarshal(raw, &in.Value)
		case "color":
			err = json.Unmarshal(raw, &in.Color)
		case "remark":
			err = json.Unmarshal(raw, &in.Remark)
		case "parentId":
			err = json.Unmarshal(raw, &in.ParentID)
		case "metadata":
			err = json.Unmarshal(raw, &in.Metadata)
		case "sort":
			err = json.Unmarshal(raw, &in.Sort)
		case "status":
			err = json.Unmarshal(raw, &in.Status)
		default:
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "未知字段")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "字段格式无效")
		}
	}
	if err := validateDictItem(in); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", err.Error())
	}
	if in.ParentID != nil {
		seen := map[int]bool{itemID: true}
		current := in.ParentID
		for current != nil {
			if seen[*current] {
				return kernel.Outcome{}, kernel.Fail(400, "invalid_parent", "字典项父级循环")
			}
			seen[*current] = true
			parent, err := f.ScopedDictItem(ctx, inArgs, dictID, *current)
			if err != nil {
				return kernel.Outcome{}, kernel.Fail(400, "invalid_parent", "父项不在当前字典")
			}
			current = parent.ParentID
		}
	}
	p := kernel.FromContext(ctx)
	var saved *ent.DictItem
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		if itemID == 0 {
			create := tx.DictItem.Create().SetDictID(dictID).SetLabel(in.Label).SetValue(in.Value).SetSort(in.Sort).SetStatus(in.Status).SetCreatedBy(p.User.ID).SetUpdatedBy(p.User.ID)
			if in.Color != nil {
				create.SetColor(*in.Color)
			}
			if in.ParentID != nil {
				create.SetParentID(*in.ParentID)
			}
			if in.Remark != nil {
				create.SetRemark(*in.Remark)
			}
			if in.Metadata != nil {
				create.SetMetadata(in.Metadata)
			}
			saved, err = create.Save(ctx)
		} else {
			update := tx.DictItem.UpdateOneID(itemID).SetLabel(in.Label).SetValue(in.Value).SetSort(in.Sort).SetStatus(in.Status).SetUpdatedBy(p.User.ID)
			if in.Color == nil {
				update.ClearColor()
			} else {
				update.SetColor(*in.Color)
			}
			if in.ParentID != nil {
				update.SetParentID(*in.ParentID)
			} else {
				update.ClearParentID()
			}
			if in.Remark != nil {
				update.SetRemark(*in.Remark)
			} else {
				update.ClearRemark()
			}
			if in.Metadata != nil {
				update.SetMetadata(in.Metadata)
			} else {
				update.ClearMetadata()
			}
			saved, err = update.Save(ctx)
		}
		if err != nil {
			return err
		}
		operation := "create_item"
		if itemID != 0 {
			operation = "update_item"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation(operation).SetResource("dicts").SetResourceID(dictID)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "dict_item_conflict", err.Error())
	}
	return kernel.Success(200, dictItemView(saved))
}

func (f *Service) DeleteDictItem(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	dictID, itemID, targetErr := f.DictItemTarget(ctx, inArgs)
	if targetErr != nil {
		return kernel.Outcome{}, targetErr
	}
	if _, err := f.ScopedDictItem(ctx, inArgs, dictID, itemID); ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "字典项不存在")
	} else if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	p := kernel.FromContext(ctx)
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		children, err := tx.DictItem.Query().Where(dictitem.ParentIDEQ(itemID)).Exist(ctx)
		if err != nil {
			return err
		}
		if children {
			return errors.New("请先删除子项")
		}
		if err := tx.DictItem.DeleteOneID(itemID).Exec(ctx); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("delete_item").SetResource("dicts").SetResourceID(dictID)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "删除失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) ScopedDict(ctx context.Context, inArgs kernel.Input, p *kernel.Principal, id int) (*ent.Dict, error) {
	return f.Store.Client.Dict.Query().Where(dict.IDEQ(id), dictScope(p)).Only(ctx)
}

func (f *Service) ListDicts(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
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
	query, err := f.FilteredDicts(p, q)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	total, err := query.Clone().Count(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	rows, err := query.Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, dictView(row))
	}
	return kernel.Success(200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Service) FilteredDicts(p *kernel.Principal, q kernel.Values) (*ent.DictQuery, error) {
	query := f.Store.Client.Dict.Query().Where(dictScope(p))
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(dict.Or(dict.NameContainsFold(keyword), dict.CodeContainsFold(keyword)))
	}
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			return nil, errors.New("状态无效")
		}
		query = query.Where(dict.StatusEQ(status))
	}
	for _, bound := range []struct {
		key string
		end bool
	}{{"startDate", false}, {"endDate", true}} {
		if raw := q.Get(bound.key); raw != "" {
			value, err := validation.DateBound(raw, bound.end)
			if err != nil {
				return nil, err
			}
			if bound.end {
				query = query.Where(dict.CreatedAtLTE(value))
			} else {
				query = query.Where(dict.CreatedAtGTE(value))
			}
		}
	}
	return query.Order(ent.Desc(dict.FieldID)), nil
}

func (f *Service) ExportDictsCSV(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	query, err := f.FilteredDicts(kernel.FromContext(ctx), inArgs.Filter)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_filter", err.Error())
	}
	return kernel.CSV("dicts.csv", []string{"ID", "字典名称", "字典编码", "描述", "状态", "创建时间"}, func(offset int) ([][]string, error) {
		rows, err := query.Clone().Offset(offset).Limit(200).All(ctx)
		if err != nil {
			return nil, err
		}
		result := make([][]string, 0, len(rows))
		for _, row := range rows {
			description := ""
			if row.Description != nil {
				description = *row.Description
			}
			result = append(result, []string{strconv.Itoa(row.ID), row.Name, row.Code, description, row.Status, row.CreatedAt.Format(time.RFC3339)})
		}
		return result, nil
	})
}

func (f *Service) GetDict(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	row, err := f.ScopedDict(ctx, inArgs, kernel.FromContext(ctx), id)
	if ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "字典不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	return kernel.Success(200, dictView(row))
}

func (f *Service) SaveDict(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id := 0
	if inArgs.Update {
		var err error
		id, err = kernel.IntParam(inArgs.Id)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
		}
	}
	p := kernel.FromContext(ctx)
	in := dictInput{Status: "enabled"}
	if id != 0 {
		current, err := f.ScopedDict(ctx, inArgs, p, id)
		if ent.IsNotFound(err) {
			return kernel.Outcome{}, kernel.Fail(404, "not_found", "字典不存在")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
		}
		in = dictInput{Name: current.Name, Code: current.Code, Status: current.Status, Description: current.Description}
	}
	var patch map[string]json.RawMessage
	if err := kernel.DecodeBody(inArgs.Body, &patch); err != nil || len(patch) == 0 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "字典内容无效")
	}
	for key, raw := range patch {
		var err error
		switch key {
		case "name":
			err = json.Unmarshal(raw, &in.Name)
		case "code":
			err = json.Unmarshal(raw, &in.Code)
		case "status":
			err = json.Unmarshal(raw, &in.Status)
		case "description":
			err = json.Unmarshal(raw, &in.Description)
		default:
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "未知字段")
		}
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_request", "字段格式无效")
		}
	}
	if err := validateDict(in); err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_request", err.Error())
	}
	var saved *ent.Dict
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		var err error
		if id == 0 {
			create := tx.Dict.Create().SetName(in.Name).SetCode(in.Code).SetStatus(in.Status)

			if in.Description != nil {
				create.SetDescription(*in.Description)
			}
			saved, err = create.Save(ctx)
		} else {
			update := tx.Dict.UpdateOneID(id).SetName(in.Name).SetCode(in.Code).SetStatus(in.Status)
			if in.Description == nil {
				update.ClearDescription()
			} else {
				update.SetDescription(*in.Description)
			}
			saved, err = update.Save(ctx)
		}
		if err != nil {
			return err
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation(operation).SetResource("dicts").SetResourceID(saved.ID)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(409, "dict_conflict", err.Error())
	}
	return kernel.Success(200, dictView(saved))
}

func (f *Service) DeleteDict(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", err.Error())
	}
	p := kernel.FromContext(ctx)
	if _, err = f.ScopedDict(ctx, inArgs, p, id); ent.IsNotFound(err) {
		return kernel.Outcome{}, kernel.Fail(404, "not_found", "字典不存在")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.Dict.DeleteOneID(id).Exec(ctx); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("delete").SetResource("dicts").SetResourceID(id)

		return log.Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "database_unavailable", "删除失败")
	}
	return kernel.Success(200, nil)
}

func (f *Service) LoadSetting(ctx context.Context, module string) (map[string]any, *ent.SystemSetting, error) {
	def, ok := contracts.Settings[module]
	if !ok {
		return nil, nil, errors.New("设置模块不存在")
	}
	value := copyDocument(def.Defaults)
	row, err := f.Store.Client.SystemSetting.Query().Where(systemsetting.ModuleEQ(module)).Only(ctx)
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

func (f *Service) GetRuntimeSetting(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	module := inArgs.SettingModule
	value, row, err := f.LoadSetting(ctx, module)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取设置失败")
	}
	return kernel.Success(200, settingEnvelope(module, value, row))
}

func (f *Service) RuntimeSettingsList(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	list := make([]map[string]any, 0)
	for _, module := range []string{"auth", "identitySecurity", "ui", "files"} {
		def := contracts.Settings[module]
		read, err := f.deps.Permitted(ctx, p, def.ReadPermission)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "设置权限查询失败")
		}
		if !read {
			continue
		}
		write, err := f.deps.Permitted(ctx, p, def.WritePermission)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "设置权限查询失败")
		}
		value, row, err := f.LoadSetting(ctx, module)
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取设置失败")
		}
		envelope := settingEnvelope(module, value, row)
		list = append(list, map[string]any{"module": module, "path": def.Path, "title": def.Title, "description": def.Description, "scope": "platform", "feature": nil, "page": def.Page, "canWrite": write, "version": envelope["version"], "overriddenCount": len(envelope["overriddenPaths"].([]string)), "updatedAt": envelope["updatedAt"]})
	}
	return kernel.Success(200, list)
}

func (f *Service) UpdateRuntimeSetting(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	module := inArgs.SettingModule
	var in struct {
		Version *int           `json:"version"`
		Data    map[string]any `json:"data"`
	}
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || in.Version == nil || *in.Version < 0 || in.Data == nil || contracts.ValidateSetting(module, in.Data) != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_settings", "设置参数无效")
	}
	if module == "ui" {
		policy := in.Data["preferences"].(map[string]any)
		defaults := policy["defaults"].(map[string]any)
		allowed := policy["allowUserOverride"].(map[string]any)
		for _, key := range []string{"showQuickChat", "enableLockScreen", "notificationSound", "desktopNotification"} {
			if defaults[key] == true || allowed[key] == true {
				return kernel.Outcome{}, kernel.Fail(400, "unsupported_settings", "未迁移功能不能开启")
			}
		}
	}
	p := kernel.FromContext(ctx)
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if *in.Version == 0 {
			if err := tx.SystemSetting.Create().SetModule(module).SetVersion(1).SetData(in.Data).Exec(ctx); err != nil {
				if ent.IsConstraintError(err) {
					return kernel.ErrSettingsConflict
				}
				return err
			}
		} else {
			count, err := tx.SystemSetting.Update().Where(systemsetting.ModuleEQ(module), systemsetting.VersionEQ(*in.Version)).SetVersion(*in.Version + 1).SetData(in.Data).Save(ctx)
			if err != nil {
				return err
			}
			if count != 1 {
				return kernel.ErrSettingsConflict
			}
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(inArgs.TraceID).SetOperation("settings_update").SetResource(module).Exec(ctx)
	})
	if errors.Is(err, kernel.ErrSettingsConflict) {
		return kernel.Outcome{}, kernel.Fail(409, "version_conflict", "设置已被修改，请刷新后重试")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "保存设置失败")
	}
	return f.GetRuntimeSetting(ctx, inArgs)
}

func (f *Service) SettingsProjection(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	auth, _, err := f.LoadSetting(ctx, "auth")
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取设置失败")
	}
	auth["allowRegistration"] = false
	auth["forgotPasswordEnabled"] = false
	security, _, err := f.LoadSetting(ctx, "identitySecurity")
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取设置失败")
	}
	projection := map[string]any{"auth": auth, "identitySecurity": map[string]any{"password": security["password"]}}
	if inArgs.Personal {
		projection["identitySecurity"].(map[string]any)["session"] = security["session"]
		ui, _, err := f.LoadSetting(ctx, "ui")
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取设置失败")
		}
		ui["quickChatEnabled"] = false
		ui["feedbackEntryEnabled"] = false
		projection["ui"] = ui
		projection["identitySecurity"].(map[string]any)["session"] = security["session"]
		// This closed capability is required by the retained legacy projection.
		projection["identitySecurity"].(map[string]any)["impersonation"] = map[string]any{"enabled": false, "maxMinutes": 30, "allowWrite": false, "notifyTarget": false}
		files, _, err := f.LoadSetting(ctx, "files")
		if err != nil {
			return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取设置失败")
		}
		projection["files"] = map[string]any{"chunkThresholdMb": files["chunkThresholdMb"], "chunkSizeMb": files["chunkSizeMb"]}
	}
	return kernel.Success(200, projection)
}

func (f *Service) LoadFileSettings(ctx context.Context) (kernel.FileSettings, *ent.SystemSetting, error) {
	settings := kernel.DefaultFileSettings()
	row, err := f.Store.Client.SystemSetting.Query().Where(systemsetting.ModuleEQ("files")).Only(ctx)
	if ent.IsNotFound(err) {
		return settings, nil, nil
	}
	if err != nil {
		return settings, nil, err
	}
	encoded, err := json.Marshal(row.Data)
	if err != nil {
		return settings, nil, err
	}
	if err = json.Unmarshal(encoded, &settings); err != nil {
		return settings, nil, err
	}
	return settings, row, nil
}

func (f *Service) GetFileSettings(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	settings, row, err := f.LoadFileSettings(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取设置失败")
	}
	return kernel.Success(200, fileSettingsEnvelope(settings, row))
}

func (f *Service) ListSettings(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	settings, row, err := f.LoadFileSettings(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取设置失败")
	}
	version := 0
	var updatedAt *time.Time
	if row != nil {
		version, updatedAt = row.Version, &row.UpdatedAt
	}
	paths := fileSettingsEnvelope(settings, row)["overriddenPaths"].([]string)
	return kernel.Success(200, []map[string]any{{"module": "files", "path": "/files", "title": "文件上传", "description": "上传大小与分片策略", "scope": "platform", "feature": nil, "page": "/system/settings/files", "canWrite": kernel.FromContext(ctx).SuperAdmin, "version": version, "overriddenCount": len(paths), "updatedAt": updatedAt}})
}

func (f *Service) FileUploadPolicy(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
	settings, _, err := f.LoadFileSettings(ctx)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "读取上传策略失败")
	}
	return kernel.Success(200, map[string]int{"uploadMaxSizeMb": settings.UploadMaxSizeMb, "chunkThresholdMb": settings.ChunkThresholdMb, "chunkSizeMb": settings.ChunkSizeMb})
}

func (f *Service) UpdateFileSettings(ctx context.Context, inArgs kernel.Input) (kernel.Outcome, error) {
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
	if err := kernel.DecodeBody(inArgs.Body, &in); err != nil || in.Version < 0 || in.Data.UploadValidateType == nil || in.Data.UploadAllowedTypes == nil || in.Data.UploadMaxSizeMb == nil || in.Data.ChunkThresholdMb == nil || in.Data.ChunkSizeMb == nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_settings", "设置参数无效")
	}
	if len(*in.Data.UploadAllowedTypes) > 200 || *in.Data.UploadMaxSizeMb < 0 || *in.Data.UploadMaxSizeMb > 102400 || *in.Data.ChunkThresholdMb < 1 || *in.Data.ChunkThresholdMb > 32 || *in.Data.ChunkSizeMb < 5 || *in.Data.ChunkSizeMb > 32 {
		return kernel.Outcome{}, kernel.Fail(400, "unsupported_settings", "设置值无效或尚未支持")
	}
	for _, rule := range *in.Data.UploadAllowedTypes {
		if strings.TrimSpace(rule) != rule || len(rule) < 1 || len(rule) > 128 {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_mime_rule", "MIME 类型规则无效")
		}
	}
	data := map[string]any{"uploadValidateType": *in.Data.UploadValidateType, "uploadAllowedTypes": *in.Data.UploadAllowedTypes,
		"uploadMaxSizeMb": *in.Data.UploadMaxSizeMb, "chunkThresholdMb": *in.Data.ChunkThresholdMb, "chunkSizeMb": *in.Data.ChunkSizeMb}
	p := kernel.FromContext(ctx)
	err := f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if in.Version == 0 {
			if err := tx.SystemSetting.Create().SetModule("files").SetVersion(1).SetData(data).Exec(ctx); err != nil {
				if ent.IsConstraintError(err) {
					return kernel.ErrSettingsConflict
				}
				return err
			}
		} else {
			changed, err := tx.SystemSetting.Update().Where(systemsetting.ModuleEQ("files"), systemsetting.VersionEQ(in.Version)).SetVersion(in.Version + 1).SetData(data).Save(ctx)
			if err != nil {
				return err
			}
			if changed != 1 {
				return kernel.ErrSettingsConflict
			}
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetOperation("settings_update").SetResource("files").SetRequestID(inArgs.TraceID).Exec(ctx)
	})
	if errors.Is(err, kernel.ErrSettingsConflict) {
		return kernel.Outcome{}, kernel.Fail(409, "version_conflict", "设置已被修改，请刷新后重试")
	}
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(503, "settings_unavailable", "保存设置失败")
	}
	return f.GetFileSettings(ctx, inArgs)
}

func (f *Service) DictItemTarget(ctx context.Context, inArgs kernel.Input) (int, int, error) {
	id, err := kernel.IntParam(inArgs.Id)
	if err != nil {
		return 0, 0, kernel.Fail(400, "invalid_id", err.Error())
	}
	_, err = f.ScopedDict(ctx, inArgs, kernel.FromContext(ctx), id)
	if ent.IsNotFound(err) {
		return 0, 0, kernel.Fail(404, "not_found", "字典不存在")
	}
	if err != nil {
		return 0, 0, kernel.Fail(503, "database_unavailable", "查询失败")
	}
	item := 0
	if inArgs.ItemId != "" {
		item, err = kernel.IntParam(inArgs.ItemId)
		if err != nil {
			return 0, 0, kernel.Fail(400, "invalid_item_id", err.Error())
		}
	}
	return id, item, nil
}
