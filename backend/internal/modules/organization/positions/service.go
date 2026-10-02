// Package positions owns position rules, member visibility and transactional writes.
package positions

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/ent/position"
	"github.com/fudanda/arcbase/backend/ent/predicate"
	"github.com/fudanda/arcbase/backend/ent/user"
	"github.com/fudanda/arcbase/backend/ent/userposition"
	"github.com/fudanda/arcbase/backend/internal/contracts"
	"github.com/fudanda/arcbase/backend/internal/data"
	"github.com/fudanda/arcbase/backend/internal/security"
	"github.com/fudanda/arcbase/backend/internal/validation"
)

// Access is supplied by application assembly. No organization service imports
// authentication, user-group implementation or an HTTP request.
type Access interface {
	UserDataPredicate(context.Context, *security.Principal) (predicate.User, error)
	SyncDynamicGroups(context.Context, *ent.Tx, *security.Principal) error
}

type Service struct {
	store  *data.Store
	access Access
}

func NewService(store *data.Store, access Access) *Service {
	return &Service{store: store, access: access}
}

type Filter struct {
	Keyword, Status string
	Start, End      *time.Time
}

type Input struct {
	Name   string
	Code   string
	Sort   int
	Status string
	Remark *string
}

// InputError carries a stable contract error code, without an HTTP status.
type InputError struct{ Code, Message string }

func (e *InputError) Error() string { return e.Message }

// QueryError distinguishes post-write projection failures from write conflicts.
type QueryError struct{ Err error }

func (e *QueryError) Error() string { return e.Err.Error() }
func (e *QueryError) Unwrap() error { return e.Err }

func Validate(in Input) error {
	if len([]rune(strings.TrimSpace(in.Name))) < 1 || len([]rune(in.Name)) > 64 {
		return &InputError{"invalid_request", "岗位名称长度无效"}
	}
	if len(in.Code) < 1 || len(in.Code) > 64 || !validation.BusinessCode(in.Code) {
		return &InputError{"invalid_request", "岗位编码只能包含字母、数字和下划线"}
	}
	if in.Status != "enabled" && in.Status != "disabled" {
		return &InputError{"invalid_request", "岗位状态无效"}
	}
	if in.Remark != nil && len([]rune(*in.Remark)) > 256 {
		return &InputError{"invalid_request", "备注过长"}
	}
	return nil
}

type Page struct {
	List     []contracts.Position `json:"list"`
	Total    int                  `json:"total"`
	Page     int                  `json:"page"`
	PageSize int                  `json:"pageSize"`
}

func View(row *ent.Position, count int) contracts.Position {
	return contracts.Position{Id: row.ID, Name: row.Name, Code: row.Code, Sort: row.Sort,
		Status: contracts.PositionStatus(row.Status), Remark: row.Remark, UserCount: &count,
		CreatedAt: row.CreatedAt.Format(time.RFC3339Nano), UpdatedAt: row.UpdatedAt.Format(time.RFC3339Nano)}
}

func (s *Service) Scoped(ctx context.Context, id int) (*ent.Position, error) {
	return s.store.Client.Position.Query().Where(position.IDEQ(id), position.IDGT(0)).Only(ctx)
}

func (s *Service) query(filter Filter) (*ent.PositionQuery, error) {
	q := s.store.Client.Position.Query().Where(position.IDGT(0))
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		q = q.Where(position.Or(position.NameContainsFold(keyword), position.CodeContainsFold(keyword)))
	}
	if filter.Status != "" {
		if filter.Status != "enabled" && filter.Status != "disabled" {
			return nil, &InputError{"invalid_status", "状态无效"}
		}
		q = q.Where(position.StatusEQ(filter.Status))
	}
	if filter.Start != nil {
		q = q.Where(position.CreatedAtGTE(*filter.Start))
	}
	if filter.End != nil {
		q = q.Where(position.CreatedAtLTE(*filter.End))
	}
	return q.Order(ent.Asc(position.FieldSort), ent.Desc(position.FieldID)), nil
}

