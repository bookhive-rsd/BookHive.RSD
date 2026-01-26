// OPTIMIZED FILE UPLOAD HANDLER
// This should replace the upload configuration in app.js

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// Ensure upload directories exist
const uploadDirs = [
  'uploads/books',
  'uploads/thumbnails',
  'uploads/publications',
  'uploads/news'
];

(async () => {
  for (const dir of uploadDirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      console.warn(`Could not create ${dir}:`, err.message);
    }
  }
})();

// OPTIMIZED STORAGE: Use disk storage instead of memory for large files
const bookUploadStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    cb(null, 'uploads/books/');
  },
  filename: (req, file, cb) => {
    // Generate unique filename to avoid collisions
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `book-${uniqueSuffix}${ext}`);
  }
});

// PDF Upload with streaming support (500MB limit is fine, but streaming is better)
const uploadOptimized = multer({
  storage: bookUploadStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
  limits: { fileSize: 500 * 1024 * 1024 }  // 500MB limit
});

// OPTIMIZED IMAGE UPLOAD: Keep in memory but add size limits
const imageUploadStorage = multer.memoryStorage();

// News/Publication image upload (5MB limit)
const imageUploadOptimized = multer({
  storage: imageUploadStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }  // 5MB per image
});

// Publication multi-file upload
const publicationUploadStorage = multer.memoryStorage();
const publicationUploadOptimized = multer({
  storage: publicationUploadStorage,
  fileFilter: (req, file, cb) => {
    const allowedImageTypes = /^image\//;
    const allowedPdfTypes = /^application\/pdf$/;
    const isMimeAllowed = allowedImageTypes.test(file.mimetype) || allowedPdfTypes.test(file.mimetype);
    
    if (isMimeAllowed) {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDF files are allowed!'), false);
    }
  },
  limits: { 
    fileSize: 10 * 1024 * 1024,  // 10MB per file
    files: 10  // Max 10 files
  }
});

module.exports = {
  uploadOptimized,
  imageUploadOptimized,
  publicationUploadOptimized,
  uploadDirs
};
