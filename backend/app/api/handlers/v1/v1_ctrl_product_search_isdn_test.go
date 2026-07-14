package v1

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"
)

const isdnSampleBarcode = "2784702901978"

func TestIsValidISDNBarcode(t *testing.T) {
	tests := map[string]struct {
		barcode string
		want    bool
	}{
		"official sample":       {barcode: isdnSampleBarcode, want: true},
		"valid 279 prefix":      {barcode: "2790000000008", want: true},
		"regular EAN":           {barcode: "4901234567894", want: false},
		"invalid check digit":   {barcode: "2784702901979", want: false},
		"non-digit in body":     {barcode: "278470290x978", want: false},
		"non-digit check digit": {barcode: "278470290197x", want: false},
		"too short":             {barcode: "278470290197", want: false},
		"too long":              {barcode: "27847029019780", want: false},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			if got := isValidISDNBarcode(tt.barcode); got != tt.want {
				t.Fatalf("isValidISDNBarcode(%q) = %v, want %v", tt.barcode, got, tt.want)
			}
		})
	}
}

func TestBuildISDNBarcodeProduct(t *testing.T) {
	product, ok := buildISDNBarcodeProduct(isdnSampleBarcode, isdnItem{
		DisplayISDN:    " ISDN278-4-702901-97-8 ",
		Type:           "同人誌",
		ProductName:    " みほん同人誌 ",
		PublisherName:  " 見本サークル ",
		IssueDate:      "2008-03-12",
		GenreName:      "評論・情報",
		GenreUser:      "技術",
		ProductComment: "コメント本文",
		SampleImageURI: "http://isdn.jp/images/thumbs/2784702901978.png",
	})

	if !ok {
		t.Fatal("expected product to be built")
	}
	if product.SearchEngineName != isdnSearchEngineName {
		t.Fatalf("unexpected search engine: %q", product.SearchEngineName)
	}
	if product.Barcode != isdnSampleBarcode {
		t.Fatalf("unexpected barcode: %q", product.Barcode)
	}
	if product.Item.Name != "みほん同人誌" {
		t.Fatalf("unexpected product name: %q", product.Item.Name)
	}
	if product.Manufacturer != "見本サークル" {
		t.Fatalf("unexpected manufacturer: %q", product.Manufacturer)
	}
	if product.ModelNumber != "ISDN278-4-702901-97-8" {
		t.Fatalf("unexpected model number: %q", product.ModelNumber)
	}

	wantDescription := "コメント本文\n形態: 同人誌\nジャンル: 評論・情報 / 技術\n発行日: 2008-03-12"
	if product.Item.Description != wantDescription {
		t.Fatalf("unexpected description:\n%q\nwant:\n%q", product.Item.Description, wantDescription)
	}
	if product.ImageURL != "https://isdn.jp/images/thumbs/2784702901978.png" {
		t.Fatalf("unexpected image URL: %q", product.ImageURL)
	}
}

func TestBuildISDNBarcodeProductRequiresName(t *testing.T) {
	_, ok := buildISDNBarcodeProduct(isdnSampleBarcode, isdnItem{PublisherName: "見本サークル"})
	if ok {
		t.Fatal("expected product without a name to be ignored")
	}
}

func TestBuildISDNBarcodeProductTruncatesImportedFields(t *testing.T) {
	longValue := strings.Repeat("あ", isdnMaxDescriptionRunes+100)
	product, ok := buildISDNBarcodeProduct(isdnSampleBarcode, isdnItem{
		ProductName:    longValue,
		PublisherName:  longValue,
		DisplayISDN:    longValue,
		ProductComment: longValue,
	})
	if !ok {
		t.Fatal("expected product to be built")
	}

	for field, value := range map[string]string{
		"name":         product.Item.Name,
		"manufacturer": product.Manufacturer,
		"model number": product.ModelNumber,
	} {
		if got := utf8.RuneCountInString(value); got != isdnMaxShortFieldRunes {
			t.Fatalf("%s has %d runes, want %d", field, got, isdnMaxShortFieldRunes)
		}
		if !utf8.ValidString(value) {
			t.Fatalf("%s is not valid UTF-8", field)
		}
	}

	if got := utf8.RuneCountInString(product.Item.Description); got != isdnMaxDescriptionRunes {
		t.Fatalf("description has %d runes, want %d", got, isdnMaxDescriptionRunes)
	}
	if !utf8.ValidString(product.Item.Description) {
		t.Fatal("description is not valid UTF-8")
	}
}

