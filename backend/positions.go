package zenith

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/position"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/userposition"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	"github.com/gorilla/mux"
)

var positionCode = regexp.MustCompile(`^\w+$`)

func positionScope(p *principal) predicate.Position {
	if p.TenantID == nil {
		return position.TenantIDIsNil()
	}
	return position.TenantIDEQ(*p.TenantID)
}

func positionView(row *ent.Position, count int) contracts.Position {
	return contracts.Position{
		Id: row.ID, Name: row.Name, Code: row.Code, Sort: row.Sort,
		Status: contracts.PositionStatus(row.Status), Remark: row.Remark, UserCount: &count,
		CreatedAt: row.CreatedAt.Format(time.RFC3339Nano), UpdatedAt: row.UpdatedAt.Format(time.RFC3339Nano),
	}
}

func (f *Framework) positionCount(ctx context.Context, id int) (int, error) {
	return f.Store.Client.UserPosition.Query().Where(userposition.PositionIDEQ(id)).Count(ctx)
}

func (f *Framework) scopedPosition(ctx context.Context, p *principal, id int) (*ent.Position, error) {
	return f.Store.Client.Position.Query().Where(position.IDEQ(id), positionScope(p)).Only(ctx)
}

func (f *Framework) listPositions(w http.ResponseWriter, r *http.Request) {
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
	query := f.Store.Client.Position.Query().Where(positionScope(p))
	if keyword := strings.TrimSpace(q.Get("keyword")); keyword != "" {
		query = query.Where(position.Or(position.NameContainsFold(keyword), position.CodeContainsFold(keyword)))
	}
	if status := q.Get("status"); status != "" {
		if status != "enabled" && status != "disabled" {
			fail(w, 400, "invalid_status", "状态无效")
			return
		}
		query = query.Where(position.StatusEQ(status))
	}
	for _, bound := range []struct {
		name string
		end  bool
	}{
		{"startTime", false}, {"endTime", true},
	} {
		if raw := q.Get(bound.name); raw != "" {
			value, err := parsePositionDateBound(raw, bound.end)
			if err != nil {
				fail(w, 400, "invalid_date_range", err.Error())
				return
			}
			if bound.end {
				query = query.Where(position.CreatedAtLTE(value))
			} else {
				query = query.Where(position.CreatedAtGTE(value))
			}
		}
	}
	total, err := query.Clone().Count(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	rows, err := query.Order(ent.Asc(position.FieldSort), ent.Desc(position.FieldID)).Offset((page - 1) * size).Limit(size).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		count, err := f.positionCount(r.Context(), row.ID)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, positionView(row, count))
	}
	respond(w, 200, map[string]any{"list": list, "total": total, "page": page, "pageSize": size})
}

func parsePositionDateBound(raw string, end bool) (time.Time, error) {
	layout := "2006-01-02"
	if len(raw) == len("2006-01-02 15:04:05") {
		layout = "2006-01-02 15:04:05"
	}
	value, err := time.ParseInLocation(layout, raw, time.Local)
	if err != nil {
		return time.Time{}, errors.New("时间格式必须为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss")
	}
	if end && layout == "2006-01-02" {
		value = value.Add(24*time.Hour - time.Millisecond)
	}
	return value, nil
}

func (f *Framework) allPositions(w http.ResponseWriter, r *http.Request) {
	rows, err := f.Store.Client.Position.Query().Where(positionScope(fromContext(r.Context()))).Order(ent.Asc(position.FieldSort)).All(r.Context())
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	list := make([]any, 0, len(rows))
	for _, row := range rows {
		count, err := f.positionCount(r.Context(), row.ID)
		if err != nil {
			fail(w, 503, "database_unavailable", "查询失败")
			return
		}
		list = append(list, positionView(row, count))
	}
	respond(w, 200, list)
}

func (f *Framework) getPosition(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	row, err := f.scopedPosition(r.Context(), fromContext(r.Context()), id)
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "岗位不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	count, err := f.positionCount(r.Context(), row.ID)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, positionView(row, count))
}

type positionInput struct {
	Name   string  `json:"name"`
	Code   string  `json:"code"`
	Sort   int     `json:"sort"`
	Status string  `json:"status"`
	Remark *string `json:"remark"`
}

func validatePosition(in positionInput) error {
	if len([]rune(strings.TrimSpace(in.Name))) < 1 || len([]rune(in.Name)) > 64 {
		return errors.New("岗位名称长度无效")
	}
	if len(in.Code) < 1 || len(in.Code) > 64 || !positionCode.MatchString(in.Code) {
		return errors.New("岗位编码只能包含字母、数字和下划线")
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return errors.New("岗位状态无效")
	}
	if in.Remark != nil && len([]rune(*in.Remark)) > 256 {
		return errors.New("备注过长")
	}
	return nil
}

