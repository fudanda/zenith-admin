package zenith

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/tenant"
	"github.com/fudanda/zenith-admin/backend/ent/tenantpackage"
	"github.com/gorilla/mux"
)

type tenantInput struct {
	Name         string     `json:"name"`
	Code         string     `json:"code"`
	Status       string     `json:"status"`
	ContactName  *string    `json:"contactName"`
	ContactPhone *string    `json:"contactPhone"`
	ExpireAt     *time.Time `json:"expireAt"`
	MaxUsers     *int       `json:"maxUsers"`
	PackageID    *int       `json:"packageId"`
	Remark       *string    `json:"remark"`
}

func tenantView(row *ent.Tenant) map[string]any {
	return map[string]any{
		"id": row.ID, "name": row.Name, "code": row.Code, "status": row.Status, "contactName": row.ContactName,
		"contactPhone": row.ContactPhone, "expireAt": row.ExpireAt, "maxUsers": row.MaxUsers, "packageId": row.PackageID,
		"remark": row.Remark, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt,
	}
}

func validateTenant(in tenantInput) error {
	if len([]rune(strings.TrimSpace(in.Name))) == 0 || len([]rune(in.Name)) > 100 {
		return errors.New("租户名称无效")
	}
	if len(in.Code) == 0 || len(in.Code) > 50 || !positionCode.MatchString(in.Code) {
		return errors.New("租户编码无效")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("租户状态无效")
	}
	if in.MaxUsers != nil && *in.MaxUsers < 1 {
		return errors.New("最大用户数无效")
	}
	return nil
}

func (f *Framework) listTenants(w http.ResponseWriter, r *http.Request) {
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
	query := f.Store.Client.Tenant.Query()
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(tenant.Or(tenant.NameContainsFold(keyword), tenant.CodeContainsFold(keyword)))
	}
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			fail(w, 400, "invalid_status", "状态无效")
			return
		}
		query = query.Where(tenant.StatusEQ(status))
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Desc(tenant.FieldID)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, tenantView(row))
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) allTenants(w http.ResponseWriter, r *http.Request) {
	rows, err := f.Store.Client.Tenant.Query().Where(tenant.StatusEQ("enabled")).Order(ent.Asc(tenant.FieldName)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		list = append(list, tenantView(row))
	}
	respond(w, 200, list)
}

func (f *Framework) getTenant(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	row, err := f.Store.Client.Tenant.Get(r.Context(), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "租户不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, tenantView(row))
}

func (f *Framework) validateTenantPackage(r *http.Request, id *int) error {
	if id == nil {
		return nil
	}
	if *id < 1 {
		return errors.New("套餐无效")
	}
	exists, err := f.Store.Client.TenantPackage.Query().Where(tenantpackage.IDEQ(*id), tenantpackage.StatusEQ("enabled")).Exist(r.Context())
	if err != nil {
		return err
	}
	if !exists {
		return errors.New("套餐不存在或已停用")
	}
	return nil
}

func applyTenantCreate(create *ent.TenantCreate, in tenantInput) {
	create.SetName(in.Name).SetCode(in.Code).SetStatus(in.Status)
	if in.ContactName != nil {
		create.SetContactName(*in.ContactName)
	}
	if in.ContactPhone != nil {
		create.SetContactPhone(*in.ContactPhone)
	}
	if in.ExpireAt != nil {
		create.SetExpireAt(*in.ExpireAt)
	}
	if in.MaxUsers != nil {
		create.SetMaxUsers(*in.MaxUsers)
	}
	if in.PackageID != nil {
		create.SetPackageID(*in.PackageID)
	}
	if in.Remark != nil {
		create.SetRemark(*in.Remark)
	}
}

func applyTenantUpdate(update *ent.TenantUpdateOne, in tenantInput) {
	update.SetName(in.Name).SetCode(in.Code).SetStatus(in.Status)
	if in.ContactName == nil {
		update.ClearContactName()
	} else {
		update.SetContactName(*in.ContactName)
	}
	if in.ContactPhone == nil {
		update.ClearContactPhone()
	} else {
		update.SetContactPhone(*in.ContactPhone)
	}
	if in.ExpireAt == nil {
		update.ClearExpireAt()
	} else {
		update.SetExpireAt(*in.ExpireAt)
	}
	if in.MaxUsers == nil {
		update.ClearMaxUsers()
	} else {
		update.SetMaxUsers(*in.MaxUsers)
	}
	if in.PackageID == nil {
		update.ClearPackageID()
	} else {
		update.SetPackageID(*in.PackageID)
	}
	if in.Remark == nil {
		update.ClearRemark()
	} else {
		update.SetRemark(*in.Remark)
	}
}

func (f *Framework) createTenant(w http.ResponseWriter, r *http.Request) {
	var in tenantInput
	if err := decode(r, &in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	if in.Status == "" {
		in.Status = "enabled"
	}
	if err := validateTenant(in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	if err := f.validateTenantPackage(r, in.PackageID); err != nil {
		fail(w, 400, "invalid_package", err.Error())
		return
	}
	p := fromContext(r.Context())
	var saved *ent.Tenant
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		create := tx.Tenant.Create()
		applyTenantCreate(create, in)
		var err error
		saved, err = create.Save(r.Context())
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetTenantID(saved.ID).SetOperation("create").SetResource("tenants").SetResourceID(saved.ID).Exec(r.Context())
	})
	if err != nil {
		fail(w, 409, "tenant_conflict", "租户保存失败")
		return
	}
	respond(w, 201, tenantView(saved))
}

func (f *Framework) updateTenant(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	var patch map[string]json.RawMessage
	if err := decode(r, &patch); err != nil || len(patch) == 0 {
		fail(w, 400, "invalid_request", "更新内容不能为空")
		return
	}
	p := fromContext(r.Context())
	var saved *ent.Tenant
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		current, err := tx.Tenant.Get(r.Context(), id)
		if err != nil {
			return err
		}
		in := tenantInput{Name: current.Name, Code: current.Code, Status: current.Status, ContactName: current.ContactName, ContactPhone: current.ContactPhone, ExpireAt: current.ExpireAt, MaxUsers: current.MaxUsers, PackageID: current.PackageID, Remark: current.Remark}
		for key, raw := range patch {
			switch key {
			case "name":
				err = json.Unmarshal(raw, &in.Name)
			case "code":
				err = json.Unmarshal(raw, &in.Code)
			case "status":
				err = json.Unmarshal(raw, &in.Status)
			case "contactName":
				err = json.Unmarshal(raw, &in.ContactName)
			case "contactPhone":
				err = json.Unmarshal(raw, &in.ContactPhone)
			case "expireAt":
				err = json.Unmarshal(raw, &in.ExpireAt)
			case "maxUsers":
				err = json.Unmarshal(raw, &in.MaxUsers)
			case "packageId":
				err = json.Unmarshal(raw, &in.PackageID)
			case "remark":
				err = json.Unmarshal(raw, &in.Remark)
			default:
				return errors.New("未知字段")
			}
			if err != nil {
				return err
			}
		}
		if err = validateTenant(in); err != nil {
			return err
		}
		if err = f.validateTenantPackage(r, in.PackageID); err != nil {
			return err
		}
		update := tx.Tenant.UpdateOneID(id)
		applyTenantUpdate(update, in)
		saved, err = update.Save(r.Context())
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetTenantID(id).SetOperation("update").SetResource("tenants").SetResourceID(id).Exec(r.Context())
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "租户不存在")
		return
	}
	if err != nil {
		fail(w, 409, "tenant_conflict", err.Error())
		return
	}
	respond(w, 200, tenantView(saved))
}
