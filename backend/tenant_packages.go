package zenith

import (
	"errors"
	"math"
	"net/http"
	"net/url"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/tenant"
	"github.com/fudanda/zenith-admin/backend/ent/tenantpackage"
	"github.com/fudanda/zenith-admin/backend/ent/tenantpackagefeature"
	"github.com/gorilla/mux"
)

type packageInput struct {
	Name     string         `json:"name"`
	Status   string         `json:"status"`
	Quotas   map[string]any `json:"quotas"`
	Remark   *string        `json:"remark"`
	Features []string       `json:"features"`
}

func validatePackage(in packageInput) error {
	if len([]rune(strings.TrimSpace(in.Name))) == 0 || len([]rune(in.Name)) > 100 {
		return errors.New("套餐名称无效")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("套餐状态无效")
	}
	if len(in.Quotas) > 1 {
		return errors.New("套餐配额字段无效")
	}
	for key, value := range in.Quotas {
		if key != "maxUsers" {
			return errors.New("套餐配额字段无效")
		}
		if value == nil {
			continue
		}
		maxUsers, ok := value.(float64)
		if !ok || maxUsers < 1 || math.Trunc(maxUsers) != maxUsers || maxUsers >= float64(math.MaxInt) {
			return errors.New("最大用户数无效")
		}
	}
	if len(in.Features) > 200 {
		return errors.New("功能数量过多")
	}
	seen := map[string]bool{}
	for _, feature := range in.Features {
		if len(feature) == 0 || len(feature) > 50 || seen[feature] {
			return errors.New("功能标识无效或重复")
		}
		seen[feature] = true
	}
	return nil
}

func (f *Framework) packageView(ctx *http.Request, row *ent.TenantPackage) (map[string]any, error) {
	features, err := f.Store.Client.TenantPackageFeature.Query().Where(tenantpackagefeature.PackageIDEQ(row.ID)).All(ctx.Context())
	if err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(features))
	for _, feature := range features {
		keys = append(keys, feature.FeatureKey)
	}
	return map[string]any{"id": row.ID, "name": row.Name, "status": row.Status, "quotas": row.Quotas, "remark": row.Remark, "features": keys, "createdAt": row.CreatedAt, "updatedAt": row.UpdatedAt}, nil
}

func (f *Framework) listPackages(w http.ResponseWriter, r *http.Request) {
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
	query, err := f.filteredPackages(q)
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
		view, err := f.packageView(r, row)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func (f *Framework) filteredPackages(q url.Values) (*ent.TenantPackageQuery, error) {
	query := f.Store.Client.TenantPackage.Query()
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(tenantpackage.NameContainsFold(keyword))
	}
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			return nil, errors.New("状态无效")
		}
		query = query.Where(tenantpackage.StatusEQ(status))
	}
	return query.Order(ent.Desc(tenantpackage.FieldID)), nil
}

var errPackageBound = errors.New("套餐已绑定租户，请先解绑或迁移")
var errPackageMissing = errors.New("套餐不存在")

func (f *Framework) deletePackages(w http.ResponseWriter, r *http.Request, ids []int, single bool) {
	if len(ids) == 0 || len(ids) > 200 {
		fail(w, 400, "invalid_request", "请选择 1 至 200 个套餐")
		return
	}
	seen := make(map[int]bool, len(ids))
	for _, id := range ids {
		if id < 1 || seen[id] {
			fail(w, 400, "invalid_request", "套餐 ID 无效或重复")
			return
		}
		seen[id] = true
	}
	p := fromContext(r.Context())
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		bound, err := tx.Tenant.Query().Where(tenant.PackageIDIn(ids...)).Exist(r.Context())
		if err != nil {
			return err
		}
		if bound {
			return errPackageBound
		}
		count, err := tx.TenantPackage.Delete().Where(tenantpackage.IDIn(ids...)).Exec(r.Context())
		if err != nil {
			return err
		}
		if single && count == 0 {
			return errPackageMissing
		}
		if count == 0 {
			return nil
		}
		operation := "delete_batch"
		if single {
			operation = "delete"
		}
		audit := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("tenant_packages")
		if single {
			audit.SetResourceID(ids[0])
		}
		return audit.Exec(r.Context())
	})
	if errors.Is(err, errPackageBound) {
		fail(w, 409, "package_bound", err.Error())
		return
	}
	if errors.Is(err, errPackageMissing) {
		fail(w, 404, "not_found", err.Error())
		return
	}
	if err != nil {
		fail(w, 409, "package_conflict", "套餐删除失败")
		return
	}
	respond(w, 200, nil)
}

func (f *Framework) deletePackage(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	f.deletePackages(w, r, []int{id}, true)
}

func (f *Framework) deletePackagesBatch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []int `json:"ids"`
	}
	if err := decode(r, &body); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	f.deletePackages(w, r, body.IDs, false)
}

func (f *Framework) allPackages(w http.ResponseWriter, r *http.Request) {
	rows, err := f.Store.Client.TenantPackage.Query().Where(tenantpackage.StatusEQ("enabled")).Order(ent.Asc(tenantpackage.FieldName)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		view, err := f.packageView(r, row)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, view)
	}
	respond(w, 200, list)
}

func (f *Framework) getPackage(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	row, err := f.Store.Client.TenantPackage.Get(r.Context(), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "套餐不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	view, err := f.packageView(r, row)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}

func (f *Framework) savePackage(w http.ResponseWriter, r *http.Request) {
	var in packageInput
	if err := decode(r, &in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	if in.Status == "" {
		in.Status = "enabled"
	}
	if err := validatePackage(in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
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
	var saved *ent.TenantPackage
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		var err error
		if id == 0 {
			create := tx.TenantPackage.Create().SetName(in.Name).SetStatus(in.Status).SetQuotas(in.Quotas)
			if in.Remark != nil {
				create.SetRemark(*in.Remark)
			}
			saved, err = create.Save(r.Context())
		} else {
			update := tx.TenantPackage.UpdateOneID(id).SetName(in.Name).SetStatus(in.Status).SetQuotas(in.Quotas)
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
		if _, err = tx.TenantPackageFeature.Delete().Where(tenantpackagefeature.PackageIDEQ(saved.ID)).Exec(r.Context()); err != nil {
			return err
		}
		for _, feature := range in.Features {
			if err = tx.TenantPackageFeature.Create().SetPackageID(saved.ID).SetFeatureKey(feature).Exec(r.Context()); err != nil {
				return err
			}
		}
		operation := "update"
		if id == 0 {
			operation = "create"
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID(r)).SetOperation(operation).SetResource("tenant_packages").SetResourceID(saved.ID).Exec(r.Context())
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "套餐不存在")
		return
	}
	if err != nil {
		fail(w, 409, "package_conflict", err.Error())
		return
	}
	view, err := f.packageView(r, saved)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, view)
}
