package zenith

import (
	_ "embed"
	"encoding/json"
)

// The build derives these entries from the original shared menu seeds.
//
//go:embed internal/contracts/menus.json
var foundationMenuJSON []byte

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
