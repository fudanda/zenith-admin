package identity

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/fudanda/arcbase/backend/ent"
	"github.com/fudanda/arcbase/backend/ent/apikey"
	"github.com/fudanda/arcbase/backend/internal/contracts"
	"github.com/fudanda/arcbase/backend/internal/kernel"
)

func (f *Service) KeyPermissions(ctx context.Context, in kernel.Input) (kernel.Outcome, error) {
	p := kernel.FromContext(ctx)
	all, err := f.deps.Permissions(ctx, p)
	if err != nil {
		return kernel.Outcome{}, err
	}
	owned := map[string]bool{}
	for _, v := range all {
		owned[v] = true
	}
	set := map[string]bool{}
	for _, op := range contracts.Operations {
		if op.Permission == "authenticated" && op.APIKeyPermission != "" {
			op.Permission = op.APIKeyPermission
		}
		if op.APIKeyAllowed && op.Permission != "authenticated" && op.Permission != "" && (owned["*"] || owned[op.Permission]) {
			set[op.Permission] = true
		}
	}
	values := []string{}
	for v := range set {
		values = append(values, v)
	}
	sort.Strings(values)
	return kernel.Success(200, values)
}
func keyView(row *ent.APIKey) map[string]any {
	return map[string]any{"id": row.ID, "name": row.Name, "tokenPrefix": row.TokenPrefix, "permissions": row.Permissions, "expiresAt": row.ExpiresAt, "lastUsedAt": row.LastUsedAt, "createdAt": row.CreatedAt}
}
func (f *Service) ListKeys(ctx context.Context, in kernel.Input) (kernel.Outcome, error) {
	rows, err := f.Store.Client.APIKey.Query().Where(apikey.UserIDEQ(kernel.FromContext(ctx).User.ID), apikey.RevokedAtIsNil()).Order(ent.Desc(apikey.FieldID)).All(ctx)
	if err != nil {
		return kernel.Outcome{}, err
	}
	items := []any{}
	for _, row := range rows {
		items = append(items, keyView(row))
	}
	return kernel.Success(200, items)
}
func (f *Service) CreateKey(ctx context.Context, in kernel.Input) (kernel.Outcome, error) {
	var body struct {
		Name        string   `json:"name"`
		Permissions []string `json:"permissions"`
		ExpiresAt   string   `json:"expiresAt"`
	}
	if kernel.DecodeBody(in.Body, &body) != nil || strings.TrimSpace(body.Name) == "" || len([]rune(body.Name)) > 64 || len(body.Permissions) == 0 || len(body.Permissions) > 100 {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_key", "请选择 API Key 权限")
	}
	result, err := f.KeyPermissions(ctx, in)
	if err != nil {
		return kernel.Outcome{}, err
	}
	allowed := map[string]bool{}
	for _, v := range result.Data.([]string) {
		allowed[v] = true
	}
	selected := []string{}
	seen := map[string]bool{}
	for _, v := range body.Permissions {
		if !allowed[v] {
			return kernel.Outcome{}, kernel.Fail(403, "key_scope_denied", "不能授予此权限")
		}
		if !seen[v] {
			selected = append(selected, v)
			seen[v] = true
		}
	}
	var expiry *time.Time
	if body.ExpiresAt != "" {
		value, e := time.Parse(time.RFC3339, body.ExpiresAt)
		if e != nil || !value.After(time.Now()) {
			return kernel.Outcome{}, kernel.Fail(400, "invalid_expiry", "有效期无效")
		}
		expiry = &value
	}
	secret, err := kernel.Secret()
	if err != nil {
		return kernel.Outcome{}, err
	}
	token := "arc_" + secret
	p := kernel.FromContext(ctx)
	var row *ent.APIKey
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		// Serialize issuance for this owner; only the timestamp is touched.
		if err := tx.User.UpdateOneID(p.User.ID).SetUpdatedAt(time.Now()).Exec(ctx); err != nil {
			return err
		}
		count, err := tx.APIKey.Query().Where(apikey.UserIDEQ(p.User.ID), apikey.RevokedAtIsNil(), apikey.Or(apikey.ExpiresAtIsNil(), apikey.ExpiresAtGT(time.Now()))).Count(ctx)
		if err != nil {
			return err
		}
		if count >= 20 {
			return kernel.Fail(409, "key_limit", "最多保留 20 个有效 API Key")
		}
		row, err = tx.APIKey.Create().SetUserID(p.User.ID).SetName(strings.TrimSpace(body.Name)).SetTokenHash(kernel.Digest(token)).SetTokenPrefix(token[:12]).SetPermissions(selected).SetNillableExpiresAt(expiry).Save(ctx)
		if err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetOperation("create_api_key").SetResource("api_keys").SetResourceID(row.ID).SetRequestID(in.TraceID).Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, err
	}
	return kernel.Success(200, map[string]any{"id": row.ID, "name": row.Name, "token": token, "createdAt": row.CreatedAt})
}
func (f *Service) RevokeKey(ctx context.Context, in kernel.Input) (kernel.Outcome, error) {
	id, err := kernel.IntParam(in.Id)
	if err != nil {
		return kernel.Outcome{}, kernel.Fail(400, "invalid_id", "ID 无效")
	}
	p := kernel.FromContext(ctx)
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		count, err := tx.APIKey.Update().Where(apikey.IDEQ(id), apikey.UserIDEQ(p.User.ID), apikey.RevokedAtIsNil()).SetRevokedAt(time.Now()).Save(ctx)
		if err != nil {
			return err
		}
		if count == 0 {
			return kernel.Fail(404, "key_not_found", "API Key 不存在")
		}
		return tx.AuditLog.Create().SetActorID(p.User.ID).SetOperation("revoke_api_key").SetResource("api_keys").SetResourceID(id).SetRequestID(in.TraceID).Exec(ctx)
	})
	if err != nil {
		return kernel.Outcome{}, err
	}
	return kernel.Success(200, nil)
}
func (f *Service) AuthenticateKey(ctx context.Context, token string) (*kernel.Principal, error) {
	return f.authenticateKey(ctx, token, true)
}
func (f *Service) RevalidateKey(ctx context.Context, token string) (*kernel.Principal, error) {
	return f.authenticateKey(ctx, token, false)
}
func (f *Service) authenticateKey(ctx context.Context, token string, record bool) (*kernel.Principal, error) {
	if len(token) != 68 || (!strings.HasPrefix(token, "arc_") && !strings.HasPrefix(token, "zen_")) {
		return nil, kernel.ErrUnauthenticated
	}
	row, err := f.Store.Client.APIKey.Query().Where(apikey.TokenHashEQ(kernel.Digest(token))).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, kernel.ErrUnauthenticated
	}
	if err != nil {
		return nil, err
	}
	if row.RevokedAt != nil || row.ExpiresAt != nil && !row.ExpiresAt.After(time.Now()) {
		return nil, kernel.ErrUnauthenticated
	}
	account, err := f.Store.Client.User.Get(ctx, row.UserID)
	if ent.IsNotFound(err) {
		return nil, kernel.ErrUnauthenticated
	}
	if err != nil {
		return nil, err
	}
	if account.Status != "enabled" || account.PasswordUpdatedAt.After(row.CreatedAt) {
		return nil, kernel.ErrUnauthenticated
	}
	policy, err := f.SecurityPolicy(ctx)
	if err != nil {
		return nil, err
	}
	if policy.Password.ExpiryEnabled && account.PasswordUpdatedAt.AddDate(0, 0, policy.Password.ExpiryDays).Before(time.Now()) {
		return nil, kernel.ErrUnauthenticated
	}
	p := &kernel.Principal{User: account, APIKeyID: row.ID, KeyPermissions: row.Permissions}
	roles, err := f.deps.EffectiveRoleIDs(ctx, account.ID)
	if err != nil {
		return nil, err
	}
	for _, id := range roles {
		role, err := f.Store.Client.Role.Get(ctx, id)
		if ent.IsNotFound(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if role.Status == "enabled" && role.Code == "super_admin" {
			p.SuperAdmin = true
		}
	}
	if !record {
		return p, nil
	}
	err = f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		if err := tx.APIKey.UpdateOneID(row.ID).SetLastUsedAt(time.Now()).Exec(ctx); err != nil {
			return err
		}
		return tx.AuditLog.Create().SetActorID(account.ID).SetAPIKeyID(row.ID).SetOperation("api_key_authenticated").SetResource("api_keys").SetResourceID(row.ID).SetRequestID(kernel.TraceID(ctx)).Exec(ctx)
	})
	if err != nil {
		return nil, err
	}
	return p, nil
}