func (s *Service) Summary(ctx context.Context, p *security.Principal, row *ent.Position) (contracts.Position, error) {
	view := View(row, 0)
	preview := []contracts.UserPreview{}
	view.UserPreview = &preview
	ids, err := s.store.Client.UserPosition.Query().Where(userposition.PositionIDEQ(row.ID)).Select(userposition.FieldUserID).Ints(ctx)
	if err != nil || len(ids) == 0 {
		return view, err
	}
	scope, err := s.access.UserDataPredicate(ctx, p)
	if err != nil {
		return view, err
	}
	query := s.store.Client.User.Query().Where(user.IDIn(ids...), user.IDGT(0))
	if scope != nil {
		query = query.Where(scope)
	}
	count, err := query.Clone().Count(ctx)
	if err != nil {
		return view, err
	}
	view.UserCount = &count
	members, err := query.Select(user.FieldID, user.FieldNickname, user.FieldAvatar).Order(ent.Asc(user.FieldID)).Limit(5).All(ctx)
	if err != nil {
		return view, err
	}
	for _, account := range members {
		preview = append(preview, contracts.UserPreview{Id: account.ID, Nickname: account.Nickname, Avatar: account.Avatar})
	}
	return view, nil
}

func (s *Service) List(ctx context.Context, p *security.Principal, filter Filter, page, size int) (Page, error) {
	result := Page{List: []contracts.Position{}, Page: page, PageSize: size}
	if page < 1 || size < 1 || size > 200 {
		return result, &InputError{"invalid_page", "无效分页参数"}
	}
	query, err := s.query(filter)
	if err != nil {
		return result, err
	}
	result.Total, err = query.Clone().Count(ctx)
	if err != nil {
		return result, err
	}
	rows, err := query.Offset((page - 1) * size).Limit(size).All(ctx)
	if err != nil {
		return result, err
	}
	for _, row := range rows {
		view, err := s.Summary(ctx, p, row)
		if err != nil {
			return result, err
		}
		result.List = append(result.List, view)
	}
	return result, nil
}

func (s *Service) All(ctx context.Context, p *security.Principal) ([]contracts.Position, error) {
	rows, err := s.store.Client.Position.Query().Where(position.IDGT(0)).Order(ent.Asc(position.FieldSort)).All(ctx)
	if err != nil {
		return nil, err
	}
	list := []contracts.Position{}
	for _, row := range rows {
		view, err := s.Summary(ctx, p, row)
		if err != nil {
			return nil, err
		}
		list = append(list, view)
	}
	return list, nil
}

func (s *Service) Detail(ctx context.Context, p *security.Principal, id int) (contracts.Position, error) {
	row, err := s.Scoped(ctx, id)
	if err != nil {
		return contracts.Position{}, err
	}
	return s.Summary(ctx, p, row)
}

func audit(ctx context.Context, tx *ent.Tx, actor security.Actor, operation string, id int) error {
	return tx.AuditLog.Create().SetActorID(actor.UserID).SetRequestID(actor.RequestID).SetOperation(operation).SetResource("positions").SetResourceID(id).Exec(ctx)
}

func (s *Service) Create(ctx context.Context, actor security.Actor, in Input) (contracts.Position, error) {
	if err := Validate(in); err != nil {
		return contracts.Position{}, err
	}
	var saved *ent.Position
	err := s.store.WithTx(ctx, func(tx *ent.Tx) error {
		create := tx.Position.Create().SetName(in.Name).SetCode(in.Code).SetSort(in.Sort).SetStatus(in.Status)
		if in.Remark != nil {
			create.SetRemark(*in.Remark)
		}
		var err error
		saved, err = create.Save(ctx)
		if err != nil {
			return err
		}
		return audit(ctx, tx, actor, "create", saved.ID)
	})
	if err != nil {
		return contracts.Position{}, err
	}
	return View(saved, 0), nil
}

