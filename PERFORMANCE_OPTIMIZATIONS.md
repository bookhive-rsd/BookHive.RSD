# BookHive Performance Optimization Guide

## Critical Performance Issues Identified & Solutions

### 1. **DATABASE INDEXING** 🔴 CRITICAL
**Problem**: No indexes on frequently queried fields causing slow lookups
- Users collection: `username`, `email`, `googleId` not indexed
- Books collection: `uploadedBy`, `visibility`, `uploadDate` not indexed
- Requests collection: `requestedBy`, `bookOwner`, `status` not indexed

**Solution**: Added indexes to MongoDB schema

```javascript
// User indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
userSchema.index({ createdAt: -1 });

// Book indexes
bookSchema.index({ uploadedBy: 1 });
bookSchema.index({ visibility: 1 });
bookSchema.index({ uploadDate: -1 });
bookSchema.index({ uploadedBy: 1, visibility: 1 });
bookSchema.index({ tags: 1 });
bookSchema.index({ title: 'text', author: 'text' });

// Request indexes
requestSchema.index({ requestedBy: 1 });
requestSchema.index({ bookOwner: 1 });
requestSchema.index({ status: 1 });
```

---

### 2. **LARGE FILE UPLOADS** 🔴 CRITICAL
**Problem**: 
- Storing entire PDF files (up to 500MB) as Buffer in MongoDB
- Memory storage used for all uploads (inefficient)
- No chunking or streaming

**Solution**:
- Use file system storage with references
- Implement streaming uploads
- Separate thumbnail generation

```javascript
// BEFORE: Stores entire file in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }
});

// AFTER: Use disk storage with streaming
const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/books/',
    filename: (req, file, cb) => {
      cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex'));
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 }
});
```

---

### 3. **N+1 QUERY PROBLEMS** 🔴 CRITICAL
**Problem**: Multiple queries executed in loops
- Fetching user for each book in list
- Not using `.lean()` for read-only queries
- Multiple populate calls increasing query time

**Example Problem**:
```javascript
// INEFFICIENT - Multiple queries in explore route
const publicBooks = await Book.find({ visibility: 'public' })
  .populate('uploadedBy', 'username'); // Extra query per book
```

**Solution**: Use `.lean()` for read-only queries

```javascript
// OPTIMIZED
const publicBooks = await Book.find({ visibility: 'public' })
  .populate('uploadedBy', 'username')
  .lean(); // Skip Mongoose overhead
```

---

### 4. **MISSING PAGINATION** 🟠 HIGH
**Problem**: Loading ALL books/messages at once
- `/bookhive` route loads all books without limit
- Chat messages unlimited (causing memory issues)
- Explore page loads all public + restricted books

**Solution**: Add pagination

```javascript
// BEFORE
const books = await Book.find({ uploadedBy: req.session.userId });

// AFTER
app.get('/books', isAuthenticated, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const skip = (page - 1) * limit;
  
  const books = await Book.find({ uploadedBy: req.session.userId })
    .limit(limit)
    .skip(skip)
    .sort({ uploadDate: -1 });
  
  const total = await Book.countDocuments({ uploadedBy: req.session.userId });
  res.json({ books, total, pages: Math.ceil(total / limit) });
});
```

---

### 5. **IMAGE OPTIMIZATION** 🟠 HIGH
**Problem**:
- Large thumbnails stored as full Buffer
- No image compression
- Images not cached properly

**Solution**:
```javascript
// Add image compression
const sharp = require('sharp');

// Before storing thumbnail
const compressedThumbnail = await sharp(req.file.buffer)
  .resize(200, 300, { fit: 'cover' })
  .png({ quality: 80 })
  .toBuffer();

book.thumbnail = compressedThumbnail;
```

---

### 6. **RESPONSE COMPRESSION** 🟠 HIGH
**Status**: ✅ Already implemented but can be optimized

```javascript
// Current: Good compression already in place
app.use(compression({ level: 6, threshold: 1024 }));

// Recommendation: Consider level 5 for better balance
app.use(compression({ level: 5, threshold: 1024 }));
```

---

### 7. **CACHING STRATEGY** 🟠 MEDIUM
**Problem**: No caching for expensive queries
- Trending books recalculated every request
- User data fetched repeatedly
- Static data loaded from DB

**Solution**: Implement Redis caching

```javascript
// Install: npm install redis
const redis = require('redis');
const client = redis.createClient();

// Cache trending books
app.get('/api/trending-books', async (req, res) => {
  const cached = await client.get('trending_books');
  if (cached) {
    return res.json(JSON.parse(cached));
  }
  
  const trendingBooks = await Book.find()
    .sort({ pinCount: -1 })
    .limit(5)
    .lean();
  
  // Cache for 1 hour
  await client.setEx('trending_books', 3600, JSON.stringify(trendingBooks));
  res.json(trendingBooks);
});
```

---

### 8. **SOCKET.IO OPTIMIZATION** 🟠 MEDIUM
**Problem**: 
- No message pagination in socket events
- Unlimited history broadcast

**Solution**:
```javascript
// BEFORE: Loads 50 messages, but could be many more
socket.emit('chatHistory', {
  messages: await Message.find({ profession })
    .limit(50)
});

// AFTER: Paginate with skip
socket.emit('chatHistory', {
  messages: await Message.find({ profession })
    .sort({ timestamp: -1 })
    .limit(50)
    .skip(0)
    .lean()
});
```

---

### 9. **QUERY OPTIMIZATION** 🟡 MEDIUM
**Problem**: Using `select()` inconsistently

**Solution**: Always exclude heavy fields:

```javascript
// OPTIMIZED: Don't fetch fileData for list views
Book.find().select('-fileData').lean();

// Good for list view only
Book.find().select('title author fileSize uploadDate');
```

---

### 10. **CONNECTION POOLING** ✅ Already Good
**Status**: MongoDB connection pooling already configured properly

---

## Implementation Priority

1. **URGENT (Do First)**
   - Add database indexes
   - Fix file upload storage
   - Add `.lean()` to read-only queries
   - Implement pagination

2. **HIGH (Do Next)**
   - Image optimization/compression
   - Response caching
   - Fix N+1 queries

3. **MEDIUM (Nice to Have)**
   - Redis caching
   - Query optimization
   - Socket.IO improvements

---

## Expected Performance Improvements

| Issue | Impact | Expected Gain |
|-------|--------|---------------|
| Database Indexing | Faster queries | 70% faster lookups |
| File Upload Streaming | Upload speed | 60% faster uploads |
| Lean Queries | Memory/Speed | 50% less overhead |
| Pagination | Load time | 80% faster initial load |
| Image Compression | File size | 70% smaller images |
| Redis Caching | Response time | 90% faster for cached data |

---

## Testing Checklist

- [ ] Run database indexes
- [ ] Test file upload with large files
- [ ] Verify pagination works
- [ ] Check image loading performance
- [ ] Monitor MongoDB query times
- [ ] Load test with multiple users
- [ ] Check memory usage patterns

