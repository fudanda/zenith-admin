//go:build integration

package arcbase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/fudanda/arcbase/backend/ent/auditlog"
	"github.com/fudanda/arcbase/backend/ent/user"
	"github.com/fudanda/arcbase/backend/internal/modules/transfers"
	"github.com/xuri/excelize/v2"
)

func importWorkbook(t *testing.T, rows [][]string) []byte {
	t.Helper()
	book := excelize.NewFile()
	defer book.Close()
	all := append([][]string{transfers.UserImportHeaders}, rows...)
	for i, row := range all {
		cells := make([]any, len(row))
		for j, cell := range row {
			cells[j] = cell
		}
		axis, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := book.SetSheetRow("Sheet1", axis, &cells); err != nil {
			t.Fatal(err)
		}
	}
	var buf bytes.Buffer
	if err := book.Write(&buf); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
func TestSynchronousTransfers(t *testing.T) {
	a := newAPIFixture(t)
	a.expect(a.adminResponse("GET", "/api/v1/foundation/imports/users/template", nil), 200)
	workbook := importWorkbook(t, [][]string{{"xlsx_user", "XLSX", "xlsx@example.test", "StrongPass123!", "", "", "", "enabled"}, {"bad_user", "invalid", "bad-email", "short", "", "", "", "enabled"}, {"xlsx_user", "duplicate", "", "StrongPass123!", "", "", "", "enabled"}})
	send := func(dry, duplicate string) transfers.ImportResult {
		res := a.multipart("/api/v1/foundation/imports/users", "file", "users.xlsx", workbook, map[string]string{"dryRun": dry, "duplicate": duplicate}, a.cookie, a.csrf)
		a.expect(res, 200)
		var envelope struct{ Data transfers.ImportResult }
		if err := json.Unmarshal(res.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		return envelope.Data
	}
	dry := send("true", "error")
	if !dry.DryRun || dry.Success != 1 || dry.Failed != 2 {
		t.Fatalf("dry run: %+v", dry)
	}
	exists, err := a.f.Store.Client.User.Query().Where(user.UsernameEQ("xlsx_user")).Exist(context.Background())
	if err != nil || exists {
		t.Fatal("preflight wrote users", err)
	}
	applied := send("false", "skip")
	if applied.Success != 1 || applied.Skipped != 1 || applied.Failed != 1 {
		t.Fatalf("apply: %+v", applied)
	}
	send("false", "update")
	account, _ := a.f.Store.Client.User.Query().Where(user.UsernameEQ("xlsx_user")).Only(context.Background())
	a.expect(a.adminResponse("GET", fmt.Sprintf("/api/v1/platform/entities/identity.user/%d/relations", account.ID), nil), 200)
	a.expect(a.adminResponse("GET", fmt.Sprintf("/api/v1/platform/entities/identity.user/%d/relations/identity.user.audit?limit=5", account.ID), nil), 200)
	logs, err := a.f.Store.Client.AuditLog.Query().Where(auditlog.OperationEQ("import")).All(context.Background())
	if err != nil || len(logs) != 2 {
		t.Fatal("transactional import audit", len(logs), err)
	}
	for _, log := range logs {
		serialized, _ := json.Marshal(log)
		if bytes.Contains(serialized, []byte("StrongPass")) {
			t.Fatal("password in audit")
		}
	}
	csv := a.adminResponse("GET", "/api/v1/foundation/exports/system.users?format=csv&keyword=xlsx_user", nil)
	a.expect(csv, 200)
	if !bytes.Contains(csv.Body.Bytes(), []byte("xlsx_user")) || bytes.Contains(csv.Body.Bytes(), []byte("integration-admin")) {
		t.Fatal("CSV filtering changed")
	}
	xlsx := a.adminResponse("GET", "/api/v1/foundation/exports/system.users?format=xlsx&keyword=xlsx_user", nil)
	a.expect(xlsx, 200)
	book, err := excelize.OpenReader(bytes.NewReader(xlsx.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	defer book.Close()
	rows, err := book.GetRows("Sheet1")
	if err != nil || len(rows) != 2 || rows[1][1] != "xlsx_user" {
		t.Fatal("XLSX filtering changed", rows, err)
	}
	cookie, csrf := a.login("xlsx_user", "StrongPass123!", "192.0.2.20")
	a.expect(a.call("GET", "/api/v1/foundation/exports/system.users?format=xlsx", nil, cookie, csrf, "192.0.2.20"), 403)
	a.expect(a.multipart("/api/v1/foundation/imports/users", "file", "users.xlsx", workbook, map[string]string{"dryRun": "false", "duplicate": "error"}, cookie, csrf), 403)
	a.expect(a.multipart("/api/v1/foundation/imports/users", "file", "users.xlsx", workbook, map[string]string{"dryRun": "false", "duplicate": "error"}, a.cookie, ""), 403)
}
