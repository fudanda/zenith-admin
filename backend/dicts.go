package zenith

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/dict"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/gorilla/mux"
)

func dictScope(p *principal) predicate.Dict {
	if p.TenantID == nil {
		return dict.TenantIDIsNil()
	}
	return dict.TenantIDEQ(*p.TenantID)
}
func (f *Framework) scopedDict(r *http.Request, p *principal, id int) (*ent.Dict, error) {
	return f.Store.Client.Dict.Query().Where(dict.IDEQ(id), dictScope(p)).Only(r.Context())
}
func dictView(row *ent.Dict) map[string]any {
	return map[string]any{"id": row.ID, "name": row.Name, "code": row.Code, "description": row.Description, "status": row.Status, "tenantId": row.TenantID, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}
}

func (f *Framework) listDicts(w http.ResponseWriter, r *http.Request) {
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
	query, err := f.filteredDicts(p, q)
	if err != nil {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, dictView(row))
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) filteredDicts(p *principal, q url.Values) (*ent.DictQuery, error) {
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
			value, err := parseFilterDateBound(raw, bound.end)
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

func (f *Framework) exportDictsCSV(w http.ResponseWriter, r *http.Request) {
	query, err := f.filteredDicts(fromContext(r.Context()), r.URL.Query())
	if err != nil {
		fail(w, 400, "invalid_filter", err.Error())
		return
	}
	streamCSV(w, "dicts.csv", []string{"ID", "字典名称", "字典编码", "描述", "状态", "创建时间"}, func(offset int) ([][]string, error) {
		rows, err := query.Clone().Offset(offset).Limit(200).All(r.Context())
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

func (f *Framework) getDict(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	row, err := f.scopedDict(r, fromContext(r.Context()), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "字典不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, dictView(row))
}

type dictInput struct {
	Name, Code, Status string
	Description        *string
}

func validateDict(in dictInput) error {
	if len([]rune(strings.TrimSpace(in.Name))) == 0 || len([]rune(in.Name)) > 64 {
		return errors.New("字典名称无效")
	}
	if len(in.Code) == 0 || len(in.Code) > 64 || !roleCodePattern.MatchString(in.Code) {
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

func (f *Framework) saveDict(w http.ResponseWriter, r *http.Request) {
	id := 0
	if r.Method == http.MethodPut {
		var err error
		id, err = intParam(mux.Vars(r)["id"])
		if err != nil {
			fail(w, 400, "invalid_id", err.Error())
			return
		}
	}
	p := fromContext(r.Context())
	in := dictInput{Status: "enabled"}
	if id != 0 {
		current, err := f.scopedDict(r, p, id)
		if ent.IsNotFound(err) {
			fail(w, 404, "not_found", "字典不存在")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		in = dictInput{Name: current.Name, Code: current.Code, Status: current.Status, Description: current.Description}
	}
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil || len(patch) == 0 {
		fail(w, 400, "invalid_request", "字典内容无效")
		return
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
			fail(w, 400, "invalid_request", "未知字段")
			return
		}
		if err != nil {
			fail(w, 400, "invalid_request", "字段格式无效")
			return
		}
	}
	if err := validateDict(in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	var saved *ent.Dict
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		if id == 0 {
			create := tx.Dict.Create().SetName(in.Name).SetCode(in.Code).SetStatus(in.Status)
			if p.TenantID != nil {
				create.SetTenantID(*p.TenantID)
			}
			if in.Description != nil {
				create.SetDescription(*in.Description)
			}
			saved, err = create.Save(r.Context())
		} else {
			update := tx.Dict.UpdateOneID(id).SetName(in.Name).SetCode(in.Code).SetStatus(in.Status)
			if in.Description == nil {
				update.ClearDescription()
			} else {
				update.SetDescription(*in.Description)
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
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("dicts").SetResourceID(saved.ID)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 409, "dict_conflict", err.Error())
		return
	}
	respond(w, 200, dictView(saved))
}

func (f *Framework) deleteDict(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	if _, err = f.scopedDict(r, p, id); ent.IsNotFound(err) {
		fail(w, 404, "not_found", "字典不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		if err := tx.Dict.DeleteOneID(id).Exec(r.Context()); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("delete").SetResource("dicts").SetResourceID(id)
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
