package v1

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
)

const (
	isdnAPIBaseURL          = "https://isdn.jp"
	isdnSearchEngineName    = "isdn.jp"
	isdnMaxResponseBytes    = 1 << 20
	isdnMaxShortFieldRunes  = 255
	isdnMaxDescriptionRunes = 1000
)

type isdnResponse struct {
	XMLName xml.Name  `xml:"isdn"`
	Item    *isdnItem `xml:"item"`
}

// isdnItem intentionally models only the fields Homebox imports. encoding/xml
// ignores additional elements, keeping the lookup tolerant of schema additions.
type isdnItem struct {
	Key            string `xml:"key,attr"`
	DisplayISDN    string `xml:"disp-isdn"`
	Type           string `xml:"type"`
	ProductName    string `xml:"product-name"`
	PublisherName  string `xml:"publisher-name"`
	IssueDate      string `xml:"issue-date"`
	GenreName      string `xml:"genre-name"`
	GenreUser      string `xml:"genre-user"`
	ProductComment string `xml:"product-comment"`
	SampleImageURI string `xml:"sample-image-uri"`
}

func isValidISDNBarcode(barcode string) bool {
	if len(barcode) != 13 || (!strings.HasPrefix(barcode, "278") && !strings.HasPrefix(barcode, "279")) {
		return false
	}

	sum := 0
	for i := 0; i < 12; i++ {
		digit := barcode[i]
		if digit < '0' || digit > '9' {
			return false
		}

		weight := 1
		if i%2 == 1 {
			weight = 3
		}
		sum += int(digit-'0') * weight
	}

	checkDigit := barcode[12]
	if checkDigit < '0' || checkDigit > '9' {
		return false
	}

	expected := (10 - sum%10) % 10
	return int(checkDigit-'0') == expected
}

func truncateISDNField(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes])
}

func isAllowedISDNImageHost(host string) bool {
	host = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(host), "."))
	return host == isdnSearchEngineName || strings.HasSuffix(host, "."+isdnSearchEngineName)
}

func normalizeISDNImageURL(imageURL string) string {
	imageURL = strings.TrimSpace(imageURL)
	if imageURL == "" {
		return ""
	}

	u, err := url.Parse(imageURL)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Port() != "" {
		return ""
	}

	switch u.Scheme {
	case "http":
		u.Scheme = schemeHTTPS
	case schemeHTTPS:
	default:
		return ""
	}

	if !isAllowedISDNImageHost(u.Hostname()) {
		return ""
	}

	return u.String()
}

func buildISDNBarcodeProduct(iEan string, item isdnItem) (repo.BarcodeProduct, bool) {
	name := truncateISDNField(item.ProductName, isdnMaxShortFieldRunes)
	if name == "" {
		return repo.BarcodeProduct{}, false
	}

	descriptionParts := make([]string, 0, 4)
	if comment := strings.TrimSpace(item.ProductComment); comment != "" {
		descriptionParts = append(descriptionParts, comment)
	}
	if productType := strings.TrimSpace(item.Type); productType != "" {
		descriptionParts = append(descriptionParts, "形態: "+productType)
	}

	genreParts := make([]string, 0, 2)
	if genreName := strings.TrimSpace(item.GenreName); genreName != "" {
		genreParts = append(genreParts, genreName)
	}
	if genreUser := strings.TrimSpace(item.GenreUser); genreUser != "" {
		genreParts = append(genreParts, genreUser)
	}
	if len(genreParts) > 0 {
		descriptionParts = append(descriptionParts, "ジャンル: "+strings.Join(genreParts, " / "))
	}

	if issueDate := strings.TrimSpace(item.IssueDate); issueDate != "" {
		descriptionParts = append(descriptionParts, "発行日: "+issueDate)
	}

	var product repo.BarcodeProduct
	product.SearchEngineName = isdnSearchEngineName
	product.Barcode = iEan
	product.Item.Name = name
	product.Item.Description = truncateISDNField(strings.Join(descriptionParts, "\n"), isdnMaxDescriptionRunes)
	product.Manufacturer = truncateISDNField(item.PublisherName, isdnMaxShortFieldRunes)
	product.ModelNumber = truncateISDNField(item.DisplayISDN, isdnMaxShortFieldRunes)
	product.ImageURL = normalizeISDNImageURL(item.SampleImageURI)

	return product, true
}

func lookupISDN(baseURL string, iEan string) (products []repo.BarcodeProduct, err error) {
	if !isValidISDNBarcode(iEan) {
		return nil, nil
	}

	req, err := http.NewRequest(
		http.MethodGet,
		strings.TrimRight(baseURL, "/")+"/xml/"+url.PathEscape(iEan),
		nil,
	)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: barcodeHTTPTimeoutSec * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() {
		err = errors.Join(err, resp.Body.Close())
	}()

	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("isdn.jp API returned status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, isdnMaxResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > isdnMaxResponseBytes {
		return nil, fmt.Errorf("isdn.jp API response exceeds %d bytes", isdnMaxResponseBytes)
	}

	var result isdnResponse
	if err := xml.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("cannot unmarshal isdn.jp XML: %w", err)
	}
	if result.Item == nil {
		return nil, nil
	}
	if strings.TrimSpace(result.Item.Key) != iEan {
		return nil, fmt.Errorf("isdn.jp API returned item key %q for barcode %q", result.Item.Key, iEan)
	}

	product, ok := buildISDNBarcodeProduct(iEan, *result.Item)
	if !ok {
		return nil, nil
	}

	return []repo.BarcodeProduct{product}, nil
}