func TestNormalizeISDNImageURL(t *testing.T) {
	tests := map[string]struct {
		input string
		want  string
	}{
		"HTTPS":          {input: "https://isdn.jp/image.png", want: "https://isdn.jp/image.png"},
		"HTTP upgrade":   {input: "http://images.isdn.jp/image.png", want: "https://images.isdn.jp/image.png"},
		"untrusted host": {input: "https://example.com/image.png", want: ""},
		"suffix attack":  {input: "https://isdn.jp.example.com/image.png", want: ""},
		"userinfo":       {input: "https://user@isdn.jp/image.png", want: ""},
		"custom port":    {input: "https://isdn.jp:8443/image.png", want: ""},
		"unsupported":    {input: "ftp://isdn.jp/image.png", want: ""},
		"relative":       {input: "/images/image.png", want: ""},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			if got := normalizeISDNImageURL(tt.input); got != tt.want {
				t.Fatalf("normalizeISDNImageURL(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestLookupISDN(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("unexpected method: %s", r.Method)
		}
		if r.URL.Path != "/xml/"+isdnSampleBarcode {
			t.Errorf("unexpected request path: %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "text/xml;charset=utf-8")
		_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<isdn xmlns="https://isdn.jp/schemas/0.1">
  <item key="2784702901978">
    <disp-isdn>ISDN278-4-702901-97-8</disp-isdn>
    <type>同人誌</type>
    <product-name>みほん同人誌</product-name>
    <publisher-name>見本サークル</publisher-name>
    <issue-date>2008-03-12</issue-date>
    <genre-name>評論・情報</genre-name>
    <product-comment>見本コメント</product-comment>
    <sample-image-uri>https://isdn.jp/images/thumbs/2784702901978.png</sample-image-uri>
    <future-field>ignored</future-field>
  </item>
</isdn>`))
	}))
	defer server.Close()

	products, err := lookupISDN(server.URL, isdnSampleBarcode)
	if err != nil {
		t.Fatalf("unexpected lookup error: %v", err)
	}
	if len(products) != 1 {
		t.Fatalf("got %d products, want 1", len(products))
	}
	if products[0].Item.Name != "みほん同人誌" {
		t.Fatalf("unexpected product: %+v", products[0])
	}
}

func TestLookupISDNResponseHandling(t *testing.T) {
	tests := map[string]struct {
		status  int
		body    string
		wantErr bool
	}{
		"not found": {
			status: http.StatusNotFound,
		},
		"server error": {
			status:  http.StatusInternalServerError,
			wantErr: true,
		},
		"malformed XML": {
			status:  http.StatusOK,
			body:    `<isdn><item>`,
			wantErr: true,
		},
		"missing item": {
			status: http.StatusOK,
			body:   `<isdn xmlns="https://isdn.jp/schemas/0.1"></isdn>`,
		},
		"mismatched item key": {
			status:  http.StatusOK,
			body:    `<isdn><item key="2790000000008"><product-name>別作品</product-name></item></isdn>`,
			wantErr: true,
		},
		"missing product name": {
			status: http.StatusOK,
			body:   `<isdn><item key="2784702901978"><publisher-name>見本</publisher-name></item></isdn>`,
		},
	}

	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tt.status)
				_, _ = w.Write([]byte(tt.body))
			}))
			defer server.Close()

			products, err := lookupISDN(server.URL, isdnSampleBarcode)
			if (err != nil) != tt.wantErr {
				t.Fatalf("lookupISDN() error = %v, wantErr %v", err, tt.wantErr)
			}
			if len(products) != 0 {
				t.Fatalf("got %d products, want none", len(products))
			}
		})
	}
}

func TestLookupISDNRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("x", isdnMaxResponseBytes+1)))
	}))
	defer server.Close()

	_, err := lookupISDN(server.URL, isdnSampleBarcode)
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected response size error, got %v", err)
	}
}

func TestLookupISDNSkipsNonISDNBarcode(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	defer server.Close()

	products, err := lookupISDN(server.URL, "4901234567894")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(products) != 0 {
		t.Fatalf("got %d products, want none", len(products))
	}
	if called {
		t.Fatal("non-ISDN barcode triggered an HTTP request")
	}
}
