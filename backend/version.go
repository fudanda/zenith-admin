package arcbase

import "github.com/fudanda/arcbase/backend/internal/data"

// Set by release builds; development builds retain honest local metadata.
var Version = "2.58.0"
var Commit = "development"
var BuildTime = ""

const SchemaVersion = data.SchemaVersion
