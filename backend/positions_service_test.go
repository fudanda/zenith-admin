package zenith

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/position"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/ent/userposition"
	"github.com/fudanda/zenith-admin/backend/internal/modules/organization/positions"
	"github.com/fudanda/zenith-admin/backend/internal/security"
)

type positionServiceAccess struct {
	scope     predicate.User
	syncError error
}

func (a *positionServiceAccess) UserDataPredicate(context.Context, *security.Principal) (predicate.User, error) {
	return a.scope, nil
}
func (a *positionServiceAccess) SyncDynamicGroups(context.Context, *ent.Tx, *security.Principal) error {
	return a.syncError
}

func TestPositionServiceWithoutHTTPPreservesScopeAndRollsBack(t *testing.T) {
	ctx := context.Background()
	store := sqliteStore(t)
	if err := store.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	visible, err := store.Client.User.Create().SetUsername("visible").SetNickname("Visible").SetPasswordHash("test-only").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	hidden, err := store.Client.User.Create().SetUsername("hidden").SetNickname("Hidden").SetPasswordHash("test-only").Save(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p := &security.Principal{User: visible}
	actor := security.Actor{UserID: visible.ID, RequestID: "domain-test"}
	access := &positionServiceAccess{scope: user.IDEQ(visible.ID)}
	service := positions.NewService(store.Store, access)
	remark := "preserve me"
	created, err := service.Create(ctx, actor, positions.Input{Name: "Original", Code: "DIRECT", Status: "enabled", Sort: 7, Remark: &remark})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Client.UserPosition.Create().SetUserID(hidden.ID).SetPositionID(created.Id).Exec(ctx); err != nil {
		t.Fatal(err)
	}
	if err := service.SetMembers(ctx, p, actor, created.Id, []int{visible.ID}); err != nil {
		t.Fatal(err)
	}
	if n, err := store.Client.UserPosition.Query().Where(userposition.PositionIDEQ(created.Id)).Count(ctx); err != nil || n != 2 {
		t.Fatalf("hidden membership lost: %d %v", n, err)
	}
	detail, err := service.Detail(ctx, p, created.Id)
	if err != nil || detail.UserCount == nil || *detail.UserCount != 1 || detail.UserPreview == nil || len(*detail.UserPreview) != 1 || (*detail.UserPreview)[0].Id != visible.ID {
		t.Fatalf("scope leak in summary: %+v %v", detail, err)
	}
	patched, err := service.Update(ctx, p, actor, created.Id, map[string]json.RawMessage{"name": json.RawMessage(`"Renamed"`)})
	if err != nil || patched.Sort != 7 || patched.Remark == nil || *patched.Remark != remark {
		t.Fatalf("omitted fields overwritten: %+v %v", patched, err)
	}
	cleared, err := service.Update(ctx, p, actor, created.Id, map[string]json.RawMessage{"remark": json.RawMessage(`null`)})
	if err != nil || cleared.Remark != nil {
		t.Fatalf("explicit null not applied: %+v %v", cleared, err)
	}
	auditCount, err := store.Client.AuditLog.Query().Count(ctx)
	if err != nil {
		t.Fatal(err)
	}
	access.syncError = errors.New("group synchronization failed")
	if err := service.SetMembers(ctx, p, actor, created.Id, []int{}); !errors.Is(err, access.syncError) {
		t.Fatalf("failed sync accepted: %v", err)
	}
	if n, _ := store.Client.UserPosition.Query().Where(userposition.PositionIDEQ(created.Id)).Count(ctx); n != 2 {
		t.Fatalf("members not rolled back: %d", n)
	}
	if n, _ := store.Client.AuditLog.Query().Count(ctx); n != auditCount {
		t.Fatal("failed transaction wrote audit")
	}
	if err := service.DeleteBatch(ctx, p, actor, []int{created.Id}); !errors.Is(err, access.syncError) {
		t.Fatalf("failed delete accepted: %v", err)
	}
	if exists, _ := store.Client.Position.Query().Where(position.IDEQ(created.Id)).Exist(ctx); !exists {
		t.Fatal("delete not rolled back")
	}
	// An audit write failure must roll back its accompanying business write.
	if _, err := store.DB.ExecContext(ctx, `CREATE TRIGGER reject_position_audit BEFORE INSERT ON audit_logs WHEN NEW.operation='create' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	_, err = service.Create(ctx, actor, positions.Input{Name: "Failed audit", Code: "ROLLBACK", Status: "enabled"})
	if err == nil {
		t.Fatal("failed audit accepted")
	}
	if exists, _ := store.Client.Position.Query().Where(position.CodeEQ("ROLLBACK")).Exist(ctx); exists {
		t.Fatal("write committed without audit")
	}
}
