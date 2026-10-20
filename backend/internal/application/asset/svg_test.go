package asset

import (
	"strings"
	"testing"
)

func TestSanitizeSVGRemovesWhatCanRunOrFetch(t *testing.T) {
	cases := map[string]struct {
		in         string
		gone       []string
		wantInside []string
	}{
		"script": {
			`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>`,
			[]string{"script", "alert"}, []string{"<rect"},
		},
		"foreignObject": {
			`<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://evil"/></foreignObject><circle r="1"/></svg>`,
			[]string{"foreignObject", "iframe", "evil"}, []string{"<circle"},
		},
		"onload and handlers": {
			`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect onclick="x()" width="2" height="2"/></svg>`,
			[]string{"onload", "onclick", "alert"}, []string{`width="2"`},
		},
		"external xlink:href": {
			`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://evil/x.svg#a"/><linearGradient id="g" xlink:href="https://evil/g"/></svg>`,
			[]string{"evil", "<use"}, []string{"linearGradient"},
		},
		"javascript href": {
			`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`,
			[]string{"javascript", "<a"}, nil,
		},
		"external url in fill and style": {
			`<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil/p)" style="background:url(//evil/x)" width="1" height="1"/></svg>`,
			[]string{"evil", "fill=", "style="}, []string{"<rect"},
		},
		"animate sets a handler": {
			`<svg xmlns="http://www.w3.org/2000/svg"><rect><set attributeName="onmouseover" to="alert(1)"/></rect></svg>`,
			[]string{"<set", "attributeName", "alert"}, []string{"<rect"},
		},
		"comment, pi and doctype": {
			`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "boom">]><!-- hi --><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`,
			[]string{"DOCTYPE", "ENTITY", "hi", "boom"}, []string{`d="M0 0"`},
		},
		"local references stay": {
			`<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="1" height="1"/></svg>`,
			nil, []string{`fill="url(#g)"`},
		},
	}
	for name, c := range cases {
		out, err := SanitizeSVG([]byte(c.in))
		if err != nil {
			t.Errorf("%s: unexpected error %v", name, err)
			continue
		}
		text := string(out)
		for _, bad := range c.gone {
			if strings.Contains(text, bad) {
				t.Errorf("%s: output still has %q: %s", name, bad, text)
			}
		}
		for _, good := range c.wantInside {
			if !strings.Contains(text, good) {
				t.Errorf("%s: output lost %q: %s", name, good, text)
			}
		}
	}
}

func TestSanitizeSVGBlocksStylesheetsThatFetch(t *testing.T) {
	in := `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil/a.css);</style></svg>`
	if _, err := SanitizeSVG([]byte(in)); err != ErrInvalidSVG {
		t.Fatalf("err = %v, want ErrInvalidSVG", err)
	}
}

func TestSanitizeSVGRejectsWhatIsNotSVG(t *testing.T) {
	for name, in := range map[string]string{
		"html":       `<html><body>hi</body></html>`,
		"broken":     `<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>`,
		"empty":      ``,
		"not xml":    `just words`,
		"wrong root": `<div xmlns="http://www.w3.org/2000/svg"/>`,
	} {
		if _, err := SanitizeSVG([]byte(in)); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
}

func TestLooksLikeSVG(t *testing.T) {
	if !looksLikeSVG([]byte("<?xml version=\"1.0\"?>\n<svg/>")) {
		t.Error("xml-prefixed svg not recognised")
	}
	if looksLikeSVG([]byte("<html><svg/></html>")) {
		t.Error("html with an svg inside taken for svg")
	}
}
