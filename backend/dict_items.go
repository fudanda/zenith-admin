package zenith

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/dict"
	"github.com/fudanda/zenith-admin/backend/ent/dictitem"
	"github.com/gorilla/mux"
)

func dictItemView(row *ent.DictItem) map[string]any {
	return map[string]any{"id": row.ID, "dictId": row.DictID, "parentId": row.ParentID, "label": row.Label, "value": row.Value,
		"color": row.Color, "sort": row.Sort, "status": row.Status, "remark": row.Remark, "metadata": row.Metadata, "createdBy": row.CreatedBy, "updatedBy": row.UpdatedBy,
		"createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}
}

func (f *Framework) listDictItems(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	if _, err = f.scopedDict(r, fromContext(r.Context()), id); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "字典不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	f.respondDictItems(w, r, id)
}

func (f *Framework) listDictItemsByCode(w http.ResponseWriter, r *http.Request) {
	code := mux.Vars(r)["code"]
	if len(code) == 0 || len(code) > 64 {
		fail(w, 400, "invalid_code", "字典编码无效")
		return
	}
	row, err := f.Store.Client.Dict.Query().Where(dict.CodeEQ(code), dictScope(fromContext(r.Context())), dict.StatusEQ("enabled")).Only(r.Context())
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "字典不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	f.respondDictItems(w, r, row.ID)
}

func (f *Framework) respondDictItems(w http.ResponseWriter, r *http.Request, dictID int) {
	rows, err := f.Store.Client.DictItem.Query().Where(dictitem.DictIDEQ(dictID)).Order(ent.Asc(dictitem.FieldSort), ent.Asc(dictitem.FieldID)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, dictItemView(row))
	}
	respond(w, 200, list)
}

func (f *Framework) scopedDictItem(r *http.Request, dictID, itemID int) (*ent.DictItem, error) {
	return f.Store.Client.DictItem.Query().Where(dictitem.IDEQ(itemID), dictitem.DictIDEQ(dictID)).Only(r.Context())
}

func (f *Framework) getDictItem(w http.ResponseWriter, r *http.Request) {
	dictID, itemID, ok := f.dictItemTarget(w, r)
	if !ok {
		return
	}
	row, err := f.scopedDictItem(r, dictID, itemID)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "字典项不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, dictItemView(row))
}

func (f *Framework) dictItemTarget(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	dictID, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return 0, 0, false
	}
	if _, err = f.scopedDict(r, fromContext(r.Context()), dictID); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "字典不存在")
		return 0, 0, false
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return 0, 0, false
	}
	itemID := 0
	if raw := mux.Vars(r)["itemId"]; raw != "" {
		itemID, err = intParam(raw)
		if err != nil {
			fail(w, 400, "invalid_item_id", err.Error())
			return 0, 0, false
		}
	}
	return dictID, itemID, true
}

type dictItemInput struct {
	Label, Value, Status string
	Color                *string
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
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("状态无效")
	}
	return nil
}

func (f *Framework) saveDictItem(w http.ResponseWriter, r *http.Request) {
	dictID, itemID, ok := f.dictItemTarget(w, r)
	if !ok {
		return
	}
	in := dictItemInput{Status: "enabled"}
	if itemID != 0 {
		current, err := f.scopedDictItem(r, dictID, itemID)
		if ent.IsNotFound(err) {
			fail(w, 404, "not_found", "字典项不存在")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		in = dictItemInput{Label: current.Label, Value: current.Value, Color: current.Color, Sort: current.Sort, Status: current.Status}
	}
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil || len(patch) == 0 {
		fail(w, 400, "invalid_request", "字典项内容无效")
		return
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
		case "sort":
			err = json.Unmarshal(raw, &in.Sort)
		case "status":
			err = json.Unmarshal(raw, &in.Status)
		default:
			fail(w, 400, "invalid_request", "未知字段")
			return
		}
		if err != nil {
			fail(w, 400, "invalid_request", "字段格式无效")
			return
		}
	}
	if err := validateDictItem(in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	p := fromContext(r.Context())
	var saved *ent.DictItem
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		if itemID == 0 {
			create := tx.DictItem.Create().SetDictID(dictID).SetLabel(in.Label).SetValue(in.Value).SetSort(in.Sort).SetStatus(in.Status).SetCreatedBy(p.User.ID).SetUpdatedBy(p.User.ID)
			if in.Color != nil {
				create.SetColor(*in.Color)
			}
			saved, err = create.Save(r.Context())
		} else {
			update := tx.DictItem.UpdateOneID(itemID).SetLabel(in.Label).SetValue(in.Value).SetSort(in.Sort).SetStatus(in.Status).SetUpdatedBy(p.User.ID)
			if in.Color == nil {
				update.ClearColor()
			} else {
				update.SetColor(*in.Color)
			}
			saved, err = update.Save(r.Context())
		}
		if err != nil {
			return err
		}
		operation := "create_item"
		if itemID != 0 {
			operation = "update_item"
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("dicts").SetResourceID(dictID)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 409, "dict_item_conflict", err.Error())
		return
	}
	respond(w, 200, dictItemView(saved))
}

func (f *Framework) deleteDictItem(w http.ResponseWriter, r *http.Request) {
	dictID, itemID, ok := f.dictItemTarget(w, r)
	if !ok {
		return
	}
	if _, err := f.scopedDictItem(r, dictID, itemID); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "字典项不存在")
		return
	} else if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	p := fromContext(r.Context())
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.DictItem.DeleteOneID(itemID).Exec(r.Context()); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("delete_item").SetResource("dicts").SetResourceID(dictID)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 503, "database_unavailable", "删除失败")
		return
	}
	respond(w, 200, nil)
}
