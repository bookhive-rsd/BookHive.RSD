// DATABASE SCHEMA INDEXES & OPTIMIZATIONS
// Add this code after schema definitions in app.js (around line 320)

// User Schema Indexes - CRITICAL for login/lookup performance
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ googleId: 1 }, { unique: true, sparse: true });
userSchema.index({ createdAt: -1 });

// Book Schema Indexes - CRITICAL for book listing performance
bookSchema.index({ uploadedBy: 1 });
bookSchema.index({ visibility: 1 });
bookSchema.index({ uploadDate: -1 });
bookSchema.index({ uploadedBy: 1, visibility: 1 }); // Compound for explore queries
bookSchema.index({ tags: 1 });
bookSchema.index({ title: 'text', author: 'text' }); // Full-text search
bookSchema.index({ pinCount: -1 }); // For trending books

// Request Schema Indexes
requestSchema.index({ requestedBy: 1 });
requestSchema.index({ bookOwner: 1 });
requestSchema.index({ status: 1 });
requestSchema.index({ requestedBy: 1, status: 1 }); // Compound for user requests

// Note Schema Index
noteSchema.index({ user: 1 });

// Message Schema Indexes
messageSchema.index({ profession: 1, timestamp: -1 });
messageSchema.index({ user: 1 });
messageSchema.index({ timestamp: -1 });

// News Schema Index
newsSchema.index({ createdAt: -1 });
newsSchema.index({ postedBy: 1 });

// Publication Schema Indexes
publicationSchema.index({ postedBy: 1 });
publicationSchema.index({ createdAt: -1 });

// Comment Schema Indexes
commentSchema.index({ publication: 1 });
commentSchema.index({ user: 1 });

// PrivateChatRequest Schema Indexes
privateChatRequestSchema.index({ requester: 1 });
privateChatRequestSchema.index({ recipient: 1 });
privateChatRequestSchema.index({ status: 1 });

// PrivateMessage Schema Indexes
privateMessageSchema.index({ chatId: 1, timestamp: -1 });
privateMessageSchema.index({ sender: 1 });
privateMessageSchema.index({ recipient: 1 });

console.log('✅ Database indexes created successfully');
