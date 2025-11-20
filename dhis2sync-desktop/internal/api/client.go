package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/go-resty/resty/v2"
)

// Client represents a DHIS2 API client
type Client struct {
	baseURL   string
	username  string
	password  string
	http      *resty.Client
	nameCache map[string]string // Cache for org unit names
	cacheMu   sync.RWMutex
}

// NewClient creates a new DHIS2 API client
func NewClient(baseURL, username, password string) *Client {
	client := &Client{
		baseURL:   strings.TrimRight(baseURL, "/"),
		username:  username,
		password:  password,
		nameCache: make(map[string]string),
	}

	// Configure resty client
	client.http = resty.New().
		SetHeader("User-Agent", "python-requests/2.31.0"). // Masquerade as Python to avoid DHIS2 client discrimination
		SetBasicAuth(username, password).
		SetTimeout(600 * time.Second). // 10 minutes timeout for slow DHIS2 servers (async operations can take several minutes)
		SetRetryCount(3).
		SetRetryWaitTime(500 * time.Millisecond).
		SetRetryMaxWaitTime(2 * time.Second).
		AddRetryCondition(func(r *resty.Response, err error) bool {
			// Retry on 429 (Too Many Requests) and 5xx server errors
			return r.StatusCode() == 429 || (r.StatusCode() >= 500 && r.StatusCode() <= 504)
		})

	return client
}

// Get performs a GET request to the DHIS2 API
func (c *Client) Get(endpoint string, params map[string]string) (*resty.Response, error) {
	url := c.buildURL(endpoint)
	req := c.http.R()

	if params != nil {
		req.SetQueryParams(params)
	}

	return req.Get(url)
}

// Post performs a POST request to the DHIS2 API
func (c *Client) Post(endpoint string, payload interface{}) (*resty.Response, error) {
	url := c.buildURL(endpoint)
	return c.http.R().
		SetHeader("Content-Type", "application/json").
		SetBody(payload).
		Post(url)
}

// Delete performs a DELETE request to the DHIS2 API
func (c *Client) Delete(endpoint string, params map[string]string) (*resty.Response, error) {
	url := c.buildURL(endpoint)
	req := c.http.R()

	if params != nil {
		req.SetQueryParams(params)
	}

	return req.Delete(url)
}

// Put performs a PUT request to the DHIS2 API
func (c *Client) Put(endpoint string, payload interface{}) (*resty.Response, error) {
	url := c.buildURL(endpoint)
	return c.http.R().
		SetHeader("Content-Type", "application/json").
		SetBody(payload).
		Put(url)
}

// GetOrgUnitName retrieves the name of an organization unit (with caching)
func (c *Client) GetOrgUnitName(orgUnitID string) string {
	c.cacheMu.RLock()
	if name, exists := c.nameCache[orgUnitID]; exists {
		c.cacheMu.RUnlock()
		return name
	}
	c.cacheMu.RUnlock()

	// Fetch from API
	endpoint := fmt.Sprintf("api/organisationUnits/%s.json", orgUnitID)
	params := map[string]string{"fields": "id,name,displayName"}

	resp, err := c.Get(endpoint, params)
	if err != nil || !resp.IsSuccess() {
		// Fallback to ID if fetch fails
		c.cacheMu.Lock()
		c.nameCache[orgUnitID] = orgUnitID
		c.cacheMu.Unlock()
		return orgUnitID
	}

	var result struct {
		DisplayName string `json:"displayName"`
		Name        string `json:"name"`
	}

	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		c.cacheMu.Lock()
		c.nameCache[orgUnitID] = orgUnitID
		c.cacheMu.Unlock()
		return orgUnitID
	}

	name := result.DisplayName
	if name == "" {
		name = result.Name
	}
	if name == "" {
		name = orgUnitID
	}

	c.cacheMu.Lock()
	c.nameCache[orgUnitID] = name
	c.cacheMu.Unlock()

	return name
}

// ListPrograms lists tracker programs
func (c *Client) ListPrograms(params map[string]string) (*resty.Response, error) {
	defaultParams := map[string]string{
		"fields": "id,displayName,programType,version,programStages[id,displayName]",
		"paging": "false",
	}

	// Merge with provided params
	if params != nil {
		for k, v := range params {
			defaultParams[k] = v
		}
	}

	return c.Get("api/programs.json", defaultParams)
}

// buildURL constructs the full URL for an endpoint
func (c *Client) buildURL(endpoint string) string {
	endpoint = strings.TrimPrefix(endpoint, "/")
	return fmt.Sprintf("%s/%s", c.baseURL, endpoint)
}

// SetTimeout allows customizing the timeout for specific operations
func (c *Client) SetTimeout(timeout time.Duration) {
	c.http.SetTimeout(timeout)
}
