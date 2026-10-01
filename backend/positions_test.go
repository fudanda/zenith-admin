package zenith

import "testing"

func TestCSVCellEscapesFormulas(t *testing.T) {
	for input, want := range map[string]string{
		"=1+1":      "'=1+1",
		"  @SUM(1)": "'  @SUM(1)",
		"\t+cmd":    "'\t+cmd",
		"-2":        "'-2",
		"normal":    "normal",
	} {
		if got := csvCell(input); got != want {
			t.Errorf("csvCell(%q) = %q, want %q", input, got, want)
		}
	}
}
