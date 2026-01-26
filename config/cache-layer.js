// CACHING LAYER (Optional but recommended)
// Install: npm install redis ioredis
// This provides caching for expensive queries

const redis = require('redis');

// Create Redis client
const client = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  retry_strategy: (options) => {
    if (options.error && options.error.code === 'ECONNREFUSED') {
      console.warn('Redis connection refused - caching disabled');
      return null;
    }
    if (options.total_retry_time > 1000 * 60 * 60) {
      return new Error('Redis retry timeout exceeded');
    }
    return Math.min(options.attempt * 100, 3000);
  }
});

client.on('error', (err) => {
  console.warn('Redis error (caching will be disabled):', err.message);
});

client.on('connect', () => {
  console.log('✅ Redis cache connected');
});

/**
 * Get cached value
 * @param {string} key - Cache key
 * @returns {Promise<any>} - Cached value or null
 */
async function getCached(key) {
  try {
    const cached = await client.getAsync(key);
    if (cached) {
      console.log(`Cache HIT: ${key}`);
      return JSON.parse(cached);
    }
    console.log(`Cache MISS: ${key}`);
    return null;
  } catch (err) {
    console.warn(`Cache GET error for ${key}:`, err.message);
    return null;
  }
}

/**
 * Set cached value
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Time to live in seconds (default: 3600 = 1 hour)
 * @returns {Promise<boolean>}
 */
async function setCached(key, value, ttl = 3600) {
  try {
    await client.setexAsync(key, ttl, JSON.stringify(value));
    console.log(`Cache SET: ${key} (TTL: ${ttl}s)`);
    return true;
  } catch (err) {
    console.warn(`Cache SET error for ${key}:`, err.message);
    return false;
  }
}

/**
 * Delete cached value
 * @param {string} key - Cache key
 * @returns {Promise<boolean>}
 */
async function deleteCached(key) {
  try {
    await client.delAsync(key);
    console.log(`Cache DELETE: ${key}`);
    return true;
  } catch (err) {
    console.warn(`Cache DELETE error for ${key}:`, err.message);
    return false;
  }
}

/**
 * Clear all cache
 * @returns {Promise<boolean>}
 */
async function clearCache() {
  try {
    await client.flushdbAsync();
    console.log('Cache cleared');
    return true;
  } catch (err) {
    console.warn('Cache clear error:', err.message);
    return false;
  }
}

/**
 * Get or fetch with caching (pattern: Cache-Aside)
 * @param {string} key - Cache key
 * @param {Function} fetcher - Async function to fetch data if not cached
 * @param {number} ttl - Time to live in seconds
 * @returns {Promise<any>}
 */
async function getOrFetch(key, fetcher, ttl = 3600) {
  const cached = await getCached(key);
  if (cached) return cached;
  
  const data = await fetcher();
  await setCached(key, data, ttl);
  return data;
}

// CACHE KEY GENERATORS
const cacheKeys = {
  trendingBooks: () => 'books:trending',
  userBooks: (userId) => `user:${userId}:books`,
  bookDetails: (bookId) => `book:${bookId}`,
  userProfile: (userId) => `user:${userId}:profile`,
  publicBooks: (page) => `books:public:${page}`,
  news: (page) => `news:${page}`,
  publications: (page) => `publications:${page}`
};

// Invalidation helpers
async function invalidateUserCache(userId) {
  await Promise.all([
    deleteCached(cacheKeys.userBooks(userId)),
    deleteCached(cacheKeys.userProfile(userId))
  ]);
  console.log(`User cache invalidated: ${userId}`);
}

async function invalidateBookCache(bookId) {
  await deleteCached(cacheKeys.bookDetails(bookId));
  await deleteCached(cacheKeys.trendingBooks());
  console.log(`Book cache invalidated: ${bookId}`);
}

async function invalidatePublicCache() {
  // Clear all public book pages
  for (let page = 1; page <= 10; page++) {
    await deleteCached(cacheKeys.publicBooks(page));
  }
  await deleteCached(cacheKeys.trendingBooks());
  console.log('Public cache invalidated');
}

module.exports = {
  client,
  getCached,
  setCached,
  deleteCached,
  clearCache,
  getOrFetch,
  cacheKeys,
  invalidateUserCache,
  invalidateBookCache,
  invalidatePublicCache
};
