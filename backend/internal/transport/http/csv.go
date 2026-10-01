package httptransport

import (
	"encoding/csv"
	"log"
	"net/http"
	"strings"
)

// Query the first batch before committing a file response; later batches use
// bounded memory and flush progressively. All cells pass through csvCell.
func StreamCSV(w http.ResponseWriter, filename string, header []string, fetch func(int) ([][]string, error)) {
	const batchSize = 200
	rows, err := fetch(0)
	if err != nil {
		Fail(w, 503, "database_unavailable", "导出查询失败")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename="+filename)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write([]byte{0xef, 0xbb, 0xbf})
	writer := csv.NewWriter(w)
	if err := writer.Write(header); err != nil {
		log.Printf("%s header: %v", filename, err)
		return
	}
	for offset := 0; len(rows) != 0; offset += len(rows) {
		for _, row := range rows {
			for index := range row {
				row[index] = CSVCell(row[index])
			}
			if err := writer.Write(row); err != nil {
				log.Printf("%s row: %v", filename, err)
				return
			}
		}
		writer.Flush()
		if err := writer.Error(); err != nil {
			log.Printf("%s flush: %v", filename, err)
			return
		}
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		if len(rows) < batchSize {
			break
		}
		rows, err = fetch(offset + len(rows))
		if err != nil {
			exportFailed(w, err)
			log.Printf("%s query: %v", filename, err)
			return
		}
	}
	writer.Flush()
}

func CSVCell(value string) string {
	if trimmed := strings.TrimLeft(value, " \t\r\n"); trimmed != "" && strings.ContainsRune("=+-@", rune(trimmed[0])) {
		return "'" + value
	}
	return value
}

func exportFailed(w http.ResponseWriter, err error) {
	if observer, ok := w.(interface{ ExportFailed(error) }); ok {
		observer.ExportFailed(err)
	}
}
