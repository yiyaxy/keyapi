package service

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

type IpGeoInfo struct {
	IP       string  `json:"ip"`
	Country  string  `json:"country"`
	Region   string  `json:"region"`
	City     string  `json:"city"`
	ISP      string  `json:"isp"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Timezone string  `json:"timezone"`
}

type cacheEntry struct {
	info      *IpGeoInfo
	expireAt  time.Time
}

var (
	ipGeoCache   sync.Map
	cacheTTL     = 24 * time.Hour
	geoHttpClient = &http.Client{Timeout: 5 * time.Second}
)

// isPrivateIP returns true for RFC1918, loopback, and link-local addresses.
func isPrivateIP(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return true
	}
	privateRanges := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"127.0.0.0/8",
		"::1/128",
		"fc00::/7",
		"fe80::/10",
	}
	for _, cidr := range privateRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(parsed) {
			return true
		}
	}
	return false
}

// LookupIP performs a synchronous IP geolocation lookup with caching.
func LookupIP(ip string) (*IpGeoInfo, error) {
	if isPrivateIP(ip) {
		return &IpGeoInfo{IP: ip, Country: "Private", Region: "LAN", City: "LAN"}, nil
	}

	// Check memory cache
	if entry, ok := ipGeoCache.Load(ip); ok {
		cached := entry.(*cacheEntry)
		if time.Now().Before(cached.expireAt) {
			return cached.info, nil
		}
		ipGeoCache.Delete(ip)
	}

	// Check Redis cache
	if common.RedisEnabled {
		val, err := common.RedisGet("ip_geo:" + ip)
		if err == nil && val != "" {
			var info IpGeoInfo
			if json.Unmarshal([]byte(val), &info) == nil {
				ipGeoCache.Store(ip, &cacheEntry{info: &info, expireAt: time.Now().Add(cacheTTL)})
				return &info, nil
			}
		}
	}

	// Query from sources
	info, err := queryGeoFromSources(ip)
	if err != nil {
		return nil, err
	}

	// Store in memory cache
	ipGeoCache.Store(ip, &cacheEntry{info: info, expireAt: time.Now().Add(cacheTTL)})

	// Store in Redis cache
	if common.RedisEnabled {
		data, err := json.Marshal(info)
		if err != nil {
			common.SysError(fmt.Sprintf("failed to marshal IP geo info: %v", err))
		} else {
			_ = common.RedisSet("ip_geo:"+ip, string(data), cacheTTL)
		}
	}

	return info, nil
}

// LookupIPAsync performs an async IP lookup and updates the database records.
func LookupIPAsync(ip string) {
	if isPrivateIP(ip) {
		return
	}
	gopool.Go(func() {
		info, err := LookupIP(ip)
		if err != nil {
			common.SysError(fmt.Sprintf("async IP lookup failed for %s: %v", ip, err))
			return
		}
		data, err := json.Marshal(info)
		if err != nil {
			common.SysError(fmt.Sprintf("failed to marshal IP geo info for async update: %v", err))
			return
		}
		model.UpdateIpLocation(ip, string(data))
	})
}

type geoSource struct {
	name  string
	url   func(ip string) string
	parse func(body []byte) (*IpGeoInfo, error)
}

var geoSources = []geoSource{
	{
		name: "ipapi.co",
		url:  func(ip string) string { return fmt.Sprintf("https://ipapi.co/%s/json/", ip) },
		parse: func(body []byte) (*IpGeoInfo, error) {
			var resp struct {
				IP       string  `json:"ip"`
				Country  string  `json:"country_name"`
				Region   string  `json:"region"`
				City     string  `json:"city"`
				Org      string  `json:"org"`
				Lat      float64 `json:"latitude"`
				Lng      float64 `json:"longitude"`
				Timezone string  `json:"timezone"`
				Error    bool    `json:"error"`
			}
			if err := json.Unmarshal(body, &resp); err != nil {
				return nil, err
			}
			if resp.Error {
				return nil, fmt.Errorf("ipapi.co returned error")
			}
			return &IpGeoInfo{
				IP: resp.IP, Country: resp.Country, Region: resp.Region,
				City: resp.City, ISP: resp.Org, Lat: resp.Lat, Lng: resp.Lng, Timezone: resp.Timezone,
			}, nil
		},
	},
	{
		name: "ipwhois.app",
		url:  func(ip string) string { return fmt.Sprintf("https://ipwhois.app/json/%s", ip) },
		parse: func(body []byte) (*IpGeoInfo, error) {
			var resp struct {
				IP       string  `json:"ip"`
				Country  string  `json:"country"`
				Region   string  `json:"region"`
				City     string  `json:"city"`
				ISP      string  `json:"isp"`
				Lat      float64 `json:"latitude"`
				Lng      float64 `json:"longitude"`
				Timezone string  `json:"timezone"`
				Success  bool    `json:"success"`
			}
			if err := json.Unmarshal(body, &resp); err != nil {
				return nil, err
			}
			if !resp.Success {
				return nil, fmt.Errorf("ipwhois returned failure")
			}
			return &IpGeoInfo{
				IP: resp.IP, Country: resp.Country, Region: resp.Region,
				City: resp.City, ISP: resp.ISP, Lat: resp.Lat, Lng: resp.Lng, Timezone: resp.Timezone,
			}, nil
		},
	},
	{
		name: "realip.cc",
		url:  func(ip string) string { return fmt.Sprintf("https://realip.cc/%s", ip) },
		parse: func(body []byte) (*IpGeoInfo, error) {
			var resp struct {
				IP       string `json:"ip"`
				Country  string `json:"country"`
				Province string `json:"province"`
				City     string `json:"city"`
				ISP      string `json:"isp"`
			}
			if err := json.Unmarshal(body, &resp); err != nil {
				return nil, err
			}
			if resp.IP == "" {
				return nil, fmt.Errorf("realip.cc returned empty IP")
			}
			return &IpGeoInfo{
				IP: resp.IP, Country: resp.Country, Region: resp.Province,
				City: resp.City, ISP: resp.ISP,
			}, nil
		},
	},
	{
		name: "ip.sb",
		url:  func(ip string) string { return fmt.Sprintf("https://api.ip.sb/geoip/%s", ip) },
		parse: func(body []byte) (*IpGeoInfo, error) {
			var resp struct {
				IP       string  `json:"ip"`
				Country  string  `json:"country"`
				Region   string  `json:"region"`
				City     string  `json:"city"`
				ISP      string  `json:"isp"`
				Lat      float64 `json:"latitude"`
				Lng      float64 `json:"longitude"`
				Timezone string  `json:"timezone"`
			}
			if err := json.Unmarshal(body, &resp); err != nil {
				return nil, err
			}
			if resp.IP == "" {
				return nil, fmt.Errorf("ip.sb returned empty IP")
			}
			return &IpGeoInfo{
				IP: resp.IP, Country: resp.Country, Region: resp.Region,
				City: resp.City, ISP: resp.ISP, Lat: resp.Lat, Lng: resp.Lng, Timezone: resp.Timezone,
			}, nil
		},
	},
	{
		// NOTE: ip-api.com free tier only supports HTTP (not HTTPS)
		name: "ip-api.com",
		url:  func(ip string) string { return fmt.Sprintf("http://ip-api.com/json/%s", ip) },
		parse: func(body []byte) (*IpGeoInfo, error) {
			var resp struct {
				Status   string  `json:"status"`
				Country  string  `json:"country"`
				Region   string  `json:"regionName"`
				City     string  `json:"city"`
				ISP      string  `json:"isp"`
				Lat      float64 `json:"lat"`
				Lng      float64 `json:"lon"`
				Timezone string  `json:"timezone"`
				Query    string  `json:"query"`
			}
			if err := json.Unmarshal(body, &resp); err != nil {
				return nil, err
			}
			if resp.Status != "success" {
				return nil, fmt.Errorf("ip-api returned status: %s", resp.Status)
			}
			return &IpGeoInfo{
				IP: resp.Query, Country: resp.Country, Region: resp.Region,
				City: resp.City, ISP: resp.ISP, Lat: resp.Lat, Lng: resp.Lng, Timezone: resp.Timezone,
			}, nil
		},
	},
}

func queryGeoFromSources(ip string) (*IpGeoInfo, error) {
	var lastErr error
	for _, source := range geoSources {
		info, err := queryGeoSource(source, ip)
		if err == nil {
			return info, nil
		}
		lastErr = err
		common.SysLog(fmt.Sprintf("IP geo source %s failed for %s: %v", source.name, ip, err))
	}
	return nil, fmt.Errorf("all geo sources failed for %s: %v", ip, lastErr)
}

func queryGeoSource(source geoSource, ip string) (*IpGeoInfo, error) {
	url := source.url(ip)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")

	resp, err := geoHttpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from %s", resp.StatusCode, source.name)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	// Trim BOM if present
	body = []byte(strings.TrimPrefix(string(body), "\xef\xbb\xbf"))

	return source.parse(body)
}
