package zenith

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/department"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/gorilla/mux"
)

func departmentScope(p *principal) predicate.Department {
	if p.TenantID == nil {
		return department.TenantIDIsNil()
	}
	return department.TenantIDEQ(*p.TenantID)
}

type departmentInput struct {
	ParentID int     `json:"parentId"`
	Name     string  `json:"name"`
	Code     string  `json:"code"`
	Category string  `json:"category"`
	LeaderID *int    `json:"leaderId"`
	Phone    *string `json:"phone"`
	Email    *string `json:"email"`
	Sort     int     `json:"sort"`
	Status   string  `json:"status"`
}

func validateDepartment(in departmentInput) error {
	if in.ParentID < 0 {
		return errors.New("上级部门无效")
	}
	if len([]rune(strings.TrimSpace(in.Name))) == 0 || len([]rune(in.Name)) > 64 {
		return errors.New("部门名称无效")
	}
	if len(in.Code) == 0 || len(in.Code) > 64 || !positionCode.MatchString(in.Code) {
		return errors.New("部门编码无效")
	}
	if in.Category == "" {
		return errors.New("部门类别无效")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("状态无效")
	}
	if in.LeaderID != nil && *in.LeaderID < 1 {
		return errors.New("负责人无效")
	}
	return nil
}

func (f *Framework) departmentView(r *http.Request, row *ent.Department) (map[string]any, error) {
	count, err := f.Store.Client.User.Query().Where(user.DepartmentIDEQ(row.ID)).Count(r.Context())
	if err != nil {
		return nil, err
	}
	var leaderName *string
	if row.LeaderID != nil {
		leader, err := f.Store.Client.User.Get(r.Context(), *row.LeaderID)
		if err == nil {
			leaderName = &leader.Nickname
		} else if !ent.IsNotFound(err) {
			return nil, err
		}
	}
	return map[string]any{"id": row.ID, "parentId": row.ParentID, "name": row.Name, "code": row.Code, "category": row.Category, "leaderId": row.LeaderID, "leaderName": leaderName,
		"phone": row.Phone, "email": row.Email, "sort": row.Sort, "status": row.Status, "userCount": count, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}, nil
}

func (f *Framework) departmentRows(r *http.Request, p *principal) ([]*ent.Department, error) {
	return f.Store.Client.Department.Query().Where(departmentScope(p)).Order(ent.Asc(department.FieldSort), ent.Asc(department.FieldID)).All(r.Context())
}

func (f *Framework) flatDepartments(w http.ResponseWriter, r *http.Request) {
	rows, err := f.departmentRows(r, fromContext(r.Context()))
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.departmentView(r, row)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, list)
}

func (f *Framework) treeDepartments(w http.ResponseWriter, r *http.Request) {
	rows, err := f.departmentRows(r, fromContext(r.Context()))
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	keyword := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("keyword")))
	status := r.URL.Query().Get("status")
	byID := map[int]map[string]any{}
	ordered := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.departmentView(r, row)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		view["children"] = []any{}
		byID[row.ID] = view
		ordered = append(ordered, view)
	}
	roots := make([]any, 0)
	for _, item := range ordered {
		parentID := item["parentId"].(int)
		if parent, ok := byID[parentID]; ok {
			parent["children"] = append(parent["children"].([]any), item)
		} else {
			roots = append(roots, item)
		}
	}
	var filter func(map[string]any) (map[string]any, bool)
	filter = func(item map[string]any) (map[string]any, bool) {
		children := make([]any, 0)
		for _, child := range item["children"].([]any) {
			if kept, ok := filter(child.(map[string]any)); ok {
				children = append(children, kept)
			}
		}
		match := (keyword == "" || strings.Contains(strings.ToLower(item["name"].(string)+" "+item["code"].(string)), keyword)) && (status == "" || item["status"] == status)
		if !match && len(children) == 0 {
			return nil, false
		}
		item["children"] = children
		return item, true
	}
	result := make([]any, 0)
	for _, root := range roots {
		if kept, ok := filter(root.(map[string]any)); ok {
			result = append(result, kept)
		}
	}
	respond(w, 200, result)
}

