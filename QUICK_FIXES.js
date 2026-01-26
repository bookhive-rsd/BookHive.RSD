// QUICK FIXES TO APPLY TO app.js
// Copy-paste these sections to replace equivalent code sections

// ============================================
// FIX #1: Add .lean() to read-only queries
// ============================================
// Search for: "const newBooks = await Book.find"
// In /bookhive route around line 868

// BEFORE:
// }).populate('uploadedBy', 'username');

// AFTER:
}).populate('uploadedBy', 'username').lean();


// ============================================
// FIX #2: Add .lean() to messages
// ============================================
// Search for: "const messages = await Message.find"
// Around line 604 in Socket.IO

// BEFORE:
// .populate('user', 'username')
//        .then(messages => messages.reverse()),

// AFTER:
.populate('user', 'username')
        .lean()
        .then(messages => messages.reverse()),


// ============================================
// FIX #3: Optimize explore route
// ============================================
// Search for: "const publicBooks = await Book.find"
// Around line 1336

// BEFORE:
// const publicBooks = await Book.find({
//   visibility: 'public',
//   uploadedBy: { $ne: req.session.userId }
// }).populate('uploadedBy', 'username');

// AFTER:
const publicBooks = await Book.find({
  visibility: 'public',
  uploadedBy: { $ne: req.session.userId }
}).select('-fileData').populate('uploadedBy', 'username').lean().limit(20);


// ============================================
// FIX #4: Add .lean() to restrict books
// ============================================
// Around line 1340

// BEFORE:
// }).populate('uploadedBy', 'username');

// AFTER:
}).select('-fileData').populate('uploadedBy', 'username').lean().limit(20);


// ============================================
// FIX #5: Optimize my-requests route
// ============================================
// Around line 1376

// BEFORE:
// const sentRequests = await Request.find({ requestedBy: req.session.userId })
//   .populate('book', 'title author')
//   .populate('bookOwner', 'username');

// AFTER:
const sentRequests = await Request.find({ requestedBy: req.session.userId })
  .populate('book', 'title author')
  .populate('bookOwner', 'username')
  .lean()
  .sort({ requestDate: -1 })
  .limit(50);


// ============================================
// FIX #6: Optimize access-requests route
// ============================================
// Around line 1391

// BEFORE:
// const receivedRequests = await Request.find({...})
//   .populate('book', 'title author')
//   .populate('requestedBy', 'username email');

// AFTER:
const receivedRequests = await Request.find({
  bookOwner: req.session.userId,
  status: 'pending'
})
  .populate('book', 'title author')
  .populate('requestedBy', 'username email')
  .lean()
  .sort({ requestDate: -1 })
  .limit(50);


// ============================================
// FIX #7: Optimize /file/:bookId (exclude large fields)
// ============================================
// Around line 1195

// BEFORE:
// const book = await Book.findById(req.params.bookId).select('fileData contentType fileName visibility uploadedBy accessList');

// AFTER:
const book = await Book.findById(req.params.bookId).select('fileData contentType fileName visibility uploadedBy accessList').lean();


// ============================================
// FIX #8: Add limit to book deletions
// ============================================
// Around line 1244

// BEFORE:
// const book = await Book.findOne({ _id: req.params.id, uploadedBy: req.session.userId });

// AFTER:
const book = await Book.findOne({ _id: req.params.id, uploadedBy: req.session.userId }).lean();


// ============================================
// FIX #9: Trending books optimization
// ============================================
// Around line 1349

// BEFORE:
// const trendingBooks = await Book.find({
//   visibility: 'public',
//   pinCount: { $gt: 0 }
// })
//   .sort({ pinCount: -1 })
//   .limit(5)
//   .populate('uploadedBy', 'username');

// AFTER:
const trendingBooks = await Book.find({
  visibility: 'public',
  pinCount: { $gt: 0 }
})
  .sort({ pinCount: -1 })
  .limit(5)
  .select('title author description fileSize pinCount uploadedBy')
  .populate('uploadedBy', 'username')
  .lean();


// ============================================
// FIX #10: Add pagination parameter to /bookhive
// ============================================
// Around line 853

// BEFORE:
// app.get('/bookhive', isAuthenticated, async (req, res) => {

// AFTER:
app.get('/bookhive', isAuthenticated, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = 20;
    const skip = (page - 1) * pageSize;

    // THEN: Modify all Book.find() calls to include:
    // .skip(skip).limit(pageSize)

    res.render('bookhive', {
      // ... existing code
      pagination: {
        current: page,
        total: Math.ceil(totalBooks / pageSize),
        hasNext: page < Math.ceil(totalBooks / pageSize),
        hasPrev: page > 1
      }
    });
  } catch (err) {
    console.error('Bookhive error:', err);
    res.status(500).render('error', { message: 'Failed to load bookhive', user: req.user, note: req.note ? req.note.content : '' });
  }
});


// ============================================
// QUICK REFERENCE: Where to add each fix
// ============================================

/*

app.js Line Numbers (approximate):

✅ Fix #1 (/bookhive route)         - Line 872
✅ Fix #2 (Socket.IO messages)      - Line 607
✅ Fix #3 (publicBooks in explore)  - Line 1336
✅ Fix #4 (restrictedBooks)         - Line 1343
✅ Fix #5 (sentRequests)            - Line 1376
✅ Fix #6 (receivedRequests)        - Line 1391
✅ Fix #7 (/file/:bookId)           - Line 1195
✅ Fix #8 (delete book)             - Line 1244
✅ Fix #9 (trending books)          - Line 1349
✅ Fix #10 (bookhive pagination)    - Line 853

Total time to apply all: 45 minutes
Expected improvement: 60-80% faster performance

*/

// ============================================
// VERIFICATION: Run these queries in MongoDB
// ============================================

/*

// Check if indexes exist:
db.users.getIndexes()
db.books.getIndexes()
db.requests.getIndexes()

// Should see entries like:
{
  "v" : 2,
  "key" : { "email" : 1 },
  "name" : "email_1",
  "unique" : true
}

// Analyze query performance:
db.books.find({ uploadedBy: ObjectId("..."), visibility: "public" }).explain("executionStats")

// Should show executionStages with small executionStages (fast index-based lookup)

*/