func (s *Service) Update(ctx context.Context, p *security.Principal, actor security.Actor, id int, patch map[string]json.RawMessage) (contracts.Position, error) {
	if len(patch) == 0 {
		return contracts.Position{}, &InputError{"invalid_request", "更新内容不能为空"}
	}
	for key := range patch {
		if key != "name" && key != "code" && key != "sort" && key != "status" && key != "remark" {
			return contracts.Position{}, &InputError{"invalid_request", "未知字段"}
		}
	}
	var saved *ent.Position
	err := s.store.WithTx(ctx, func(tx *ent.Tx) error {
		current, err := tx.Position.Query().Where(position.IDEQ(id), position.IDGT(0)).Only(ctx)
		if err != nil {
			return err
		}
		in := Input{Name: current.Name, Code: current.Code, Sort: current.Sort, Status: current.Status, Remark: current.Remark}
		fields := map[string]any{"name": &in.Name, "code": &in.Code, "sort": &in.Sort, "status": &in.Status, "remark": &in.Remark}
		for key, raw := range patch {
			if err := json.Unmarshal(raw, fields[key]); err != nil {
				return err
			}
		}
		if err := Validate(in); err != nil {
			return err
		}
		update := tx.Position.UpdateOneID(id).SetName(in.Name).SetCode(in.Code).SetSort(in.Sort).SetStatus(in.Status)
		if in.Remark == nil {
			update.ClearRemark()
		} else {
			update.SetRemark(*in.Remark)
		}
		saved, err = update.Save(ctx)
		if err != nil {
			return err
		}
		return audit(ctx, tx, actor, "update", id)
	})
	if err != nil {
		return contracts.Position{}, err
	}
	view, err := s.Summary(ctx, p, saved)
	if err != nil {
		return view, &QueryError{err}
	}
	return view, nil
}

func (s *Service) Delete(ctx context.Context, p *security.Principal, actor security.Actor, id int) error {
	return s.store.WithTx(ctx, func(tx *ent.Tx) error {
		row, err := tx.Position.Query().Where(position.IDEQ(id), position.IDGT(0)).Only(ctx)
		if err != nil {
			return err
		}
		if err = tx.Position.DeleteOne(row).Exec(ctx); err != nil {
			return err
		}
		if err := s.access.SyncDynamicGroups(ctx, tx, p); err != nil {
			return err
		}
		return audit(ctx, tx, actor, "delete", id)
	})
}

func (s *Service) DeleteBatch(ctx context.Context, p *security.Principal, actor security.Actor, ids []int) error {
	if len(ids) == 0 || len(ids) > 200 {
		return &InputError{"invalid_ids", "请选择 1 到 200 个岗位"}
	}
	seen := map[int]bool{}
	for _, id := range ids {
		if id < 1 || seen[id] {
			return &InputError{"invalid_ids", "岗位 ID 无效或重复"}
		}
		seen[id] = true
	}
	return s.store.WithTx(ctx, func(tx *ent.Tx) error {
		rows, err := tx.Position.Query().Where(position.IDIn(ids...), position.IDGT(0)).All(ctx)
		if err != nil {
			return err
		}
		if len(rows) != len(ids) {
			return &ent.NotFoundError{}
		}
		for _, row := range rows {
			if err := tx.Position.DeleteOne(row).Exec(ctx); err != nil {
				return err
			}
			if err := audit(ctx, tx, actor, "delete", row.ID); err != nil {
				return err
			}
		}
		return s.access.SyncDynamicGroups(ctx, tx, p)
	})
}

// ExportBatch uses the same filters and ordering as the list and bounded memory.
func (s *Service) ExportBatch(ctx context.Context, filter Filter, offset, size int) ([][]string, error) {
	query, err := s.query(filter)
	if err != nil {
		return nil, err
	}
	rows, err := query.Offset(offset).Limit(size).All(ctx)
	if err != nil {
		return nil, err
	}
	result := make([][]string, 0, len(rows))
	for _, row := range rows {
		remark := ""
		if row.Remark != nil {
			remark = *row.Remark
		}
		result = append(result, []string{fmt.Sprint(row.ID), row.Name, row.Code, fmt.Sprint(row.Sort), row.Status, remark, row.CreatedAt.Format(time.RFC3339)})
	}
	return result, nil
}

func IsNotFound(err error) bool { return ent.IsNotFound(err) }
