package positions

import (
	"context"
	"strings"
	"time"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/ent/user"
	"github.com/fudanda/arcbase/backend/ent/userposition"
	"github.com/fudanda/arcbase/backend/internal/security"
)

func (s *Service) memberView(ctx context.Context, account *ent.User, joinedAt time.Time) map[string]any {
	var departmentName *string
	if account.DepartmentID != nil {
		if department, err := s.store.Client.Department.Get(ctx, *account.DepartmentID); err == nil {
			departmentName = &department.Name
		}
	}
	return map[string]any{"id": account.ID, "username": account.Username, "nickname": account.Nickname,
		"email": account.Email, "avatar": account.Avatar, "departmentName": departmentName, "joinedAt": joinedAt.Format(time.RFC3339Nano)}
}

func (s *Service) Members(ctx context.Context, p *security.Principal, id int, keyword string) ([]map[string]any, error) {
	if _, err := s.Scoped(ctx, id); err != nil {
		return nil, err
	}
	links, err := s.store.Client.UserPosition.Query().Where(userposition.PositionIDEQ(id)).All(ctx)
	if err != nil {
		return nil, err
	}
	scope, err := s.access.UserDataPredicate(ctx, p)
	if err != nil {
		return nil, err
	}
	result := []map[string]any{}
	keyword = strings.ToLower(strings.TrimSpace(keyword))
	for _, link := range links {
		q := s.store.Client.User.Query().Where(user.IDEQ(link.UserID), user.IDGT(0))
		if scope != nil {
			q = q.Where(scope)
		}
		account, err := q.Only(ctx)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if keyword != "" && !strings.Contains(strings.ToLower(account.Username+" "+account.Nickname), keyword) {
			continue
		}
		result = append(result, s.memberView(ctx, account, link.CreatedAt))
	}
	return result, nil
}

func (s *Service) SetMembers(ctx context.Context, p *security.Principal, actor security.Actor, id int, ids []int) error {
	if ids == nil || len(ids) > 5000 {
		return &InputError{"invalid_request", "成员列表无效"}
	}
	scope, err := s.access.UserDataPredicate(ctx, p)
	if err != nil {
		return &QueryError{err}
	}
	seen := map[int]bool{}
	for _, id := range ids {
		if id < 1 || seen[id] {
			return &InputError{"invalid_request", "成员 ID 无效或重复"}
		}
		seen[id] = true
		q := s.store.Client.User.Query().Where(user.IDEQ(id), user.IDGT(0))
		if scope != nil {
			q = q.Where(scope)
		}
		if _, err := q.Only(ctx); err != nil {
			return &InputError{"invalid_user", "用户不在可管理范围"}
		}
	}
	return s.store.WithTx(ctx, func(tx *ent.Tx) error {
		if _, err := tx.Position.Get(ctx, id); err != nil {
			return err
		}
		for _, id := range ids {
			if _, err := tx.User.Get(ctx, id); err != nil {
				return err
			}
		}
		// Preserve assignments the operator cannot see in the original selector.
		visible := tx.User.Query().Where(user.IDGT(0))
		if scope != nil {
			visible = visible.Where(scope)
		}
		visibleIDs, err := visible.IDs(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.UserPosition.Delete().Where(userposition.PositionIDEQ(id), userposition.UserIDIn(visibleIDs...)).Exec(ctx); err != nil {
			return err
		}
		for _, userID := range ids {
			if err := tx.UserPosition.Create().SetPositionID(id).SetUserID(userID).Exec(ctx); err != nil {
				return err
			}
		}
		if err := s.access.SyncDynamicGroups(ctx, tx, p); err != nil {
			return err
		}
		return audit(ctx, tx, actor, "set_members", id)
	})
}
