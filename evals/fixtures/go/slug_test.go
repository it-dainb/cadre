package slug

import "testing"

func TestSlug(t *testing.T) {
	if got := Slug(" Hello, World! "); got != "hello-world" {
		t.Fatal(got)
	}
}
