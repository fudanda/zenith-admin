package zenith

import (
	"context"
	_ "embed"
	"encoding/json"

	"github.com/fudanda/zenith-admin/backend/ent"
	"github.com/fudanda/zenith-admin/backend/ent/dict"
	"github.com/fudanda/zenith-admin/backend/ent/dictitem"
)

//go:embed internal/contracts/dictionaries.json
var foundationDictionaryJSON []byte

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
