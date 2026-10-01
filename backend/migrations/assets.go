// Package migrations embeds immutable SQL snapshots shared by both drivers.
package migrations

import "embed"

const SchemaVersion = 11

//go:embed *.sql sqlite/*.sql
var Files embed.FS
