package api

import (
	"container/list"
	"sync"
)

// lruCache implements a thread-safe LRU (Least Recently Used) cache
type lruCache struct {
	capacity int
	cache    map[string]*list.Element
	lru      *list.List
	mu       sync.RWMutex
}

// cacheEntry represents a key-value pair in the cache
type cacheEntry struct {
	key   string
	value string
}

// newLRUCache creates a new LRU cache with the specified capacity
func newLRUCache(capacity int) *lruCache {
	return &lruCache{
		capacity: capacity,
		cache:    make(map[string]*list.Element),
		lru:      list.New(),
	}
}

// Get retrieves a value from the cache
// Returns the value and true if found, empty string and false otherwise
func (c *lruCache) Get(key string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, exists := c.cache[key]; exists {
		// Move to front (most recently used)
		c.lru.MoveToFront(elem)
		return elem.Value.(*cacheEntry).value, true
	}
	return "", false
}

// Put adds or updates a value in the cache
func (c *lruCache) Put(key, value string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// If key exists, update and move to front
	if elem, exists := c.cache[key]; exists {
		c.lru.MoveToFront(elem)
		elem.Value.(*cacheEntry).value = value
		return
	}

	// Evict oldest if at capacity
	if c.lru.Len() >= c.capacity {
		oldest := c.lru.Back()
		if oldest != nil {
			c.lru.Remove(oldest)
			delete(c.cache, oldest.Value.(*cacheEntry).key)
		}
	}

	// Add new entry
	entry := &cacheEntry{key: key, value: value}
	elem := c.lru.PushFront(entry)
	c.cache[key] = elem
}

// Len returns the current number of items in the cache
func (c *lruCache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lru.Len()
}

// Clear removes all items from the cache
func (c *lruCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.cache = make(map[string]*list.Element)
	c.lru = list.New()
}
