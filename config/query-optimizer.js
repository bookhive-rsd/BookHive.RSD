// QUERY OPTIMIZATION HELPERS
// Use these functions throughout app.js to optimize database queries

/**
 * Build efficient book query with optional lean for read-only operations
 * @param {Object} filter - MongoDB filter object
 * @param {Object} options - Query options
 * @param {number} options.limit - Limit results
 * @param {number} options.skip - Skip results (for pagination)
 * @param {string[]} options.select - Fields to select
 * @param {boolean} options.lean - Return plain objects (default: true for read-only)
 * @param {string} options.sort - Sort field
 * @returns {Query}
 */
function buildBookQuery(filter, options = {}) {
  const {
    limit = null,
    skip = 0,
    select = null,
    lean = true,
    sort = { uploadDate: -1 }
  } = options;

  let query = Book.find(filter);

  if (select) {
    query = query.select(select);
  } else {
    // Default: exclude large fileData field from list queries
    query = query.select('-fileData');
  }

  if (sort) {
    query = query.sort(sort);
  }

  if (skip) {
    query = query.skip(skip);
  }

  if (limit) {
    query = query.limit(limit);
  }

  if (lean) {
    query = query.lean();
  }

  return query;
}

/**
 * Get books with pagination
 * @param {Object} filter - MongoDB filter
 * @param {number} page - Page number (1-indexed)
 * @param {number} pageSize - Items per page
 * @returns {Promise<{books: Array, total: number, pages: number, currentPage: number}>}
 */
async function getPaginatedBooks(filter, page = 1, pageSize = 20) {
  const skip = (page - 1) * pageSize;
  
  const [books, total] = await Promise.all([
    buildBookQuery(filter, {
      limit: pageSize,
      skip,
      select: 'title author description tags uploadDate fileSize visibility pinCount uploadedBy',
      lean: true,
      sort: { uploadDate: -1 }
    }).populate('uploadedBy', 'username'),
    Book.countDocuments(filter)
  ]);

  return {
    books,
    total,
    pages: Math.ceil(total / pageSize),
    currentPage: page
  };
}

/**
 * Get user data without sensitive fields
 * @param {string} userId - User ID
 * @param {string[]} includeFields - Additional fields to include
 * @returns {Promise<Object>}
 */
async function getUserSafe(userId, includeFields = []) {
  const defaultFields = [
    'username',
    'email',
    'profession',
    'createdAt',
    'storageUsed',
    'storageLimit',
    'isAdmin'
  ];
  
  const fields = [...new Set([...defaultFields, ...includeFields])].join(' ');
  
  return await User.findById(userId).select(fields).lean();
}

/**
 * Get trending books efficiently
 * @param {number} limit - Number of trending books
 * @returns {Promise<Array>}
 */
async function getTrendingBooks(limit = 5) {
  return await buildBookQuery(
    { visibility: 'public', pinCount: { $gt: 0 } },
    {
      limit,
      select: 'title author description fileSize pinCount uploadedBy',
      lean: true,
      sort: { pinCount: -1 }
    }
  ).populate('uploadedBy', 'username');
}

/**
 * Get user's books with storage info
 * @param {string} userId - User ID
 * @param {number} page - Page number
 * @param {number} pageSize - Items per page
 * @returns {Promise}
 */
async function getUserBooks(userId, page = 1, pageSize = 20) {
  return await getPaginatedBooks(
    { uploadedBy: userId },
    page,
    pageSize
  );
}

/**
 * Count documents efficiently
 * @param {string} modelName - Model name (e.g., 'Book', 'User')
 * @param {Object} filter - Filter criteria
 * @returns {Promise<number>}
 */
async function getCount(modelName, filter = {}) {
  const model = require('mongoose').model(modelName);
  return await model.countDocuments(filter);
}

/**
 * Batch fetch multiple users efficiently
 * @param {string[]} userIds - Array of user IDs
 * @returns {Promise<Array>}
 */
async function getUsersBatch(userIds) {
  return await User.find({ _id: { $in: userIds } })
    .select('username email profession')
    .lean();
}

/**
 * Aggregate query helper for complex queries
 * @param {string} modelName - Model name
 * @param {Array} pipeline - Aggregation pipeline
 * @returns {Promise<Array>}
 */
async function aggregateQuery(modelName, pipeline) {
  const model = require('mongoose').model(modelName);
  return await model.aggregate(pipeline);
}

module.exports = {
  buildBookQuery,
  getPaginatedBooks,
  getUserSafe,
  getTrendingBooks,
  getUserBooks,
  getCount,
  getUsersBatch,
  aggregateQuery
};