func (f *Framework) auditPosition(ctx context.Context, tx *ent.Tx, p *principal, requestID, operation string, id int) error {
	create := tx.AuditLog.Create().SetActorID(p.User.ID).SetRequestID(requestID).SetOperation(operation).SetResource("positions").SetResourceID(id)
	if p.TenantID != nil {
		create.SetTenantID(*p.TenantID)
	}
	return create.Exec(ctx)
}

func (f *Framework) createPosition(w http.ResponseWriter, r *http.Request) {
	var body contracts.PositionsCreateJSONBody
	if err := decode(r, &body); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	in := positionInput{Name: body.Name, Code: body.Code, Remark: body.Remark, Status: "enabled"}
	if body.Sort != nil {
		in.Sort = *body.Sort
	}
	if body.Status != nil {
		in.Status = string(*body.Status)
	}
	if err := validatePosition(in); err != nil {
		fail(w, 400, "invalid_request", err.Error())
		return
	}
	p := fromContext(r.Context())
	var saved *ent.Position
	err := f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		create := tx.Position.Create().SetName(in.Name).SetCode(in.Code).SetSort(in.Sort).SetStatus(in.Status)
		if p.TenantID != nil {
			create.SetTenantID(*p.TenantID)
		}
		if in.Remark != nil {
			create.SetRemark(*in.Remark)
		}
		var err error
		saved, err = create.Save(r.Context())
		if err != nil {
			return err
		}
		return f.auditPosition(r.Context(), tx, p, requestID(r), "create", saved.ID)
	})
	if err != nil {
		fail(w, 409, "position_conflict", "岗位保存失败，请检查编码是否重复")
		return
	}
	respond(w, 201, positionView(saved, 0))
}

func (f *Framework) updatePosition(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	var patch map[string]json.RawMessage
	if err = decode(r, &patch); err != nil || len(patch) == 0 {
		fail(w, 400, "invalid_request", "更新内容不能为空")
		return
	}
	for key := range patch {
		if key != "name" && key != "code" && key != "sort" && key != "status" && key != "remark" {
			fail(w, 400, "invalid_request", "未知字段")
			return
		}
	}
	p := fromContext(r.Context())
	var saved *ent.Position
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		current, err := tx.Position.Query().Where(position.IDEQ(id), positionScope(p)).Only(r.Context())
		if err != nil {
			return err
		}
		in := positionInput{Name: current.Name, Code: current.Code, Sort: current.Sort, Status: current.Status, Remark: current.Remark}
		if raw, ok := patch["name"]; ok {
			if err = json.Unmarshal(raw, &in.Name); err != nil {
				return err
			}
		}
		if raw, ok := patch["code"]; ok {
			if err = json.Unmarshal(raw, &in.Code); err != nil {
				return err
			}
		}
		if raw, ok := patch["sort"]; ok {
			if err = json.Unmarshal(raw, &in.Sort); err != nil {
				return err
			}
		}
		if raw, ok := patch["status"]; ok {
			if err = json.Unmarshal(raw, &in.Status); err != nil {
				return err
			}
		}
		if raw, ok := patch["remark"]; ok {
			if err = json.Unmarshal(raw, &in.Remark); err != nil {
				return err
			}
		}
		if err = validatePosition(in); err != nil {
			return err
		}
		update := tx.Position.UpdateOneID(id).SetName(in.Name).SetCode(in.Code).SetSort(in.Sort).SetStatus(in.Status)
		if in.Remark == nil {
			update.ClearRemark()
		} else {
			update.SetRemark(*in.Remark)
		}
		saved, err = update.Save(r.Context())
		if err != nil {
			return err
		}
		return f.auditPosition(r.Context(), tx, p, requestID(r), "update", id)
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "岗位不存在")
		return
	}
	if err != nil {
		fail(w, 409, "position_conflict", err.Error())
		return
	}
	count, err := f.positionCount(r.Context(), saved.ID)
	if err != nil {
		fail(w, 503, "database_unavailable", "查询失败")
		return
	}
	respond(w, 200, positionView(saved, count))
}

func (f *Framework) deletePosition(w http.ResponseWriter, r *http.Request) {
	id, err := intParam(mux.Vars(r)["id"])
	if err != nil {
		fail(w, 400, "invalid_id", err.Error())
		return
	}
	p := fromContext(r.Context())
	err = f.Store.WithTx(r.Context(), func(tx *ent.Tx) error {
		row, err := tx.Position.Query().Where(position.IDEQ(id), positionScope(p)).Only(r.Context())
		if err != nil {
			return err
		}
		if err = tx.Position.DeleteOne(row).Exec(r.Context()); err != nil {
			return err
		}
		if err := syncDynamicGroupsInTx(r.Context(), tx, p.TenantID); err != nil {
			return err
		}
		return f.auditPosition(r.Context(), tx, p, requestID(r), "delete", id)
	})
	if ent.IsNotFound(err) {
		fail(w, 404, "not_found", "岗位不存在")
		return
	}
	if err != nil {
		fail(w, 503, "database_unavailable", "删除失败")
		return
	}
	respond(w, 200, nil)
}