func (f *Framework) getDepartment(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	row, err := f.Store.Client.Department.Query().Where(department.IDEQ(id), departmentScope(fromContext(r.Context()))).Only(r.Context())
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "部门不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	view, err := f.departmentView(r, row)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}

func (f *Framework) validateDepartmentRelations(r *http.Request, p *principal, id int, in departmentInput) error {
	if in.ParentID == id && id != 0 {
		return errors.New("部门不能成为自己的上级")
	}
	seen := map[int]bool{}
	for current := in.ParentID; current != 0; {
		if current == id || seen[current] {
			return errors.New("部门层级形成循环")
		}
		seen[current] = true
		parent, err := f.Store.Client.Department.Query().Where(department.IDEQ(current), departmentScope(p)).Only(r.Context())
		if err != nil {
			return errors.New("上级部门不存在")
		}
		current = parent.ParentID
	}
	if in.LeaderID != nil {
		leader, err := f.Store.Client.User.Get(r.Context(), *in.LeaderID)
		if err != nil || !userMatchesTenant(leader, p.TenantID) {
			return errors.New("负责人不属于当前租户")
		}
	}
	return nil
}

func (f *Framework) saveDepartment(w http.ResponseWriter, r *http.Request) {
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
	in := departmentInput{Category: "department", Status: "enabled"}
	if id != 0 {
		current, err := f.Store.Client.Department.Query().Where(department.IDEQ(id), departmentScope(p)).Only(r.Context())
		if ent.IsNotFound(err) {
			fail(w, 404, "not_found", "部门不存在")
			return
		}
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		in = departmentInput{ParentID: current.ParentID, Name: current.Name, Code: current.Code, Category: current.Category, LeaderID: current.LeaderID, Phone: current.Phone, Email: current.Email, Sort: current.Sort, Status: current.Status}
	}
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil || len(patch) == 0 {
		fail(w, 400, "invalid_request", "部门内容无效")
		return
	}
	for key, raw := range patch {
		var err error
		switch key {
		case "parentId":
			err = json.Unmarshal(raw, &in.ParentID)
		case "name":
			err = json.Unmarshal(raw, &in.Name)
		case "code":
			err = json.Unmarshal(raw, &in.Code)
		case "category":
			err = json.Unmarshal(raw, &in.Category)
		case "leaderId":
			err = json.Unmarshal(raw, &in.LeaderID)
		case "phone":
			err = json.Unmarshal(raw, &in.Phone)
		case "email":
			err = json.Unmarshal(raw, &in.Email)
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
	if err := validateDepartment(in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	if err := f.validateDepartmentRelations(r, p, id, in); err != nil {
		fail(w, 400, "invalid_relation", err.Error())
		return
	}
	var saved *ent.Department
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		if id == 0 {
			create := tx.Department.Create().SetParentID(in.ParentID).SetName(in.Name).SetCode(in.Code).SetCategory(in.Category).SetSort(in.Sort).SetStatus(in.Status)
			if p.TenantID != nil {
				create.SetTenantID(*p.TenantID)
			}
			if in.LeaderID != nil {
				create.SetLeaderID(*in.LeaderID)
			}
			if in.Phone != nil {
				create.SetPhone(*in.Phone)
			}
			if in.Email != nil {
				create.SetEmail(*in.Email)
			}
			saved, err = create.Save(r.Context())
		} else {
			update := tx.Department.UpdateOneID(id).SetParentID(in.ParentID).SetName(in.Name).SetCode(in.Code).SetCategory(in.Category).SetSort(in.Sort).SetStatus(in.Status)
			if in.LeaderID == nil {
				update.ClearLeaderID()
			} else {
				update.SetLeaderID(*in.LeaderID)
			}
			if in.Phone == nil {
				update.ClearPhone()
			} else {
				update.SetPhone(*in.Phone)
			}
			if in.Email == nil {
				update.ClearEmail()
			} else {
				update.SetEmail(*in.Email)
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
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("departments").SetResourceID(saved.ID)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if err != nil {
		fail(w, 409, "department_conflict", err.Error())
		return
	}
	view, err := f.departmentView(r, saved)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}

func (f *Framework) deleteDepartment(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		row, err := tx.Department.Query().Where(department.IDEQ(id), departmentScope(p)).Only(r.Context())
		if err != nil {
			return err
		}
		children, err := tx.Department.Query().Where(department.ParentIDEQ(id), departmentScope(p)).Exist(r.Context())
		if err != nil {
			return err
		}
		if children {
			return errors.New("部门仍有下级")
		}
		members, err := tx.User.Query().Where(user.DepartmentIDEQ(id)).Exist(r.Context())
		if err != nil {
			return err
		}
		if members {
			return errors.New("部门仍有成员")
		}
		if err := tx.Department.DeleteOne(row).Exec(r.Context()); err != nil {
			return err
		}
		log := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation("delete").SetResource("departments").SetResourceID(id)
		if p.TenantID != nil {
			log.SetTenantID(*p.TenantID)
		}
		return log.Exec(r.Context())
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "部门不存在")
		return
	}
	if err != nil {
		fail(w, 409, "department_conflict", err.Error())
		return
	}
	respond(w, 200, nil)
}
