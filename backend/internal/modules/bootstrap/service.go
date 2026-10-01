package bootstrap

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/dict"
	"github.com/fudanda/zenith-admin/backend/ent/dictitem"
	"github.com/fudanda/zenith-admin/backend/ent/menu"
	"github.com/fudanda/zenith-admin/backend/ent/predicate"
	"github.com/fudanda/zenith-admin/backend/ent/role"
	"github.com/fudanda/zenith-admin/backend/ent/user"
	"github.com/fudanda/zenith-admin/backend/internal/contracts"
	"github.com/fudanda/zenith-admin/backend/internal/data"
	"golang.org/x/crypto/bcrypt"
)

type Dependencies struct {
	ValidatePassword func(ctx context.Context, password string) error
}

type Service struct {
	Store *data.Store
	deps  Dependencies
}

func NewService(store *data.Store, deps Dependencies) *Service {
	return &Service{Store: store, deps: deps}
}

var foundationMenuJSON = contracts.MenuSeed

type foundationMenu struct {
	ID, ParentID                                         int
	Name, Title, Type, Path, Permission, Component, Icon string
	Sort                                                 int
	Visible                                              bool
}

var foundationMenus = func() []foundationMenu {
	var result []foundationMenu
	if err := json.Unmarshal(foundationMenuJSON, &result); err != nil {
		panic(err)
	}
	return result
}()

var foundationDictionaryJSON = contracts.DictionarySeed

type foundationDictionary struct {
	Name, Code, Description string
	Items                   []struct {
		Label, Value, Status string
		Color                *string
		Sort                 int
	}
}

func seedFoundationDictionaries(ctx context.Context, tx *ent.Tx) error {
	var definitions []foundationDictionary
	if err := json.Unmarshal(foundationDictionaryJSON, &definitions); err != nil {
		return err
	}
	for _, definition := range definitions {
		row, err := tx.Dict.Query().Where(dict.CodeEQ(definition.Code)).Only(ctx)
		if ent.IsNotFound(err) {
			row, err = tx.Dict.Create().SetName(definition.Name).SetCode(definition.Code).SetDescription(definition.Description).SetStatus("enabled").Save(ctx)
		}
		if err != nil {
			return err
		}
		for _, item := range definition.Items {
			exists, err := tx.DictItem.Query().Where(dictitem.DictIDEQ(row.ID), dictitem.ValueEQ(item.Value)).Exist(ctx)
			if err != nil {
				return err
			}
			if !exists {
				if err := tx.DictItem.Create().SetDictID(row.ID).SetLabel(item.Label).SetValue(item.Value).SetNillableColor(item.Color).SetSort(item.Sort).SetStatus(item.Status).Exec(ctx); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func (f *Service) Seed(ctx context.Context) error {
	return f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		exists, err := tx.Role.Query().Where(role.CodeEQ("super_admin")).Exist(ctx)
		if err != nil {
			return err
		}
		if !exists {
			if err := tx.Role.Create().SetName("系统超级管理员").SetCode("super_admin").SetStatus("enabled").SetDataScope("all").Exec(ctx); err != nil {
				return err
			}
		}
		menuIDs := map[int]int{}
		legacyNames := map[string]bool{"home": true, "profile": true, "positions": true, "departments": true, "users": true, "roles": true, "menus": true, "user_groups": true, "dicts": true, "file_configs": true, "files": true, "file_settings": true, "login_logs": true, "operation_logs": true}
		for _, item := range foundationMenus {
			parentID := menuIDs[item.ParentID]
			if item.ParentID != 0 && parentID == 0 {
				return fmt.Errorf("menu parent %d missing", item.ParentID)
			}
			alternatives := []predicate.Menu{}
			if item.Name != "" {
				alternatives = append(alternatives, menu.NameEQ(item.Name))
			}
			if item.Type == "button" {
				alternatives = append(alternatives, menu.And(menu.TypeEQ("button"), menu.PermissionEQ(item.Permission), menu.ParentIDEQ(parentID)))
			}
			if item.Path != "" {
				alternatives = append(alternatives, menu.PathEQ(item.Path))
			}
			if item.Path == "/system/file-configs" {
				alternatives = append(alternatives, menu.NameEQ("file_configs"))
			}
			if item.Path == "/system/settings" {
				alternatives = append(alternatives, menu.NameEQ("file_settings"))
			}
			row, err := tx.Menu.Query().Where(menu.Or(alternatives...)).Order(ent.Asc(menu.FieldID)).First(ctx)
			if ent.IsNotFound(err) && item.Type == "button" && item.Permission != "" {
				// Upgrade legacy root buttons only if their intended parent has no
				// seed entry. A later custom button must not break repeat seeding.
				row, err = tx.Menu.Query().Where(menu.TypeEQ("button"), menu.PermissionEQ(item.Permission), menu.ParentIDEQ(0)).Order(ent.Asc(menu.FieldID)).First(ctx)
			}
			if err != nil && !ent.IsNotFound(err) {
				return err
			}
			if ent.IsNotFound(err) {
				create := tx.Menu.Create().SetTitle(item.Title).SetType(item.Type).SetSort(item.Sort).SetVisible(item.Visible).SetParentID(parentID)
				if item.Name != "" {
					create.SetName(item.Name)
				}
				if item.Path != "" {
					create.SetPath(item.Path)
				}
				if item.Component != "" {
					create.SetComponent(item.Component)
				}
				if item.Icon != "" {
					create.SetIcon(item.Icon)
				}
				if item.Permission != "" {
					create.SetPermission(item.Permission)
				}
				row, err = create.Save(ctx)
				if err != nil {
					return err
				}
			} else if row.Name == nil || legacyNames[*row.Name] || item.Type == "button" && row.ParentID == 0 {
				update := tx.Menu.UpdateOne(row).SetTitle(item.Title).SetType(item.Type).SetSort(item.Sort).SetVisible(item.Visible).SetParentID(parentID)
				if item.Name != "" {
					update.SetName(item.Name)
				} else {
					update.ClearName()
				}
				if item.Path != "" {
					update.SetPath(item.Path)
				}
				if item.Component != "" {
					update.SetComponent(item.Component)
				}
				if item.Icon != "" {
					update.SetIcon(item.Icon)
				}
				if item.Permission != "" {
					update.SetPermission(item.Permission)
				}
				row, err = update.Save(ctx)
				if err != nil {
					return err
				}
			}
			menuIDs[item.ID] = row.ID
		}
		return seedFoundationDictionaries(ctx, tx)
	})
}

func (f *Service) InitAdmin(ctx context.Context, username, password string) error {
	username = strings.TrimSpace(username)
	if len(username) < 3 || len(username) > 32 {
		return errors.New("username must contain 3-32 characters")
	}
	if err := f.deps.ValidatePassword(ctx, password); err != nil {
		return err
	}
	if err := f.Seed(ctx); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return f.Store.WithTx(ctx, func(tx *ent.Tx) error {
		exists, err := tx.User.Query().Where(user.UsernameEQ(username)).Exist(ctx)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("user %q already exists", username)
		}
		r, err := tx.Role.Query().Where(role.CodeEQ("super_admin")).Only(ctx)
		if err != nil {
			return err
		}
		u, err := tx.User.Create().SetUsername(username).SetNickname(username).SetPasswordHash(string(hash)).SetStatus("enabled").Save(ctx)
		if err != nil {
			return err
		}
		return tx.UserRole.Create().SetUserID(u.ID).SetRoleID(r.ID).Exec(ctx)
	})
}
