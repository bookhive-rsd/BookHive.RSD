const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const http = require('http');
const socketIo = require('socket.io');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const fs = require('fs').promises;
const pdfParse = require('pdf-parse');
const axios = require('axios');
const dns = require('dns');
const compression = require('compression');
const sharp = require('sharp');
const { GridFSBucket } = require('mongodb');
const Application = require('./models/Application');
const emailTemplates = require('./config/email-templates');
const { extractTextByType, generateThumbnail, getFileTypeFromMime, validateFileContent } = require('./config/document-processor');
require('dotenv').config();

// Environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const MONGODB_URI = process.env.MONGODB_URI;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || 'your-secret-key';
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;
const activeUsers = new Set();
app.set('trust proxy', 1);
app.use(compression({ level: 6, threshold: 1024 })); // Compress responses > 1KB
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.get('X-Forwarded-Proto') !== 'https') {
    return res.redirect(301, `https://${req.get('host')}${req.url}`);
  }
  next();
});
// Prevent caching for HTML pages, but allow caching for static assets
app.use((req, res, next) => {
  if (req.url.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|eot|ttf|otf)$/i)) {
    // Cache static assets for 1 week
    res.set('Cache-Control', 'public, max-age=604800, immutable');
  } else {
    // No cache for HTML pages
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
  next();
});
// Middleware to set correct MIME type for CSS files
app.use((req, res, next) => {
  if (req.url.endsWith('.css')) {
    res.set('Content-Type', 'text/css');
  }
  next();
});
// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
// Session setup with shorter expiration (30 minutes)
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGODB_URI }),
  cookie: {
      maxAge: SESSION_TIMEOUT,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax'
    }
}));

// Helper function to verify if an email's domain has MX records
async function verifyEmailDomain(email) {
    try {
        const domain = email.split('@')[1];
        const records = await dns.promises.resolveMx(domain);
        return records && records.length > 0;
    } catch (error) {
        console.error('DNS lookup failed for:', email, error);
        return false;
    }
}

// Helper function to call Gemini API
async function callGeminiAPI(prompt, textContent) {
  try {
    const response = await axios.post(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [
              {
                text: `${prompt}\n\n${textContent}`
              }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    const generatedText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return generatedText;
  } catch (error) {
    console.error('Gemini API call error:', error.response?.data || error.message);
    throw new Error('Failed to process AI request');
  }
}

async function validatePdfContent(pdfBuffer) {
  try {
    // Logic removed to prevent external API failures from blocking user uploads
    return true; 
  } catch (error) {
    console.error('PDF validation error:', error);
    return true; // Fallback to true so the app remains functional
  }
}

// Security function to validate the AI-generated MongoDB pipeline
function isPipelineSafe(pipeline) {
    if (!Array.isArray(pipeline)) return false;

    const ALLOWED_STAGES = ['$match', '$group', '$sort', '$limit', '$project', '$lookup', '$count'];
    const FORBIDDEN_FIELDS = ['password', 'email', 'googleId', 'fileData', 'accessList'];
    const FORBIDDEN_OPERATORS = ['$where'];

    for (const stage of pipeline) {
        const stageName = Object.keys(stage)[0];
        if (!ALLOWED_STAGES.includes(stageName)) {
            console.error(`Validation failed: Disallowed stage found: ${stageName}`);
            return false;
        }

        const stageContent = JSON.stringify(stage);
        for (const field of FORBIDDEN_FIELDS) {
            if (stageContent.includes(`"${field}"`)) {
                console.error(`Validation failed: Forbidden field access attempted: ${field}`);
                return false;
            }
        }
        for (const op of FORBIDDEN_OPERATORS) {
             if (stageContent.includes(`"${op}"`)) {
                console.error(`Validation failed: Forbidden operator used: ${op}`);
                return false;
            }
        }
    }
    return true; // All checks passed
}
// Passport setup
app.use(passport.initialize());
app.use(passport.session());
passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: '/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ googleId: profile.id });
    if (user) {
      return done(null, user);
    }
    user = await User.findOne({ email: profile.emails[0].value });
    if (user) {
      user.googleId = profile.id;
      await user.save();
      return done(null, user);
    }
    user = new User({
      googleId: profile.id,
      username: profile.displayName.replace(/\s/g, '').toLowerCase(),
      email: profile.emails[0].value,
      profession: 'BookHive',
      password: await bcrypt.hash(Math.random().toString(36).slice(-8), 10)
    });
    await user.save();
    const newNote = new Note({
      user: user._id,
      content: ''
    });
    await newNote.save();
    try {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const emailTemplate = emailTemplates.welcomeEmail(user.username, baseUrl);
      const mailOptions = {
        from: `"BookHive Team" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
        text: `Welcome to BookHive, ${user.username}!\n\nThank you for joining our community. Explore, upload, and share your favorite books with BookHive.\n\nGet started by visiting: ${baseUrl}/bookhive\n\nBest regards,\nBookHive Team`,
        headers: {
            'X-Priority': '3',
            'X-MSMail-Priority': 'Normal',
            'Importance': 'Normal'
        }
      };
      await transporter.sendMail(mailOptions);
      console.log(`Welcome email sent to: ${user.email}`);
    } catch (emailErr) {
      console.error(`Error sending welcome email to ${user.email}:`, emailErr);
    }
    done(null, user);
  } catch (err) {
    done(err, null);
  }
}));
// Schemas
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String },
  googleId: { type: String, unique: true, sparse: true },
  profession: { type: String, required: true, enum: ['BookHive'] },
  createdAt: { type: Date, default: Date.now },
  storageUsed: { type: Number, default: 0 },
  storageLimit: { type: Number, default: 1024 * 1024 * 1024 },
  pinnedBooks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Book' }],
  isAdmin: { type: Boolean, default: false },
  // Notification preferences
  notificationPreferences: {
    emailNotifications: { type: Boolean, default: true },
    loginAlerts: { type: Boolean, default: true },
    newsUpdates: { type: Boolean, default: true },
    publicationUpdates: { type: Boolean, default: true },
    communityNotifications: { type: Boolean, default: true },
    browserNotifications: { type: Boolean, default: true },
    inAppNotifications: { type: Boolean, default: true },
    bookUpdates: { type: Boolean, default: true },
    commentNotifications: { type: Boolean, default: true }
  },
  lastLogin: { type: Date }
});
const bookSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: String, required: true },
  fileName: { type: String, required: true },
  fileId: { type: mongoose.Schema.Types.ObjectId, required: true }, // Store GridFS file ID instead of buffer
  fileData: { type: Buffer }, // Keep for backward compatibility (will be migrated)
  fileType: { type: String, required: true, enum: ['pdf', 'docx', 'image'] },
  contentType: { type: String, required: true },
  thumbnail: { type: Buffer },
  thumbnailType: { type: String },
  coverImage: { type: Buffer }, // Custom book cover image uploaded by user
  coverImageType: { type: String }, // MIME type of custom cover (e.g., 'image/jpeg')
  description: { type: String },
  tags: [{ type: String }],
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadDate: { type: Date, default: Date.now },
  fileSize: { type: Number, required: true },
  visibility: { type: String, enum: ['private', 'public', 'restricted'], default: 'private' },
  accessList: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pinCount: { type: Number, default: 0 },
  numPages: { type: Number, default: 0 },
  extractedText: { type: String, default: '' }
});
const requestSchema = new mongoose.Schema({
  book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  bookOwner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'approved', 'declined'], default: 'pending' },
  requestDate: { type: Date, default: Date.now },
  responseDate: { type: Date }
});
const noteSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
});
const feedbackSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  submittedAt: { type: Date, default: Date.now }
});
const messageSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  profession: { type: String, required: true, enum: ['BookHive'] },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  // Chat properties
  isChatbotResponse: { type: Boolean, default: false },
  // Discussion properties
  isDiscussion: { type: Boolean, default: false },
  category: { type: String },
  tags: [{ type: String }],
  replies: { type: Number, default: 0 },
  // Response to discussion
  isResponse: { type: Boolean, default: false },
  responseToId: { type: mongoose.Schema.Types.ObjectId },
  // Event properties
  isEvent: { type: Boolean, default: false },
  eventTitle: { type: String },
  eventStart: { type: Date },
  eventEnd: { type: Date },
  eventType: { type: String },
  eventAttendees: { type: Number, default: 0 },
  // Group properties
  isGroup: { type: Boolean, default: false },
  groupName: { type: String },
  groupMembers: { type: Number, default: 0 },
  groupPosts: { type: Number, default: 0 },
  groupMembersList: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isGroupMessage: { type: Boolean, default: false },
  groupId: { type: mongoose.Schema.Types.ObjectId },
  // Activity tracking
  isActivity: { type: Boolean, default: false }
});
const newsSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  image: { type: Buffer },
  imageType: { type: String },
  createdAt: { type: Date, default: Date.now },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});
const publicationSchema = new mongoose.Schema({
  content: { type: String, required: true },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likeCount: { type: Number, default: 0 },
  images: [{
    data: Buffer,
    contentType: String,
    filename: String
  }],
  documents: [{
    data: Buffer,
    contentType: String,
    filename: String
  }]
});
const commentSchema = new mongoose.Schema({
  publication: { type: mongoose.Schema.Types.ObjectId, ref: 'Publication', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const notificationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['login', 'news', 'publication', 'community', 'system', 'book-update', 'comment', 'message'], required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  link: { type: String }, // Link to the relevant page
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, index: { expires: 2592000 } }, // Auto-delete after 30 days
  relatedId: { type: mongoose.Schema.Types.ObjectId }, // Reference to news, publication, book, etc.
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' }
});
const privateChatRequestSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  requestDate: { type: Date, default: Date.now },
  responseDate: { type: Date }
});
const privateMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  chatId: { type: String, required: true }
});

// Chatbot Feedback Schema for user training
const chatbotFeedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userQuery: { type: String, required: true },
  botResponse: { type: String, required: true },
  userFeedback: { type: String, enum: ['helpful', 'incorrect', 'irrelevant', 'unclear'], required: true },
  userCorrection: { type: String }, // What the correct answer should have been
  correctBookIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Book' }], // Books user says are correct
  confidence: { type: Number, default: 0 }, // ML confidence score (if using)
  createdAt: { type: Date, default: Date.now },
  resolved: { type: Boolean, default: false } // Whether admin resolved this feedback
});

const PrivateChatRequest = mongoose.model('PrivateChatRequest', privateChatRequestSchema);
const PrivateMessage = mongoose.model('PrivateMessage', privateMessageSchema);

// Models
const User = mongoose.model('User', userSchema);
const Book = mongoose.model('Book', bookSchema);
const Request = mongoose.model('Request', requestSchema);
const Note = mongoose.model('Note', noteSchema);
const Feedback = mongoose.model('Feedback', feedbackSchema);
const Message = mongoose.model('Message', messageSchema);
const News = mongoose.model('News', newsSchema);
const Publication = mongoose.model('Publication', publicationSchema);
const Comment = mongoose.model('Comment', commentSchema);
const ChatbotFeedback = mongoose.model('ChatbotFeedback', chatbotFeedbackSchema);
const Notification = mongoose.model('Notification', notificationSchema);
// Multer for publications (support multiple files: images and PDFs)
const publicationUploadConfig = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = [/^image\//, /^application\/pdf$/];
    if (allowedTypes.some(type => type.test(file.mimetype))) {
      cb(null, true);
    } else {
      cb(new Error('Only images and PDF files are allowed!'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024, files: 10 } // Increased limit to 10MB per file
});
const publicationUpload = publicationUploadConfig.array('files', 10);
passport.serializeUser((user, done) => {
  done(null, user.id);
});
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});
// Session timeout middleware
app.use((req, res, next) => {
  if (req.session.userId) {
    const now = Date.now();
    const lastActivity = req.session.lastActivity || now;
    if (now - lastActivity > SESSION_TIMEOUT) {
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        return res.redirect('/');
      });
    } else {
      req.session.lastActivity = now;
      next();
    }
  } else {
    next();
  }
});
// Multer for profile and password forms
const formUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    cb(null, false);
  }
}).none();
// Fetch user and note middleware
const fetchUserAndNote = async (req, res, next) => {
  if (req.session.userId) {
    try {
      req.user = await User.findById(req.session.userId);
      req.note = await Note.findOne({ user: req.session.userId });
    } catch (err) {
      console.error('Error fetching user or note:', err);
      req.user = null;
      req.note = null;
    }
  }
  next();
};
app.use(fetchUserAndNote);
// MongoDB connection
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('Connected to MongoDB');
  
  // Initialize GridFS bucket for file storage
  try {
    const gfs = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'files'
    });
    global.gfs = gfs; // Make it globally accessible
    console.log('GridFS bucket initialized');
  } catch (gridFsErr) {
    console.warn('Warning: GridFS bucket initialization failed:', gridFsErr.message);
  }
  
  try {
    const adminExists = await User.findOne({ username: 'admin' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const adminUser = new User({
        username: 'admin',
        email: 'admin@bookhive.com',
        password: hashedPassword,
        profession: 'BookHive',
        isAdmin: true
      });
      await adminUser.save();
      console.log('Admin user created');
      const adminNote = new Note({
        user: adminUser._id,
        content: 'Admin notes'
      });
      await adminNote.save();
    }
  } catch (err) {
    console.error('Error creating admin user:', err);
  }
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// ============== NOTIFICATION HELPER FUNCTIONS ==============

// Enhanced helper function to send email and create in-app notification with real-time Socket.io
async function sendNotification(userId, notificationType, title, message, emailDetails = null, link = null, relatedId = null) {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    // Create in-app notification if enabled
    if (user.notificationPreferences.inAppNotifications) {
      const notification = new Notification({
        user: userId,
        type: notificationType,
        title,
        message,
        link,
        relatedId
      });
      await notification.save();
    }

    // Send email if enabled and email notifications are on
    if (emailDetails && user.notificationPreferences.emailNotifications) {
      const emailConfig = emailDetails;
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      emailConfig.html = emailConfig.html.replace(/\[BASE_URL\]/g, baseUrl);

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: emailConfig.subject,
        html: emailConfig.html
      };

      await transporter.sendMail(mailOptions);
    }

    // Emit real-time notification via Socket.io
    io.to(userId.toString()).emit('notificationAlert', {
      type: notificationType,
      title,
      message,
      link,
      timestamp: new Date()
    });

    return true;
  } catch (err) {
    console.error('Error sending notification:', err);
  }
}

// Enhanced login alert with real-time notification
async function sendLoginAlert(user, ipAddress, userAgent) {
  if (!user.notificationPreferences.loginAlerts) return;

  try {
    const emailTemplate = emailTemplates.loginAlert(
      user.username,
      new Date(),
      userAgent,
      ipAddress
    );

    await sendNotification(
      user._id,
      'login',
      '🔐 Login Detected',
      `New login to your account at ${new Date().toLocaleString()}`,
      emailTemplate,
      '/account'
    );

    // Also emit real-time login alert
    io.to(user._id.toString()).emit('loginAlert', {
      device: userAgent ? userAgent.substring(0, 50) : 'Unknown Device',
      ipAddress
    });
  } catch (err) {
    console.error('Error sending login alert:', err);
  }
}

// Enhanced news broadcast with real-time notification
async function broadcastNewsNotification(newsId, newsTitle, newsContent) {
  try {
    const users = await User.find({ 'notificationPreferences.newsUpdates': true });
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    for (const user of users) {
      const emailTemplate = emailTemplates.newsUpdate(
        user.username,
        newsTitle,
        newsContent.substring(0, 200) + '...',
        `${baseUrl}/news`
      );

      await sendNotification(
        user._id,
        'news',
        '📰 News Update',
        newsTitle,
        emailTemplate,
        '/news',
        newsId
      );

      // Emit real-time news alert
      io.to(user._id.toString()).emit('newsAlert', {
        title: newsTitle,
        newsId
      });
    }
  } catch (err) {
    console.error('Error sending news notification:', err);
  }
}

// Enhanced publication broadcast with real-time notification
async function broadcastPublicationNotification(publicationId, authorId, authorName, publicationPreview) {
  try {
    const users = await User.find({ 
      'notificationPreferences.publicationUpdates': true,
      _id: { $ne: authorId }  // Exclude the author who published it
    });
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    for (const user of users) {
      const emailTemplate = emailTemplates.publicationUpdate(
        user.username,
        authorName,
        publicationPreview.substring(0, 200) + '...',
        `${baseUrl}/publications`
      );

      await sendNotification(
        user._id,
        'publication',
        '📚 New Publication',
        `New publication by ${authorName}`,
        emailTemplate,
        '/publications',
        publicationId
      );

      // Emit real-time publication alert
      io.to(user._id.toString()).emit('publicationAlert', {
        title: publicationPreview.substring(0, 100),
        author: authorName,
        publicationId
      });
    }
  } catch (err) {
    console.error('Error sending publication notification:', err);
  }
}

// NEW: Book update broadcast notification - MOST IMPORTANT
async function broadcastBookUpdateNotification(publicationId, bookTitle, authorName, updateSummary) {
  try {
    const users = await User.find({ 'notificationPreferences.bookUpdates': true });
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const bookLink = `${baseUrl}/publications/${publicationId}`;

    for (const user of users) {
      const emailTemplate = emailTemplates.bookUpdate(
        user.username,
        bookTitle,
        authorName,
        updateSummary.substring(0, 300),
        bookLink
      );

      await sendNotification(
        user._id,
        'book-update',
        '📖 Book Updated',
        `"${bookTitle}" by ${authorName} has been updated!`,
        emailTemplate,
        bookLink,
        publicationId
      );

      // Emit real-time book update alert - with high priority
      io.to(user._id.toString()).emit('bookUpdate', {
        bookTitle,
        author: authorName,
        updateSummary: updateSummary.substring(0, 200),
        publicationId,
        timestamp: new Date()
      });
    }
  } catch (err) {
    console.error('Error sending book update notification:', err);
  }
}

// ============== END NOTIFICATION HELPER FUNCTIONS ==============

// Nodemailer configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  // Added options to improve connection handling and potentially deliverability
  pool: true,
  maxConnections: 1,
  rateLimit: 1, 
  maxMessages: 20
});
// Multer for file uploads (PDF, DOCX, Images)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-word.document.macroEnabled.12',
      'application/msword',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOCX, and image files (JPG, PNG, GIF, WebP) are allowed'), false);
    }
  },
  limits: { fileSize: 500 * 1024 * 1024 }
});
const newsImageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG images are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});
// Configure Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/images/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `app-icon-${uniqueSuffix}${ext}`);
  }
});
const ApplicationImageUpload = multer({
  storage: multer.memoryStorage(), // Changed to memoryStorage
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only JPG, JPEG, and PNG files are allowed'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});
// Authentication middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.userId || req.isAuthenticated()) {
    return next();
  }
  res.redirect('/');
};
// Admin authentication middleware
const isAdmin = async (req, res, next) => {
  if (!req.session.userId && !req.isAuthenticated()) {
    return res.redirect('/login');
  }
  const user = req.user || await User.findById(req.session.userId);
  if (!user || !user.isAdmin) {
    return res.status(403).render('error', { message: 'Admin access required', user: req.user, note: req.note ? req.note.content : '' });
  }
  req.user = user;
  next();
};

// A safe, text-based representation of our database schema for the AI
const DATABASE_SCHEMA_FOR_AI = `
Here are the available Mongoose collections and their schemas. You must use these plural collection names ('books', 'news', etc.) to construct your queries.

1.  **Collection: 'books'**
    - Schema: { title: String, author: String, description: String, tags: [String], uploadDate: Date, fileSize: Number, visibility: String, pinCount: Number }

2.  **Collection: 'news'**
    - Schema: { title: String, content: String, createdAt: Date, postedBy: ObjectId }

3.  **Collection: 'publications'**
    - Schema: { content: String, postedBy: ObjectId, createdAt: Date, likeCount: Number }

4.  **Collection: 'users'**
    - Schema: { username: String, profession: String, createdAt: Date, isAdmin: Boolean }

5.  **Collection: 'comments'**
    - Schema: { publication: ObjectId, user: ObjectId, content: String, createdAt: Date }

6.  **Collection: 'applications'**
    - Schema: { name: String, description: String, creatorId: ObjectId, createdAt: Date }
`;

// Multer error handling
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).render('upload', { error: err.message, user: req.user, note: req.note ? req.note.content : '' });
  } else if (err) {
    return res.status(400).render('upload', { error: err.message, user: req.user, note: req.note ? req.note.content : '' });
  }
  next();
});
// Socket.IO setup
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  socket.on('joinProfession', async ({ userId, profession }) => {
    socket.join(profession);
    socket.join(userId.toString());
    activeUsers.add(userId);
    const totalUsers = await User.countDocuments();
    socket.emit('chatHistory', {
      messages: await Message.find({ profession, isDiscussion: false, isEvent: false, isGroup: false, isResponse: false })
        .sort({ timestamp: -1 })
        .limit(50)
        .populate('user', 'username')
        .then(messages => messages.reverse()),
      totalUsers,
      activeUsers: activeUsers.size
    });
    io.to(profession).emit('updateActiveUsers', activeUsers.size);
  });
  socket.on('chatMessage', async ({ userId, profession, content }) => {
    if (!content || content.trim() === '') return;
    const sanitizedContent = sanitizeHtml(content, {
      allowedTags: [],
      allowedAttributes: {}
    });
    const message = new Message({
      user: userId,
      profession,
      content: sanitizedContent
    });
    await message.save();
    const populatedMessage = await Message.findById(message._id).populate('user', 'username');
    io.to(profession).emit('chatMessage', populatedMessage);
  });
  socket.on('commentPublication', async ({ userId, publicationId, content }) => {
    if (!content || content.trim() === '' || !mongoose.Types.ObjectId.isValid(userId)) return;
    try {
      const sanitizedContent = sanitizeHtml(content, {
        allowedTags: [],
        allowedAttributes: {}
      });
      const comment = new Comment({
        publication: publicationId,
        user: userId,
        content: sanitizedContent
      });
      await comment.save();
      const populatedComment = await Comment.findById(comment._id).populate('user', 'username');
      io.emit('newComment', populatedComment);
    } catch (err) {
      console.error('Comment publication error:', err);
    }
  });
  socket.on('requestPrivateChat', async ({ requesterId, recipientId }) => {
    try {
      const existingAccepted = await PrivateChatRequest.findOne({
        status: 'accepted',
        $or: [
          { requester: requesterId, recipient: recipientId },
          { requester: recipientId, recipient: requesterId }
        ]
      });
      if (existingAccepted) {
        socket.emit('requestPrivateChatResponse', { success: false, message: 'You already have an active chat with this user' });
        return;
      }
      const existingPending = await PrivateChatRequest.findOne({
        requester: requesterId,
        recipient: recipientId,
        status: 'pending'
      });
      if (existingPending) {
        socket.emit('requestPrivateChatResponse', { success: false, message: 'Chat request already pending' });
        return;
      }
      const chatRequest = new PrivateChatRequest({
        requester: requesterId,
        recipient: recipientId
      });
      await chatRequest.save();
      const populatedRequest = await PrivateChatRequest.findById(chatRequest._id)
        .populate('requester', 'username')
        .populate('recipient', 'username');
      io.to(recipientId.toString()).emit('newChatRequest', populatedRequest);
      socket.emit('requestPrivateChatResponse', { success: true, message: 'Chat request sent' });
      const recipient = await User.findById(recipientId);
      const requester = await User.findById(requesterId);
      const mailOptions = {
        from: `"BookHive Team" <${process.env.EMAIL_USER}>`,
        to: recipient.email,
        subject: 'New Private Chat Request on BookHive',
        html: `
          <h2>New Private Chat Request</h2>
          <p>User <strong>${requester.username}</strong> has requested to start a private chat with you.</p>
          <p>Please visit <a href="https://bookhive-rsd.onrender.com/community">BookHive Community</a> to accept or decline this request.</p>
          <p>Best regards,<br>BookHive Team</p>
        `,
        text: `New Private Chat Request\n\nUser ${requester.username} has requested to start a private chat with you.\n\nPlease visit BookHive Community to accept or decline this request: https://bookhive-rsd.onrender.com/community\n\nBest regards,\nBookHive Team`,
        headers: {
            'X-Priority': '3',
            'X-MSMail-Priority': 'Normal',
            'Importance': 'Normal'
        }
      };
      await transporter.sendMail(mailOptions);
      console.log(`Private chat request email sent to: ${recipient.email}`);
    } catch (err) {
      console.error('Private chat request error:', err);
      socket.emit('requestPrivateChatResponse', { success: false, message: 'Failed to send chat request' });
    }
  });
  socket.on('handleChatRequest', async ({ requestId, action }) => {
    try {
      if (!['accept', 'decline'].includes(action)) {
        socket.emit('handleChatRequestResponse', { success: false, message: 'Invalid action' });
        return;
      }
      const chatRequest = await PrivateChatRequest.findById(requestId);
      if (!chatRequest) {
        socket.emit('handleChatRequestResponse', { success: false, message: 'Request not found' });
        return;
      }
      chatRequest.status = action === 'accept' ? 'accepted' : 'declined';
      chatRequest.responseDate = new Date();
      await chatRequest.save();
      if (action === 'accept') {
        const chatId = [chatRequest.requester.toString(), chatRequest.recipient.toString()].sort().join('_');
        const requesterUser = await User.findById(chatRequest.requester);
        const recipientUser = await User.findById(chatRequest.recipient);
        io.to(chatRequest.requester.toString()).emit('chatRequestAccepted', {
          chatId,
          recipientId: chatRequest.recipient.toString(),
          recipientUsername: recipientUser.username
        });
        io.to(chatRequest.recipient.toString()).emit('chatRequestAccepted', {
          chatId,
          recipientId: chatRequest.requester.toString(),
          recipientUsername: requesterUser.username
        });
      }
      socket.emit('handleChatRequestResponse', { success: true, message: `Chat request ${action}ed` });
      io.to(chatRequest.requester.toString()).emit('refreshChatRequests');
      io.to(chatRequest.recipient.toString()).emit('refreshChatRequests');
    } catch (err) {
      console.error('Handle chat request error:', err);
      socket.emit('handleChatRequestResponse', { success: false, message: 'Failed to handle chat request' });
    }
  });
  socket.on('privateMessage', async ({ senderId, recipientId, content, chatId }) => {
    if (!content || content.trim() === '') return;
    try {
      const sanitizedContent = sanitizeHtml(content, {
        allowedTags: [],
        allowedAttributes: {}
      });
      const message = new PrivateMessage({
        sender: senderId,
        recipient: recipientId,
        content: sanitizedContent,
        chatId
      });
      await message.save();
      const populatedMessage = await PrivateMessage.findById(message._id)
        .populate('sender', 'username')
        .populate('recipient', 'username');
      io.to(senderId.toString()).emit('privateMessage', populatedMessage);
      io.to(recipientId.toString()).emit('privateMessage', populatedMessage);
    } catch (err) {
      console.error('Private message error:', err);
      socket.emit('privateMessageError', { success: false, message: 'Failed to send private message' });
    }
  });
  socket.on('getPrivateChatMessages', async (chatId, callback) => {
    try {
      const messages = await PrivateMessage.find({ chatId })
        .populate('sender', 'username')
        .populate('recipient', 'username')
        .sort({ timestamp: -1 })
        .limit(50)
        .then(messages => messages.reverse());
      callback({ success: true, messages });
    } catch (err) {
      console.error('Get private chat messages error:', err);
      callback({ success: false, messages: [], error: 'Failed to fetch messages' });
    }
  });
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const userId = Array.from(socket.rooms).find(room => mongoose.Types.ObjectId.isValid(room));
    if (userId) {
      activeUsers.delete(userId);
      socket.rooms.forEach(room => {
        if (room !== socket.id && room !== userId) {
          io.to(room).emit('updateActiveUsers', activeUsers.size);
        }
      });
    }
  });
});
// Google Auth Routes
app.get('/auth/google', (req, res, next) => {
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});
app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', { failureRedirect: '/' }, (err, user) => {
    if (err || !user) {
      return res.redirect('/');
    }
    req.session.userId = user._id;
    req.session.lastActivity = Date.now();
    if (user.isAdmin) {
      res.redirect('/admin');
    } else if (!user.profession) {
      res.redirect('/account');
    } else {
      res.redirect('/news');
    }
  })(req, res, next);
});
app.get('/', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const userApps = await Application.find({}).select('name _id iconPath');
    const applications = userApps.map(app => ({
      id: app._id.toString(),
      name: app.name,
      iconPath: app.iconPath
    }));
    res.render('index', {
      user: req.user,
      note: req.note ? req.note.content : '',
      totalUsers,
      activeUsers: activeUsers.size,
      applications
    });
  } catch (err) {
    console.error('Index route error:', err);
    res.status(500).render('error', {
      message: 'Failed to load home page',
      user: req.user,
      note: req.note ? req.note.content : '',
      applications: []
    });
  }
});

app.get('/infographic', isAuthenticated, (req, res) => {
  try {
    res.render('infographic', {
      user: req.user,
      note: req.note ? req.note.content : ''
    });
  } catch (err) {
    console.error('Infographic route error:', err);
    res.status(500).render('error', { message: 'Failed to load infographic page', user: req.user, note: req.note ? req.note.content : '' });
  }
});

app.get('/bookhive', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    if (user.profession !== 'BookHive') {
      return res.status(403).render('error', {
        message: 'Access restricted to BookHive members',
        user: req.user,
        note: req.note ? req.note.content : ''
      });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newBooks = await Book.find({
      uploadDate: { $gte: today },
      visibility: { $in: ['public', 'restricted'] },
      uploadedBy: { $ne: req.session.userId }
    }).populate('uploadedBy', 'username').lean();
    const myBooks = await Book.find({
      uploadedBy: req.session.userId
    }).lean();
    const pendingRequests = await Request.find({
      requestedBy: user._id,
      status: 'pending'
    }).select('book').lean();
    const pendingBookIds = pendingRequests ? pendingRequests.map(req => req.book.toString()) : [];
    const booksWithStatus = newBooks.map(book => {
      const hasAccess = (
        Array.isArray(book.accessList) &&
        book.accessList.some(id => id.toString() === user._id.toString())
      ) || (
        book.uploadedBy &&
        book.uploadedBy._id &&
        book.uploadedBy._id.toString() === user._id.toString()
      );
      return {
        ...book,
        hasPendingRequest: pendingBookIds.includes(book._id.toString()),
        hasAccess
      };
    });
    res.render('bookhive', {
      user,
      newBooks: booksWithStatus,
      myBooks,
      pendingBookIds: pendingBookIds || [],
      note: req.note ? req.note.content : '',
      totalUsers: await User.countDocuments(),
      activeUsers: activeUsers.size,
      currentUser: user._id.toString()
    });
  } catch (err) {
    console.error('BookHive route error:', err);
    res.status(500).render('error', {
      message: 'Failed to load BookHive page',
      user: req.user,
      note: req.note ? req.note.content : ''
    });
  }
});
app.get('/signup', (req, res) => {
  res.render('signup', { user: req.user, note: req.note ? req.note.content : '', error: null });
});
app.post('/signup', async (req, res) => {
  try {
    const { username, email, password, profession } = req.body;
    if (!username || !email || !password || !profession) {
      return res.status(400).render('signup', { error: 'All fields are required', user: req.user, note: req.note ? req.note.content : '' });
    }
    
    // Server-side email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).render('signup', { error: 'Please enter a valid email address.', user: req.user, note: req.note ? req.note.content : '' });
    }

    // Server-side password strength validation
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).render('signup', { error: 'Password must be at least 8 characters long and contain at least one uppercase letter and one number.', user: req.user, note: req.note ? req.note.content : '' });
    }

    // Check if email domain is valid
    const isDomainValid = await verifyEmailDomain(email);
    if (!isDomainValid) {
        return res.status(400).render('signup', { error: 'The email provider does not exist or could not be reached. Please use a different email.', user: req.user, note: req.note ? req.note.content : '' });
    }


    if (!['BookHive'].includes(profession)) {
      return res.status(400).render('signup', { error: 'Invalid profession selected', user: req.user, note: req.note ? req.note.content : '' });
    }
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).render('signup', { error: 'User already exists', user: req.user, note: req.note ? req.note.content : '' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      email,
      password: hashedPassword,
      profession
    });
    await newUser.save();
    const newNote = new Note({
      user: newUser._id,
      content: ''
    });
    await newNote.save();
    try {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const emailTemplate = emailTemplates.welcomeEmail(newUser.username, baseUrl);
      const mailOptions = {
        from: `"BookHive Team" <${process.env.EMAIL_USER}>`,
        to: newUser.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
        text: `Welcome to BookHive, ${newUser.username}!\n\nThank you for joining our community. Explore, upload, and share your favorite books with BookHive.\n\nGet started by visiting: ${baseUrl}/bookhive\n\nBest regards,\nBookHive Team`,
        headers: {
            'X-Priority': '3',
            'X-MSMail-Priority': 'Normal',
            'Importance': 'Normal'
        }
      };
      await transporter.sendMail(mailOptions);
      console.log(`Welcome email sent to: ${newUser.email}`);
    } catch (emailErr) {
      console.error(`Error sending welcome email to ${newUser.email}:`, emailErr);
    }
    res.redirect('/');
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).render('signup', { error: 'Server error', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.get('/login', (req, res) => {
  res.render('login', { error: null, user: req.user, note: req.note ? req.note.content : '' });
});
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).render('login', { error: 'Email and password are required', user: req.user, note: req.note ? req.note.content : '' });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).render('login', { error: 'Invalid credentials', user: req.user, note: req.note ? req.note.content : '' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).render('login', { error: 'Invalid credentials', user: req.user, note: req.note ? req.note.content : '' });
    }
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    req.session.userId = user._id;
    req.session.lastActivity = Date.now();
    
    // Send login notification
    const ipAddress = req.ip || req.connection.remoteAddress || 'Unknown';
    const userAgent = req.get('user-agent') || 'Unknown';
    await sendLoginAlert(user, ipAddress, userAgent);
    
    if (user.isAdmin) {
      res.redirect('/admin');
    } else {
      res.redirect('/news');
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).render('login', { error: 'Server error', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).send('Failed to logout');
    }
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// ============== NOTIFICATION ROUTES ==============

// Get notifications page
app.get('/notifications', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    
    const notifications = await Notification.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    
    const unreadCount = notifications.filter(n => !n.isRead).length;
    
    res.render('notifications', {
      user,
      notifications,
      unreadCount,
      notificationPreferences: user.notificationPreferences,
      note: req.note ? req.note.content : ''
    });
  } catch (err) {
    console.error('Notifications page error:', err);
    res.status(500).render('error', { 
      message: 'Failed to load notifications', 
      user: req.user, 
      note: req.note ? req.note.content : '' 
    });
  }
});

// Mark notification as read
app.post('/notifications/mark-read/:notificationId', isAuthenticated, async (req, res) => {
  try {
    const { notificationId } = req.params;
    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { isRead: true },
      { new: true }
    );
    
    res.json({ success: true, notification });
  } catch (err) {
    console.error('Mark notification read error:', err);
    res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
app.post('/notifications/mark-all-read', isAuthenticated, async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true }
    );
    
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    console.error('Mark all notifications read error:', err);
    res.status(500).json({ success: false, message: 'Failed to mark all notifications as read' });
  }
});

// Delete notification
app.delete('/notifications/:notificationId', isAuthenticated, async (req, res) => {
  try {
    const { notificationId } = req.params;
    await Notification.findByIdAndDelete(notificationId);
    
    res.json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    console.error('Delete notification error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete notification' });
  }
});

// Get notification preferences
app.get('/notifications/preferences', isAuthenticated, (req, res) => {
  res.json({
    success: true,
    preferences: req.user.notificationPreferences
  });
});

// Update notification preferences
app.post('/notifications/preferences', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    const {
      emailNotifications,
      loginAlerts,
      newsUpdates,
      publicationUpdates,
      communityNotifications,
      browserNotifications,
      inAppNotifications,
      bookUpdates,
      commentNotifications,
      soundNotifications
    } = req.body;

    user.notificationPreferences = {
      emailNotifications: emailNotifications !== false,
      loginAlerts: loginAlerts !== false,
      newsUpdates: newsUpdates !== false,
      publicationUpdates: publicationUpdates !== false,
      communityNotifications: communityNotifications !== false,
      browserNotifications: browserNotifications !== false,
      inAppNotifications: inAppNotifications !== false,
      bookUpdates: bookUpdates !== false,
      commentNotifications: commentNotifications !== false,
      soundNotifications: soundNotifications !== false
    };

    await user.save();

    const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) {
      return res.json({ success: true, message: 'Notification preferences updated' });
    }

    res.redirect('/account');
  } catch (err) {
    console.error('Update preferences error:', err);
    const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
    if (isAjax) {
      return res.status(500).json({ success: false, message: 'Failed to update preferences' });
    }
    res.status(500).render('error', { 
      message: 'Failed to update notification preferences', 
      user: req.user, 
      note: req.note ? req.note.content : '' 
    });
  }
});

// Get unread notification count (for header badge)
app.get('/notifications/unread-count', isAuthenticated, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      user: req.user._id,
      isRead: false
    });
    
    res.json({ success: true, count });
  } catch (err) {
    console.error('Unread count error:', err);
    res.status(500).json({ success: false, count: 0 });
  }
});

// ============== END NOTIFICATION ROUTES ==============

app.get('/library', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const books = await Book.find({ uploadedBy: req.session.userId });
    res.render('library', {
      books,
      user,
      pinnedBooks: user.pinnedBooks,
      note: req.note ? req.note.content : ''
    });
  } catch (err) {
    console.error('Library error:', err);
    res.status(500).render('error', { message: 'Failed to load your library', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.get('/pinned', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    await user.populate('pinnedBooks');
    res.render('pinned', {
      pinnedBooks: user.pinnedBooks,
      user,
      note: req.note ? req.note.content : ''
    });
  } catch (err) {
    console.error('Pinned books error:', err);
    res.status(500).render('error', { message: 'Failed to load pinned books', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.post('/book/:bookId/pin', isAuthenticated, async (req, res) => {
  try {
    const bookId = req.params.bookId;
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot pin books' });
    }
    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }
    const isPinned = user.pinnedBooks.includes(bookId);
    if (isPinned) {
      user.pinnedBooks = user.pinnedBooks.filter(id => id.toString() !== bookId);
      book.pinCount = Math.max(0, book.pinCount - 1);
    } else {
      user.pinnedBooks.push(bookId);
      book.pinCount = (book.pinCount || 0) + 1;
    }
    await user.save();
    await book.save();
    res.json({
      success: true,
      isPinned: !isPinned,
      pinCount: book.pinCount
    });
  } catch (err) {
    console.error(`Pin/unpin error for bookId=${req.params.bookId}:`, err);
    res.status(500).json({ success: false, message: 'Failed to update pin status' });
  }
});
app.get('/upload', isAuthenticated, (req, res) => {
  const user = req.user;
  if (user.isAdmin) {
    return res.redirect('/admin');
  }
  res.render('upload', { user: req.user, note: req.note ? req.note.content : '' });
});
app.post('/upload', isAuthenticated, upload.single('file'), async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    if (!req.file) {
      return res.status(400).render('upload', { error: 'Please upload a file', user: req.user, note: req.note ? req.note.content : '' });
    }
    const { title, author, visibility, description, tags } = req.body;
    const tagArray = tags ? tags.split(',').map(tag => tag.trim()) : [];
    if (!['private', 'public', 'restricted'].includes(visibility)) {
      return res.status(400).render('upload', { error: 'Invalid visibility option', user: req.user, note: req.note ? req.note.content : '' });
    }
    const fileSize = req.file.size;
    if (user.storageUsed + fileSize > user.storageLimit) {
      return res.status(400).render('upload', {
        error: 'Storage limit exceeded. Delete some files or upgrade your plan.',
        user: req.user,
        note: req.note ? req.note.content : ''
      });
    }
    const fileType = getFileTypeFromMime(req.file.mimetype);
    if (!fileType) {
      return res.status(400).render('upload', { error: 'File type not supported. Allowed: PDF, DOCX, and images (JPG, PNG, GIF, WebP)', user: req.user, note: req.note ? req.note.content : '' });
    }
    
    // Validate file content
    const isValidFile = await validateFileContent(req.file.buffer, fileType);
    if (!isValidFile) {
      return res.status(400).render('upload', { error: 'File appears to be corrupted or invalid', user: req.user, note: req.note ? req.note.content : '' });
    }
    
    // Extract text and metadata
    let numPages = 0;
    let extractedText = '';
    try {
      const textData = await extractTextByType(req.file.buffer, fileType);
      numPages = textData.pages || 0;
      extractedText = textData.text ? textData.text.substring(0, 10000) : ''; // Store first 10k chars for search
    } catch (parseErr) {
      console.warn(`Warning: Error extracting text from ${fileType}:`, parseErr.message);
      numPages = 0;
      extractedText = '';
    }
    
    // Generate thumbnail
    let thumbnail = null;
    let thumbnailType = null;
    try {
      thumbnail = await generateThumbnail(req.file.buffer, req.file.mimetype);
      thumbnailType = 'image/png';
    } catch (thumbErr) {
      console.warn('Warning: Error generating thumbnail:', thumbErr.message);
    }

    // Upload file to GridFS
    let fileId;
    try {
      const uploadStream = global.gfs.openUploadStream(req.file.originalname, {
        metadata: {
          uploadedBy: req.session.userId,
          uploadDate: new Date(),
          fileType: fileType,
          contentType: req.file.mimetype
        }
      });
      
      await new Promise((resolve, reject) => {
        uploadStream.on('error', reject);
        uploadStream.on('finish', () => {
          fileId = uploadStream.id;
          resolve();
        });
        uploadStream.end(req.file.buffer);
      });
      
      console.log(`File uploaded to GridFS with ID: ${fileId}`);
    } catch (gridFsErr) {
      console.error('GridFS upload error:', gridFsErr);
      return res.status(500).render('upload', { error: 'Failed to store file: ' + gridFsErr.message, user: req.user, note: req.note ? req.note.content : '' });
    }

    const newBook = new Book({
      title,
      author,
      fileName: req.file.originalname,
      fileId: fileId, // Store GridFS file ID
      fileType,
      contentType: req.file.mimetype,
      thumbnail,
      thumbnailType,
      description,
      tags: tagArray,
      uploadedBy: req.session.userId,
      visibility,
      fileSize,
      numPages: numPages,
      extractedText: extractedText
    });
    await newBook.save();
    user.storageUsed += fileSize;
    await user.save();
    res.redirect('/bookhive');
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).render('upload', { error: err.message || 'Failed to upload file', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.get('/view/:bookId', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const book = await Book.findById(req.params.bookId);
    if (!book) {
      return res.status(404).render('error', { message: 'Book not found', user: req.user, note: req.note ? req.note.content : '' });
    }
    const isOwner = book.uploadedBy.toString() === req.session.userId;
    const hasAccess = book.accessList.includes(req.session.userId);
    const isPublic = book.visibility === 'public';
    if (!isOwner && !isPublic && !hasAccess) {
      return res.status(403).render('error', { message: 'Access denied', user: req.user, note: req.note ? req.note.content : '' });
    }
    // Use the new universal viewer
    res.render('universal-viewer', { book, user: req.user, note: req.note ? req.note.content : '', isPubDoc: false });
  } catch (err) {
    console.error('View error:', err);
    res.status(500).render('error', { message: 'Failed to load file', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.get('/file/:bookId', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).send('Admins cannot access this route');
    }
    const book = await Book.findById(req.params.bookId).select('fileId fileData contentType fileName visibility uploadedBy accessList');
    if (!book) {
      return res.status(404).send('File not found');
    }
    const isOwner = book.uploadedBy.toString() === req.session.userId;
    const hasAccess = book.accessList.includes(req.session.userId);
    const isPublic = book.visibility === 'public';
    if (!isOwner && !isPublic && !hasAccess) {
      return res.status(403).send('Access denied');
    }
    
    res.set({
      'Content-Type': book.contentType,
      'Content-Disposition': `inline; filename="${book.fileName}"`,
      'Cache-Control': 'public, max-age=3600, immutable',
      'ETag': `W/"${book._id}"`
    });
    
    // Try GridFS first, fall back to direct buffer for backward compatibility
    if (book.fileId && global.gfs) {
      try {
        const downloadStream = global.gfs.openDownloadStream(book.fileId);
        downloadStream.pipe(res);
        downloadStream.on('error', () => {
          // If GridFS fails, try fileData fallback
          if (book.fileData) {
            res.send(book.fileData);
          } else {
            res.status(404).send('File not found');
          }
        });
      } catch (gridFsErr) {
        console.warn('GridFS error, using fileData fallback:', gridFsErr.message);
        if (book.fileData) {
          res.send(book.fileData);
        } else {
          res.status(500).send('Failed to load file');
        }
      }
    } else if (book.fileData) {
      // Fallback for old documents
      res.send(book.fileData);
    } else {
      res.status(404).send('File not found');
    }
  } catch (err) {
    console.error('File fetch error:', err);
    res.status(500).send('Failed to load file');
  }
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end(); // No content - prevents 404 errors
});

app.get('/thumbnail/:bookId', async (req, res) => {
  try {
    const book = await Book.findById(req.params.bookId).select('coverImage coverImageType thumbnail thumbnailType visibility uploadedBy');
    
    // Return custom cover if available
    if (book && book.coverImage && book.coverImageType) {
      res.set({
        'Content-Type': book.coverImageType,
        'Content-Disposition': `inline; filename="cover-${book._id}.jpg"`
      });
      return res.send(book.coverImage);
    }

    // Fall back to generated thumbnail
    if (book && book.thumbnail) {
      res.set({
        'Content-Type': book.thumbnailType || 'image/png',
        'Content-Disposition': `inline; filename="thumbnail-${book._id}.png"`
      });
      return res.send(book.thumbnail);
    }

    // Return default placeholder
    res.set('Content-Type', 'image/svg+xml');
    const placeholderSvg = `<svg width="300" height="450" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#f3f4f6;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#e5e7eb;stop-opacity:1" />
        </linearGradient>
        <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="2" fill="#d1d5db" opacity="0.5"/>
        </pattern>
      </defs>
      <rect width="300" height="450" fill="url(#grad)"/>
      <rect width="300" height="450" fill="url(#dots)"/>
      <text x="150" y="200" font-family="Arial, sans-serif" font-size="48" fill="#9ca3af" text-anchor="middle" opacity="0.6">📖</text>
      <text x="150" y="260" font-family="Arial, sans-serif" font-size="16" fill="#6b7280" text-anchor="middle">No Cover</text>
    </svg>`;
    res.send(placeholderSvg);
  } catch (err) {
    console.error('Thumbnail fetch error:', err);
    res.status(500).send('Failed to load thumbnail');
  }
});
app.delete('/book/:id', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot delete books' });
    }
    const book = await Book.findOne({ _id: req.params.id, uploadedBy: req.session.userId });
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }
    user.storageUsed = Math.max(0, user.storageUsed - book.fileSize);
    await user.save();
    await User.updateMany(
      { pinnedBooks: book._id },
      { $pull: { pinnedBooks: book._id } }
    );
    await Book.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    console.error('Book deletion error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.put('/book/:bookId/visibility', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot modify book visibility' });
    }
    const { visibility } = req.body;
    if (!['private', 'public', 'restricted'].includes(visibility)) {
      return res.status(400).json({ success: false, message: 'Invalid visibility' });
    }
    const book = await Book.findById(req.params.bookId);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }
    if (book.uploadedBy.toString() !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    book.visibility = visibility;
    if (visibility !== 'restricted') {
      book.accessList = [];
    }
    await book.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Visibility update error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.get('/book/:bookId/access-list', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot access this route' });
    }
    const book = await Book.findById(req.params.bookId);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }
    if (book.uploadedBy.toString() !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    const users = await User.find({ _id: { $in: book.accessList } }).select('username email');
    res.json({ success: true, users });
  } catch (err) {
    console.error('Access list error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.delete('/book/:bookId/access/:userId', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot access this route' });
    }
    const book = await Book.findById(req.params.bookId);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }
    if (book.uploadedBy.toString() !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    book.accessList = book.accessList.filter(id => id.toString() !== req.params.userId);
    await book.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Remove access error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// NEW: Update book with notifications
app.post('/book/:bookId/update', isAuthenticated, upload.single('file'), async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot update books' });
    }

    const book = await Book.findById(req.params.bookId);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }

    if (book.uploadedBy.toString() !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    // If a new file is provided, update it
    if (req.file) {
      const newFileSize = req.file.size;
      const sizeDifference = newFileSize - book.fileSize;

      if (user.storageUsed + sizeDifference > user.storageLimit) {
        return res.status(400).json({ success: false, message: 'Storage limit exceeded after update' });
      }

      // Validate new file
      const isValidFile = await validateFileContent(req.file.buffer, book.fileType);
      if (!isValidFile) {
        return res.status(400).json({ success: false, message: 'Updated file appears to be corrupted' });
      }

      // Extract text from new file
      let extractedText = '';
      let numPages = 0;
      try {
        const textData = await extractTextByType(req.file.buffer, book.fileType);
        numPages = textData.pages || book.numPages;
        extractedText = textData.text ? textData.text.substring(0, 10000) : '';
      } catch (parseErr) {
        console.warn('Warning: Error extracting text from updated file:', parseErr.message);
      }

      // Generate new thumbnail
      let thumbnail = null;
      let thumbnailType = null;
      try {
        thumbnail = await generateThumbnail(req.file.buffer, req.file.mimetype);
        thumbnailType = 'image/png';
      } catch (thumbErr) {
        console.warn('Warning: Error generating thumbnail:', thumbErr.message);
      }

      // Update book
      book.fileData = req.file.buffer;
      book.fileSize = newFileSize;
      book.contentType = req.file.mimetype;
      book.fileName = req.file.originalname;
      book.extractedText = extractedText;
      book.numPages = numPages;
      if (thumbnail) {
        book.thumbnail = thumbnail;
        book.thumbnailType = thumbnailType;
      }
    }

    // Update metadata if provided
    if (req.body.title) book.title = req.body.title;
    if (req.body.author) book.author = req.body.author;
    if (req.body.description) book.description = req.body.description;
    if (req.body.tags) {
      book.tags = req.body.tags.split(',').map(tag => tag.trim());
    }

    // Update file size used
    if (req.file) {
      user.storageUsed += (req.file.size - book.fileSize);
      await user.save();
    }

    await book.save();

    // Send book update notifications to users with bookUpdates preference enabled
    if (book.visibility === 'public' && req.body.notifyUsers === 'true') {
      const updateSummary = req.body.updateSummary || `Updated with new content. Changes include: File updated by ${user.username}.`;
      await broadcastBookUpdateNotification(
        book._id,
        book.title,
        book.author,
        updateSummary
      );
    }

    res.json({ success: true, message: 'Book updated successfully' });
  } catch (err) {
    console.error('Book update error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to update book' });
  }
});

// Upload custom book cover image
app.post('/book/:bookId/upload-cover', isAuthenticated, upload.single('coverImage'), async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot upload covers' });
    }

    const book = await Book.findById(req.params.bookId);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }

    if (book.uploadedBy.toString() !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    console.log('Cover upload attempt - File:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      bufferSize: req.file.buffer ? req.file.buffer.length : 'no buffer'
    });

    // Validate image file type
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedImageTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ success: false, message: 'Only image files are allowed (JPG, PNG, GIF, WebP)' });
    }

    // Validate file size (max 5MB for cover)
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image file too large (max 5MB)' });
    }

    // Resize and optimize the cover image
    let coverImage = null;
    try {
      if (!req.file.buffer || req.file.buffer.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid file buffer' });
      }
      
      const sharpInstance = sharp(req.file.buffer, { failOn: 'none' });
      const metadata = await sharpInstance.metadata();
      console.log('Image metadata:', metadata);
      
      coverImage = await sharp(req.file.buffer)
        .resize(300, 450, { fit: 'cover', position: 'center', withoutEnlargement: true })
        .png({ quality: 80 })
        .toBuffer();
      
      if (!coverImage || coverImage.length === 0) {
        return res.status(400).json({ success: false, message: 'Failed to process image' });
      }
    } catch (imageErr) {
      console.error('Image processing error:', imageErr);
      return res.status(400).json({ success: false, message: `Invalid image file: ${imageErr.message}` });
    }

    // Update the book with custom cover
    book.coverImage = coverImage;
    book.coverImageType = 'image/png';
    await book.save();

    res.json({ success: true, message: 'Cover image uploaded successfully' });
  } catch (err) {
    console.error('Cover upload error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to upload cover' });
  }
});

// Delete custom book cover image
app.delete('/book/:bookId/cover', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot delete covers' });
    }

    const book = await Book.findById(req.params.bookId);
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }

    if (book.uploadedBy.toString() !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    book.coverImage = null;
    book.coverImageType = null;
    await book.save();

    res.json({ success: true, message: 'Cover image removed' });
  } catch (err) {
    console.error('Cover deletion error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to delete cover' });
  }
});

// Get book cover image (custom or generated thumbnail)
app.get('/book/:bookId/cover', async (req, res) => {
  try {
    const book = await Book.findById(req.params.bookId).select('coverImage coverImageType thumbnail thumbnailType visibility uploadedBy');
    if (!book) {
      return res.status(404).send('Book not found');
    }

    // If it's private, verify access
    if (book.visibility === 'private') {
      if (!req.user || book.uploadedBy.toString() !== req.user._id.toString()) {
        return res.status(403).send('Access denied');
      }
    }

    // Prefer custom cover image if available
    if (book.coverImage && book.coverImageType) {
      return res.set('Content-Type', book.coverImageType).send(book.coverImage);
    }

    // Fall back to generated thumbnail
    if (book.thumbnail && book.thumbnailType) {
      return res.set('Content-Type', book.thumbnailType).send(book.thumbnail);
    }

    // Return placeholder if no image available
    res.status(204).end();
  } catch (err) {
    console.error('Cover fetch error:', err);
    res.status(500).send('Failed to load cover');
  }
});

app.get('/explore', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const publicBooks = await Book.find({
      visibility: 'public',
      uploadedBy: { $ne: req.session.userId }
    }).populate('uploadedBy', 'username');
    const restrictedBooks = await Book.find({
      visibility: 'restricted',
      uploadedBy: { $ne: req.session.userId }
    }).populate('uploadedBy', 'username');
    const pendingRequests = await Request.find({
      requestedBy: req.session.userId,
      status: 'pending'
    }).select('book');
    const pendingBookIds = pendingRequests.map(req => req.book.toString());
    const trendingBooks = await Book.find({
      visibility: 'public',
      pinCount: { $gt: 0 }
    })
      .sort({ pinCount: -1 })
      .limit(5)
      .populate('uploadedBy', 'username');
    res.render('explore', {
      books: [...publicBooks, ...restrictedBooks],
      trendingBooks,
      pendingBookIds,
      currentUser: req.session.userId,
      user,
      pinnedBooks: user.pinnedBooks.map(id => id.toString()),
      note: req.note ? req.note.content : ''
    });
  } catch (err) {
    console.error('Explore error:', err);
    res.status(500).render('error', { message: 'Failed to load explore page', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.get('/my-requests', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const sentRequests = await Request.find({ requestedBy: req.session.userId })
      .populate('book', 'title author')
      .populate('bookOwner', 'username');
    res.render('my-requests', { requests: sentRequests, user: req.user, note: req.note ? req.note.content : '' });
  } catch (err) {
    console.error('My requests error:', err);
    res.status(500).render('error', { message: 'Failed to load requests', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.get('/access-requests', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const receivedRequests = await Request.find({
      bookOwner: req.session.userId,
      status: 'pending'
    })
      .populate('book', 'title author')
      .populate('requestedBy', 'username email');
    res.render('access-requests', { requests: receivedRequests, user: req.user, note: req.note ? req.note.content : '' });
  } catch (err) {
    console.error('Access requests error:', err);
    res.status(500).render('error', { message: 'Failed to load access requests', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.post('/handle-request/:requestId', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot handle requests' });
    }
    const { action } = req.body;
    if (!['approve', 'decline'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }
    const request = await Request.findById(req.params.requestId).populate('book');
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (request.bookOwner.toString() !== req.session.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    request.status = action === 'approve' ? 'approved' : 'declined';
    request.responseDate = new Date();
    await request.save();
    if (action === 'approve') {
      const book = await Book.findById(request.book._id);
      if (!book.accessList.includes(request.requestedBy)) {
        book.accessList.push(request.requestedBy);
        await book.save();
      }
    }
    res.json({ success: true, message: `Request ${action}d` });
  } catch (err) {
    console.error('Handle request error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.get('/account', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const storageUsedMB = (user.storageUsed / (1024 * 1024)).toFixed(1);
    const storageLimitMB = user.storageLimit / (1024 * 1024);
    const storagePercentage = ((user.storageUsed / user.storageLimit) * 100).toFixed(0);
    res.render('account', {
      user,
      storageUsedMB,
      storageLimitMB,
      storagePercentage,
      error: null,
      success: null,
      note: req.note ? req.note.content : ''
    });
  } catch (err) {
    console.error('Account error:', err);
    res.status(500).render('error', { message: 'Failed to load account', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.get('/account/storage-info', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot access this route' });
    }
    const storageUsedMB = (user.storageUsed / (1024 * 1024)).toFixed(1);
    const storageLimitMB = user.storageLimit / (1024 * 1024);
    const storagePercentage = ((user.storageUsed / user.storageLimit) * 100).toFixed(0);
    res.json({
      success: true,
      storageUsedMB,
      storageLimitMB,
      storagePercentage
    });
  } catch (err) {
    console.error('Storage info error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.post('/account/update-profile', isAuthenticated, formUpload, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const { username, email, currentPassword, profession } = req.body;
    const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
    if (!username || !email || (!user.googleId && !currentPassword) || !profession) {
      const errorMsg = 'All fields required';
      if (isAjax) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).render('account', {
        user,
        storageUsedMB: (user.storageUsed / (1024 * 1024)).toFixed(1),
        storageLimitMB: user.storageLimit / (1024 * 1024),
        storagePercentage: ((user.storageUsed / user.storageLimit) * 100).toFixed(0),
        error: errorMsg,
        success: null,
        note: req.note ? req.note.content : ''
      });
    }
    if (!user.googleId && !await bcrypt.compare(currentPassword, user.password)) {
      const errorMsg = 'Incorrect password';
      if (isAjax) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).render('account', {
        user,
        storageUsedMB: (user.storageUsed / (1024 * 1024)).toFixed(1),
        storageLimitMB: user.storageLimit / (1024 * 1024),
        storagePercentage: ((user.storageUsed / user.storageLimit) * 100).toFixed(0),
        error: errorMsg,
        success: null,
        note: req.note ? req.note.content : ''
      });
    }
    const existingUser = await User.findOne({
      $or: [{ username }, { email }],
      _id: { $ne: req.session.userId }
    });
    if (existingUser) {
      const errorMsg = 'Username or email taken';
      if (isAjax) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).render('account', {
        user,
        storageUsedMB: (user.storageUsed / (1024 * 1024)).toFixed(1),
        storageLimitMB: user.storageLimit / (1024 * 1024),
        storagePercentage: ((user.storageUsed / user.storageLimit) * 100).toFixed(0),
        error: errorMsg,
        success: null,
        note: req.note ? req.note.content : ''
      });
    }
    user.username = username;
    user.email = email;
    user.profession = profession;
    await user.save();
    if (isAjax) {
      return res.json({ success: true, message: 'Profile updated successfully' });
    }
    res.redirect('/account');
  } catch (err) {
    console.error('Update profile error:', err);
    const errorMsg = 'Server error';
    if (req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.status(500).json({ success: false, message: errorMsg });
    }
    res.status(500).render('account', {
      user: req.user,
      storageUsedMB: (req.user.storageUsed / (1024 * 1024)).toFixed(1),
      storageLimitMB: req.user.storageLimit / (1024 * 1024),
      storagePercentage: ((req.user.storageUsed / user.storageLimit) * 100).toFixed(0),
      error: errorMsg,
      success: null,
      note: req.note ? req.note.content : ''
    });
  }
});
app.post('/account/update-password', isAuthenticated, formUpload, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    if (user.googleId) {
      const errorMsg = 'Google users cannot change passwords';
      if (req.get('X-Requested-With') === 'XMLHttpRequest') {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).render('account', {
        user,
        storageUsedMB: (user.storageUsed / (1024 * 1024)).toFixed(1),
        storageLimitMB: user.storageLimit / (1024 * 1024),
        storagePercentage: ((user.storageUsed / user.storageLimit) * 100).toFixed(0),
        error: errorMsg,
        success: null,
        note: req.note ? req.note.content : ''
      });
    }
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
    if (!currentPassword || !newPassword || !confirmPassword) {
      const errorMsg = 'All fields required';
      if (isAjax) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).render('account', {
        user,
        storageUsedMB: (user.storageUsed / (1024 * 1024)).toFixed(1),
        storageLimitMB: user.storageLimit / (1024 * 1024),
        storagePercentage: ((user.storageUsed / user.storageLimit) * 100).toFixed(0),
        error: errorMsg,
        success: null,
        note: req.note ? req.note.content : ''
      });
    }
    if (!await bcrypt.compare(currentPassword, user.password)) {
      const errorMsg = 'Incorrect password';
      if (isAjax) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).render('account', {
        user,
        storageUsedMB: (user.storageUsed / (1024 * 1024)).toFixed(1),
        storageLimitMB: user.storageLimit / (1024 * 1024),
        storagePercentage: ((user.storageUsed / user.storageLimit) * 100).toFixed(0),
        error: errorMsg,
        success: null,
        note: req.note ? req.note.content : ''
      });
    }
    if (newPassword !== confirmPassword) {
      const errorMsg = 'Passwords do not match';
      if (isAjax) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).render('account', {
        user,
        storageUsedMB: (user.storageUsed / (1024 * 1024)).toFixed(1),
        storageLimitMB: user.storageLimit / (1024 * 1024),
        storagePercentage: ((user.storageUsed / user.storageLimit) * 100).toFixed(0),
        error: errorMsg,
        success: null,
        note: req.note ? req.note.content : ''
      });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    if (isAjax) {
      return res.json({ success: true, message: 'Password updated successfully' });
    }
    res.redirect('/account');
  } catch (err) {
    console.error('Update password error:', err);
    const errorMsg = 'Server error';
    if (req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.status(500).json({ success: false, message: errorMsg });
    }
    res.status(500).render('account', {
      user: req.user,
      storageUsedMB: (req.user.storageUsed / (1024 * 1024)).toFixed(1),
      storageLimitMB: req.user.storageLimit / (1024 * 1024),
      storagePercentage: ((req.user.storageUsed / user.storageLimit) * 100).toFixed(0),
      error: errorMsg,
      success: null,
      note: req.note ? req.note.content : ''
    });
  }
});
app.post('/account/delete', isAuthenticated, formUpload, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const { password, confirmDelete } = req.body;
    const isAjax = req.get('X-Requested-With') === 'XMLHttpRequest';
    if (!confirmDelete || (!user.googleId && !password)) {
      const errorMsg = 'Password and confirmation required';
      if (isAjax) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).render('account', {
        user,
        storageUsedMB: (user.storageUsed / (1024 * 1024)).toFixed(1),
        storageLimitMB: user.storageLimit / (1024 * 1024),
        storagePercentage: ((user.storageUsed / user.storageLimit) * 100).toFixed(0),
        error: errorMsg,
        success: null,
        note: req.note ? req.note.content : ''
      });
    }
    if (!user.googleId && !await bcrypt.compare(password, user.password)) {
      const errorMsg = 'Incorrect password';
      if (isAjax) {
        return res.status(400).json({ success: false, message: errorMsg });
      }
      return res.status(400).render('account', {
        user,
        storageUsedMB: (user.storageUsed / (1024 * 1024)).toFixed(1),
        storageLimitMB: user.storageLimit / (1024 * 1024),
        storagePercentage: ((user.storageUsed / user.storageLimit) * 100).toFixed(0),
        error: errorMsg,
        success: null,
        note: req.note ? req.note.content : ''
      });
    }
    await Book.deleteMany({ uploadedBy: user._id });
    await Request.deleteMany({ $or: [{ requestedBy: user._id }, { bookOwner: user._id }] });
    await Book.updateMany(
      { accessList: user._id },
      { $pull: { accessList: user._id } }
    );
    await Note.deleteOne({ user: user._id });
    await Feedback.deleteMany({ user: user._id });
    await Message.deleteMany({ user: user._id });
    await User.deleteOne({ _id: user._id });
    return req.session.destroy(err => {
      if (err) {
        console.error('Session destroy error:', err);
        const errorMsg = 'Failed to delete account';
        if (isAjax) {
          return res.status(500).json({ success: false, message: errorMsg });
        }
        return res.status(500).render('error', { message: errorMsg, user: null, note: '' });
      }
      res.clearCookie('connect.sid');
      if (isAjax) {
        return res.json({ success: true, message: 'Account deleted successfully', redirect: '/' });
      }
      res.redirect('/');
    });
  } catch (err) {
    console.error('Delete account error:', err);
    const errorMsg = 'Server error';
    if (req.get('X-Requested-With') === 'XMLHttpRequest') {
      return res.status(500).json({ success: false, message: errorMsg });
    }
    res.status(500).render('account', {
      user: req.user,
      storageUsedMB: (req.user.storageUsed / (1024 * 1024)).toFixed(1),
      storageLimitMB: req.user.storageLimit / (1024 * 1024),
      storagePercentage: ((req.user.storageUsed / user.storageLimit) * 100).toFixed(0),
      error: errorMsg,
      success: null,
      note: req.note ? req.note.content : ''
    });
  }
});
app.post('/notes/save', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot save notes' });
    }
    const { content } = req.body;
    let note = await Note.findOne({ user: req.session.userId });
    const sanitizedContent = sanitizeHtml(content || '', {
      allowedTags: ['b', 'i', 'u', 'br'],
      allowedAttributes: {}
    });
    if (!note) {
      note = new Note({
        user: req.session.userId,
        content: sanitizedContent
      });
    } else {
      note.content = sanitizedContent;
      note.updatedAt = new Date();
    }
    await note.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Save note error:', err);
    res.status(500).json({ success: false, message: 'Failed to save note' });
  }
});
app.get('/explore/search', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot access this route' });
    }
    const { query } = req.query;
    if (!query) {
      return res.json({ books: [] });
    }
    const searchRegex = new RegExp(query, 'i');
    const publicBooks = await Book.find({
      visibility: 'public',
      uploadedBy: { $ne: req.session.userId },
      $or: [
        { title: searchRegex },
        { author: searchRegex },
        { tags: searchRegex }
      ]
    }).populate('uploadedBy', 'username');
    const accessibleBooks = await Book.find({
      visibility: 'restricted',
      accessList: req.session.userId,
      uploadedBy: { $ne: req.session.userId },
      $or: [
        { title: searchRegex },
        { author: searchRegex },
        { tags: searchRegex }
      ]
    }).populate('uploadedBy', 'username');
    res.json({ books: [...publicBooks, ...accessibleBooks] });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.get('/library/search', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot access this route' });
    }
    const { query } = req.query;
    if (!query) {
      return res.json({ books: [] });
    }
    const searchRegex = new RegExp(query, 'i');
    const userBooks = await Book.find({
      uploadedBy: req.session.userId,
      $or: [
        { title: searchRegex },
        { author: searchRegex },
        { tags: searchRegex }
      ]
    });
    res.json({ books: userBooks });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.post('/feedback', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot submit feedback' });
    }
    const { content } = req.body;
    if (!content || content.trim() === '') {
      return res.status(400).json({ success: false, message: 'Feedback content is required' });
    }
    const sanitizedContent = sanitizeHtml(content, {
      allowedTags: [],
      allowedAttributes: {}
    });
    const feedback = new Feedback({
      user: req.session.userId,
      content: sanitizedContent
    });
    await feedback.save();
    res.json({ success: true, message: 'Feedback submitted successfully' });
  } catch (err) {
    console.error('Feedback submission error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.get('/news', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newBooks = await Book.find({
      uploadDate: { $gte: today },
      visibility: { $in: ['public', 'restricted'] },
      uploadedBy: { $ne: null }
    }).populate('uploadedBy', 'username').lean();
    const pendingRequests = await Request.find({
      requestedBy: user._id,
      status: 'pending'
    }).select('book').lean();
    const pendingBookIds = pendingRequests.map(req => req.book.toString());
    const news = await News.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('postedBy', 'username')
      .lean();
    const booksWithStatus = newBooks.map(book => {
      const hasAccess = (
        Array.isArray(book.accessList) && book.accessList.some(id => id.toString() === user._id.toString())
      ) || (
        book.uploadedBy && book.uploadedBy._id && book.uploadedBy._id.toString() === user._id.toString()
      );
      return {
        ...book,
        hasPendingRequest: pendingBookIds.includes(book._id.toString()),
        hasAccess
      };
    });
    res.render('news', {
      newBooks: booksWithStatus,
      news,
      user,
      note: req.note ? req.note.content : ''
    });
  } catch (err) {
    console.error('News route error:', err.stack);
    res.status(500).render('error', { message: 'Failed to load news page', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.get('/news-image/:newsId', async (req, res) => {
  try {
    const news = await News.findById(req.params.newsId);
    if (!news || !news.image) {
      return res.status(404).send('Image not found');
    }
    res.set({
      'Content-Type': news.imageType || 'image/jpeg',
      'Content-Disposition': `inline; filename="news-${news._id}.jpg"`
    });
    res.send(news.image);
  } catch (err) {
    console.error('News image fetch error:', err);
    res.status(500).send('Failed to load image');
  }
});
app.get('/admin', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const professions = ['BookHive'];
    const conversations = {};
    for (const profession of professions) {
      const messages = await Message.find({ profession })
        .sort({ timestamp: -1 })
        .limit(50)
        .populate('user', 'username')
        .lean();
      conversations[profession] = messages.reverse();
    }
    res.render('admin', {
      user: req.user,
      conversations,
      success: req.query.success || null,
      error: req.query.error || null,
      note: req.note ? req.note.content : ''
    });
  } catch (err) {
    console.error('Admin dashboard error:', err);
    res.status(500).render('error', { message: 'Failed to load admin dashboard', user: req.user, note: req.note ? req.note.content : '' });
  }
});
app.post('/admin/news/post', isAuthenticated, isAdmin, newsImageUpload.single('image'), async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.redirect('/admin?error=Title and content are required');
    }
    const sanitizedTitle = sanitizeHtml(title, {
      allowedTags: ['b', 'i', 'u', 'strong', 'em'],
      allowedAttributes: {}
    });
    const sanitizedContent = sanitizeHtml(content, {
      allowedTags: ['p', 'br', 'b', 'i', 'u', 'strong', 'em', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'span'],
      allowedAttributes: {
        'a': ['href', 'title'],
        'span': ['style']
      },
      allowedStyles: {
        'span': {
          'color': [/^#(0-9a-fA-F]{6})$/],
          'font-size': [/^\d+(px|em|rem)$/],
          'font-weight': [/^bold$/],
          'font-style': [/^italic$/],
          'text-decoration': [/^underline$/]
        }
      }
    });
    const newsData = {
      title: sanitizedTitle,
      content: sanitizedContent,
      postedBy: req.session.userId
    };
    if (req.file) {
      newsData.image = req.file.buffer;
      newsData.imageType = req.file.mimetype;
    }
    const news = new News(newsData);
    await news.save();
    
    // Send notifications to all users using the new notification system
    await broadcastNewsNotification(news._id, sanitizedTitle, sanitizedContent);
    
    res.redirect('/admin?success=News posted successfully and notifications sent');
  } catch (err) {
    console.error('News post error:', err);
    res.redirect('/admin?error=Failed to post news');
  }
});
app.post('/request-access', isAuthenticated, async (req, res) => {
  try {
    const { bookId } = req.body;
    const user = req.user;
    if (!bookId) {
      return res.status(400).json({ success: false, message: 'Book ID is required' });
    }
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot request access' });
    }
    const book = await Book.findById(bookId).populate('uploadedBy', 'username email profession');
    if (!book) {
      return res.status(404).json({ success: false, message: 'Book not found' });
    }
    if (book.visibility !== 'restricted' || book.uploadedBy.toString() === user._id || book.accessList.includes(user._id)) {
      return res.status(400).json({ success: false, message: 'Access already granted or not required' });
    }
    const existingRequest = await Request.findOne({
      book: bookId,
      requestedBy: user._id,
      status: 'pending'
    });
    if (existingRequest) {
      return res.status(400).json({ success: false, message: 'Access request already pending' });
    }
    const accessRequest = new Request({
      book: bookId,
      requestedBy: user._id,
      bookOwner: book.uploadedBy._id,
      status: 'pending'
    });
    await accessRequest.save();
    try {
      const mailOptions = {
        from: `"BookHive Team" <${process.env.EMAIL_USER}>`,
        to: book.uploadedBy.email,
        subject: `Access Request for ${book.title}`,
        html: `
          <h2>Access Request for Restricted Book</h2>
          <p>User <strong>${user.username}</strong> has requested access to your book "<strong>${book.title}</strong>".</p>
          <p>Please review the request and grant access if appropriate.</p>
          <p>Visit <a href="https://bookhive-rsd.onrender.com/access-requests">Access Requests</a> to manage this request.</p>
          <p>Best regards,<br>BookHive Team</p>
        `,
        text: `Access Request for Restricted Book\n\nUser ${user.username} has requested access to your book "${book.title}".\n\nPlease review the request and grant access if appropriate.\n\nVisit Access Requests to manage this request: https://bookhive-rsd.onrender.com/access-requests\n\nBest regards,\nBookHive Team`,
        headers: {
            'X-Priority': '3',
            'X-MSMail-Priority': 'Normal',
            'Importance': 'Normal'
        }
      };
      await transporter.sendMail(mailOptions);
    } catch (emailErr) {
      console.error(`Error sending access request email:`, emailErr);
    }
    res.setHeader('Content-Type', 'application/json');
    return res.json({ success: true, message: 'Access request sent successfully' });
  } catch (err) {
    console.error('Request access error:', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.get('/publications', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const publications = await Publication.find()
      .sort({ createdAt: -1 })
      .populate('postedBy', 'username')
      .lean();
    const comments = await Comment.find()
      .populate('user', 'username')
      .lean();
    const commentsByPublication = {};
    comments.forEach(comment => {
      const pubId = comment.publication.toString();
      if (!commentsByPublication[pubId]) {
        commentsByPublication[pubId] = [];
      }
      commentsByPublication[pubId].push(comment);
    });
    res.render('publications', {
      publications,
      comments: commentsByPublication,
      user,
      note: req.note ? req.note.content : ''
    });
  } catch (err) {
    console.error('Publications error:', err);
    res.status(500).render('error', { message: 'Failed to load publications', user: req.user, note: req.note ? req.note.content : '' });
  }
});
// Update the /publication post route to support multiple images and PDFs
app.post('/publication', isAuthenticated, (req, res, next) => {
  // **FIXED**: Added a specific Multer error handler for this route
  publicationUpload(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      // A Multer error occurred when uploading.
      return res.status(400).json({ success: false, message: `File upload error: ${err.message}` });
    } else if (err) {
      // An unknown error occurred when uploading.
      return res.status(500).json({ success: false, message: `An unknown error occurred: ${err.message}` });
    }
    // Everything went fine, proceed to the route handler.
    next();
  });
}, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot post publications' });
    }
    const { content } = req.body;
    if (!content || content.trim() === '' || content === '<p><br></p>' || content === '<p></p>') {
      return res.status(400).json({ success: false, message: 'Content is required' });
    }
    const sanitizedContent = sanitizeHtml(content, {
      allowedTags: ['p', 'br', 'b', 'i', 'u', 'strong', 'em', 'a', 'span', 'ol', 'ul', 'li'],
      allowedAttributes: {
        'a': ['href', 'title'],
        'span': ['style']
      },
      allowedStyles: {
        'span': {
          'color': [/^#(0-9a-fA-F]{6})$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
          'background-color': [/^#(0-9a-fA-F]{6})$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
          'font-size': [/^\d+(px|em|rem)$/],
          'font-weight': [/^bold$/],
          'font-style': [/^italic$/],
          'text-decoration': [/^underline$/]
        }
      }
    });
    const images = [];
    const documents = [];
    for (const file of req.files || []) {
      if (file.mimetype.startsWith('image/')) {
        images.push({
          data: file.buffer,
          contentType: file.mimetype,
          filename: file.originalname
        });
      } else if (file.mimetype === 'application/pdf') {
        const isSafe = await validatePdfContent(file.buffer);
        if (!isSafe) {
          return res.status(400).json({ success: false, message: `Adult content detected in PDF (${file.originalname}). Cannot upload.` });
        }
        documents.push({
          data: file.buffer,
          contentType: file.mimetype,
          filename: file.originalname
        });
      }
    }
    const publication = new Publication({
      content: sanitizedContent,
      postedBy: user._id,
      images,
      documents
    });
    await publication.save();
    const populatedPublication = await Publication.findById(publication._id).populate('postedBy', 'username');
    io.emit('newPublication', populatedPublication);
    
    // Send notifications to all users using the new notification system (excluding the publisher)
    const previewText = sanitizedContent.replace(/<[^>]*>?/gm, '').substring(0, 200);
    await broadcastPublicationNotification(publication._id, user._id, user.username, previewText);
    
    res.json({ success: true, message: 'Publication posted successfully' });
  } catch (err) {
    console.error('Publication post error:', err);
    // Send a JSON response for AJAX calls
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});
// Serve publication files (images or documents)
app.get('/publication-file/:pubId/:type/:index', isAuthenticated, async (req, res) => {
  try {
    const { pubId, type, index } = req.params;
    const pub = await Publication.findById(pubId);
    if (!pub) {
      return res.status(404).send('Publication not found');
    }
    let file;
    const idx = parseInt(index);
    if (type === 'image' && pub.images[idx]) {
      file = pub.images[idx];
    } else if (type === 'document' && pub.documents[idx]) {
      file = pub.documents[idx];
    }
    if (!file) {
      return res.status(404).send('File not found');
    }
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `inline; filename="${file.filename}"`
    });
    res.send(file.data);
  } catch (err) {
    console.error('Publication file fetch error:', err);
    res.status(500).send('Failed to load file');
  }
});
// View publication document in universal viewer
app.get('/view-pub-doc/:pubId/:index', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const pub = await Publication.findById(req.params.pubId);
    if (!pub) {
      return res.status(404).render('error', { message: 'Publication not found', user: req.user, note: req.note ? req.note.content : '' });
    }
    const index = parseInt(req.params.index);
    const doc = pub.documents[index];
    if (!doc) {
      return res.status(404).render('error', { message: 'Document not found', user: req.user, note: req.note ? req.note.content : '' });
    }
    
    // Determine file type from content type
    let fileType = 'pdf';
    if (doc.contentType === 'application/pdf') fileType = 'pdf';
    else if (doc.contentType.startsWith('image/')) fileType = 'image';
    else if (doc.contentType.includes('wordprocessingml') || doc.contentType.includes('word')) fileType = 'docx';
    
    const tempBook = {
      _id: `${pub._id}-${index}`,
      title: doc.filename,
      fileName: doc.filename,
      author: pub.postedBy ? 'Publication' : 'Unknown',
      fileType: fileType,
      pubId: pub._id,
      docIndex: index
    };
    res.render('universal-viewer', { book: tempBook, user: req.user, note: req.note ? req.note.content : '', isPubDoc: true });
  } catch (err) {
    console.error('View publication document error:', err);
    res.status(500).render('error', { message: 'Failed to load document', user: req.user, note: req.note ? req.note.content : '' });
  }
});

// Get publication document file
app.get('/pub-file/:pubId/:index', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).send('Access denied');
    }
    const pub = await Publication.findById(req.params.pubId);
    if (!pub) {
      return res.status(404).send('Publication not found');
    }
    const index = parseInt(req.params.index);
    const doc = pub.documents[index];
    if (!doc) {
      return res.status(404).send('Document not found');
    }
    res.set({
      'Content-Type': doc.contentType,
      'Content-Disposition': `inline; filename="${doc.filename}"`,
      'Cache-Control': 'public, max-age=3600, immutable'
    });
    res.send(doc.data);
  } catch (err) {
    console.error('Publication file fetch error:', err);
    res.status(500).send('Failed to load file');
  }
});
app.post('/publication/:id/like', isAuthenticated, async (req, res) => {
  try {
    const userId = req.user._id;
    const publicationId = req.params.id;
    const publication = await Publication.findById(publicationId);
    if (!publication) {
      return res.status(404).json({ success: false, message: 'Publication not found' });
    }
    const hasLiked = publication.likes.some(id => id.equals(userId));
    if (hasLiked) {
      publication.likes = publication.likes.filter(id => !id.equals(userId));
      publication.likeCount = Math.max(0, (publication.likeCount || 0) - 1);
    } else {
      publication.likes.push(userId);
      publication.likeCount = (publication.likeCount || 0) + 1;
    }
    await publication.save();
    io.emit('publicationLiked', {
      publicationId,
      likeCount: publication.likeCount,
      isLiked: !hasLiked
    });
    res.json({
      success: true,
      message: hasLiked ? 'Publication unliked' : 'Publication liked',
      likeCount: publication.likeCount,
      isLiked: !hasLiked
    });
  } catch (err) {
    console.error('Error liking publication:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.post('/publication/:publicationId/comment', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot comment on publications' });
    }
    const { content } = req.body;
    if (!content || content.trim() === '') {
      return res.status(400).json({ success: false, message: 'Comment content is required' });
    }
    const sanitizedContent = sanitizeHtml(content, {
      allowedTags: [],
      allowedAttributes: {}
    });
    const comment = new Comment({
      publication: req.params.publicationId,
      user: user._id,
      content: sanitizedContent
    });
    await comment.save();
    const populatedComment = await Comment.findById(comment._id).populate('user', 'username');
    res.json({ success: true, comment: populatedComment });
  } catch (err) {
    console.error('Comment publication error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/validate-pdf', isAuthenticated, upload.single('file'), async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot validate files' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    const fileType = getFileTypeFromMime(req.file.mimetype);
    if (!fileType) {
      return res.status(400).json({ success: false, message: 'Only PDF, DOCX, and image files (JPG, PNG, GIF, WebP) are allowed' });
    }
    const isSafe = await validatePdfContent(req.file.buffer);
    if (!isSafe) {
      return res.status(400).json({ success: false, message: 'Adult content detected. This file cannot be uploaded.' });
    }
    res.json({ success: true, isSafe: true });
  } catch (err) {
    console.error('PDF validation error:', err);
    res.status(500).json({ success: false, message: 'Failed to validate file' });
  }
});

// Route to render a specific application
app.get('/applications/:appId', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).render('error', {
        message: 'Admins cannot access applications',
        user,
        note: req.note ? req.note.content : ''
      });
    }
    const appId = req.params.appId;
    let appPath = path.join(__dirname, 'applications', `${appId}.js`);
    let isStaticApp = true;
    try {
      await fs.access(appPath);
    } catch {
      isStaticApp = false;
      const userApp = await Application.findById(appId);
      if (!userApp) {
        return res.status(404).render('error', {
          message: 'Application not found',
          user,
          note: req.note ? req.note.content : ''
        });
      }
      appPath = userApp.filePath;
    }
    let appName = isStaticApp
      ? appId.replace(/-/g, ' ').toUpperCase()
      : (await Application.findById(appId))?.name || 'User Application';
    const applications = await Application.find({}).select('name _id').lean();
    res.render('application', {
      applications: applications.map(app => ({
        id: app._id.toString(),
        name: app.name,
        iconPath: `/app-icon/${app._id}`
      })),
      appId,
      appName,
      user,
      note: req.note ? req.note.content : '',
      currentPage: 'applications'
    });
  } catch (err) {
    console.error('Application load error:', err);
    res.status(500).render('error', {
      message: 'Failed to load application',
      user,
      note: req.note ? req.note.content : ''
    });
  }
});

// Translation route for text-translator.js
app.post('/translate', isAuthenticated, async (req, res) => {
  try {
    const { text, sourceLang, targetLang } = req.body;

    if (!text || !targetLang) {
      return res.status(400).json({ success: false, message: 'Text and target language are required' });
    }
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot use translation feature' });
    }
    // Construct prompt for Gemini AI
    const prompt = `Translate ${text} to ${targetLang}. Translate to only specified languages. Provide response also for specified languages. And Provide only the translated text without any additional commentary or formatting.`;
    // Call Gemini API using the existing callGeminiAPI function
    const translatedText = await callGeminiAPI(prompt, text);

    res.json({ success: true, translatedText: translatedText || 'Translation failed' });
  } catch (err) {
    console.error('Translation error:', err);
    res.status(500).json({ success: false, message: `Error: ${err.message}` });
  }
});
app.get('/community', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const users = await User.find({ _id: { $ne: user._id }, isAdmin: false }).select('username _id');
    const chatRequests = await PrivateChatRequest.find({
      $or: [{ requester: user._id }, { recipient: user._id }]
    })
      .populate('requester', 'username')
      .populate('recipient', 'username');
    const activeChats = await PrivateChatRequest.find({
      status: 'accepted',
      $or: [{ requester: user._id }, { recipient: user._id }]
    })
      .populate('requester', 'username')
      .populate('recipient', 'username');
    const privateMessages = await PrivateMessage.find({
      $or: [{ sender: user._id }, { recipient: user._id }]
    })
      .populate('sender', 'username')
      .populate('recipient', 'username')
      .sort({ timestamp: -1 })
      .limit(100);
    const messages = await Message.find({ profession: user.profession })
      .sort({ timestamp: -1 })
      .limit(50)
      .populate('user', 'username')
      .then(messages => messages.reverse());
    // Filter out users who already have an active chat
    const activeChatUserIds = activeChats.map(chat =>
      chat.requester._id.toString() === user._id.toString() ? chat.recipient._id.toString() : chat.requester._id.toString()
    );
    const availableUsers = users.filter(u => !activeChatUserIds.includes(u._id.toString()));
    res.render('community', {
      user,
      users: availableUsers,
      chatRequests,
      activeChats,
      privateMessages,
      messages,
      note: req.note ? req.note.content : '',
      totalUsers: await User.countDocuments(),
      activeUsers: activeUsers.size,
      currentPath: '/community'
    });
  } catch (err) {
    console.error('Community page error:', err);
    res.status(500).render('error', {
      message: 'Failed to load community page',
      user: req.user,
      note: req.note ? req.note.content : '',
      currentPath: '/error'
    });
  }
});
app.get('/private-chat/:chatId', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot access private chats' });
    }
    const chatId = req.params.chatId;
    const chatRequest = await PrivateChatRequest.findOne({
      status: 'accepted',
      $or: [
        { requester: user._id, recipient: { $in: chatId.split('_') } },
        { recipient: user._id, requester: { $in: chatId.split('_') } }
      ]
    });
    if (!chatRequest) {
      return res.status(403).json({ success: false, message: 'No active chat found' });
    }
    const messages = await PrivateMessage.find({ chatId })
      .populate('sender', 'username')
      .populate('recipient', 'username')
      .sort({ timestamp: -1 })
      .limit(50);
    res.json({ success: true, messages: messages.reverse() });
  } catch (err) {
    console.error('Private chat history error:', err);
    res.status(500).json({ success: false, message: 'Failed to load chat history' });
  }
});

// COMMUNITY FEATURE APIs
// Discussions API
app.get('/api/discussions', isAuthenticated, async (req, res) => {
  try {
    const discussions = await Message.find({ 
      profession: req.user.profession,
      isDiscussion: true 
    })
    .populate('user', 'username')
    .sort({ timestamp: -1 })
    .limit(20);
    
    res.json({ success: true, discussions: discussions || [] });
  } catch (err) {
    console.error('Error fetching discussions:', err);
    res.status(500).json({ success: false, message: 'Failed to load discussions' });
  }
});

app.post('/api/discussions', isAuthenticated, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ success: false, message: 'Question required' });
    }
    
    const discussion = new Message({
      user: req.user._id,
      content: content,
      profession: req.user.profession,
      isDiscussion: true,
      category: 'general',
      tags: [],
      timestamp: new Date()
    });
    
    await discussion.save();
    await discussion.populate('user', 'username');
    
    res.json({ success: true, message: 'Question posted!', discussion });
  } catch (err) {
    console.error('Error creating discussion:', err);
    res.status(500).json({ success: false, message: 'Failed to post question' });
  }
});

// Respond to a discussion
app.post('/api/discussions/:id/respond', isAuthenticated, async (req, res) => {
  try {
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ success: false, message: 'Response required' });
    }
    
    const response = new Message({
      user: req.user._id,
      content: content,
      profession: req.user.profession,
      isResponse: true,
      responseToId: req.params.id,
      timestamp: new Date()
    });
    
    await response.save();
    await response.populate('user', 'username name');
    
    res.json({ success: true, message: 'Response posted!', response });
  } catch (err) {
    console.error('Error posting response:', err);
    res.status(500).json({ success: false, message: 'Failed to post response' });
  }
});

// Get responses for a discussion
app.get('/api/discussions/:id/responses', isAuthenticated, async (req, res) => {
  try {
    const responses = await Message.find({
      responseToId: req.params.id,
      isResponse: true,
      isDiscussion: false,
      isEvent: false,
      isGroup: false,
      isGroupMessage: false
    })
    .populate('user', 'username name')
    .sort({ timestamp: 1 });
    
    res.json({ success: true, responses });
  } catch (err) {
    console.error('Error fetching responses:', err);
    res.status(500).json({ success: false, message: 'Failed to load responses' });
  }
});

// Events API
app.get('/api/events', isAuthenticated, async (req, res) => {
  try {
    const events = await Message.find({ 
      profession: req.user.profession,
      isEvent: true 
    })
    .populate('user', 'username')
    .sort({ timestamp: -1 })
    .limit(20);
    
    res.json({ success: true, events: events.map(e => ({
      _id: e._id,
      title: e.eventTitle || 'Untitled Event',
      description: e.content,
      startDate: e.eventStart || e.timestamp,
      endDate: e.eventEnd || e.timestamp,
      type: e.eventType || 'meetup',
      attendees: e.eventAttendees || 0,
      user: e.user
    })) || [] });
  } catch (err) {
    console.error('Error fetching events:', err);
    res.status(500).json({ success: false, message: 'Failed to load events' });
  }
});

app.post('/api/events', isAuthenticated, async (req, res) => {
  try {
    const { title, description, startDate, endDate, eventType } = req.body;
    
    if (!title) {
      return res.status(400).json({ success: false, message: 'Title required' });
    }
    
    const event = new Message({
      user: req.user._id,
      content: description || '',
      eventTitle: title,
      eventStart: startDate ? new Date(startDate) : new Date(),
      eventEnd: endDate ? new Date(endDate) : new Date(),
      eventType: eventType || 'meeting',
      profession: req.user.profession,
      isEvent: true,
      timestamp: new Date()
    });
    
    await event.save();
    await event.populate('user', 'username');
    
    res.json({ success: true, message: 'Event created!', event });
  } catch (err) {
    console.error('Error creating event:', err);
    res.status(500).json({ success: false, message: 'Failed to create event' });
  }
});

app.post('/api/events/:eventId/join', isAuthenticated, async (req, res) => {
  try {
    const event = await Message.findById(req.params.eventId);
    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }
    
    if (!event.eventAttendees) event.eventAttendees = 0;
    event.eventAttendees++;
    await event.save();
    
    res.json({ success: true, message: 'Joined event successfully!' });
  } catch (err) {
    console.error('Error joining event:', err);
    res.status(500).json({ success: false, message: 'Failed to join event' });
  }
});

// Groups API
app.get('/api/groups', isAuthenticated, async (req, res) => {
  try {
    const groups = await Message.find({ 
      profession: req.user.profession,
      isGroup: true 
    })
    .populate('user', 'username')
    .sort({ timestamp: -1 })
    .limit(20);
    
    res.json({ success: true, groups: groups.map(g => ({
      _id: g._id,
      name: g.groupName || 'Untitled Group',
      description: g.content,
      members: g.groupMembers || 0,
      posts: g.groupPosts || 0,
      user: g.user
    })) || [] });
  } catch (err) {
    console.error('Error fetching groups:', err);
    res.status(500).json({ success: false, message: 'Failed to load groups' });
  }
});

app.post('/api/groups', isAuthenticated, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, message: 'Group name required' });
    }
    
    const group = new Message({
      user: req.user._id,
      content: description || '',
      groupName: name,
      profession: req.user.profession,
      isGroup: true,
      groupMembers: 1,
      groupMembersList: [req.user._id],
      groupPosts: 0,
      timestamp: new Date()
    });
    
    await group.save();
    await group.populate('user', 'username');
    
    res.json({ success: true, message: 'Group created!', group });
  } catch (err) {
    console.error('Error creating group:', err);
    res.status(500).json({ success: false, message: 'Failed to create group' });
  }
});

app.post('/api/groups/:groupId/join', isAuthenticated, async (req, res) => {
  try {
    const group = await Message.findById(req.params.groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }
    
    // Check if user already joined
    if (!group.groupMembersList) {
      group.groupMembersList = [];
    }
    
    if (group.groupMembersList.includes(req.user._id)) {
      return res.json({ success: false, message: 'You already joined this group' });
    }
    
    group.groupMembersList.push(req.user._id);
    if (!group.groupMembers) group.groupMembers = 0;
    group.groupMembers = group.groupMembersList.length;
    await group.save();
    
    res.json({ success: true, message: 'Joined group successfully!' });
  } catch (err) {
    console.error('Error joining group:', err);
    res.status(500).json({ success: false, message: 'Failed to join group' });
  }
});

// Group Messages
app.post('/api/groups/:groupId/messages', isAuthenticated, async (req, res) => {
  try {
    const { message: messageContent } = req.body;
    const group = await Message.findById(req.params.groupId);
    
    if (!group || !group.isGroup) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }
    
    // Check if user is member (convert to string for comparison)
    const userIdStr = req.user._id.toString();
    const isMember = group.groupMembersList && group.groupMembersList.some(memberId => memberId.toString() === userIdStr);
    
    if (!isMember) {
      return res.status(403).json({ success: false, message: 'Not a member of this group' });
    }
    
    const msg = new Message({
      user: req.user._id,
      content: messageContent,
      profession: req.user.profession,
      isGroupMessage: true,
      groupId: req.params.groupId,
      timestamp: new Date()
    });
    
    await msg.save();
    await msg.populate('user', 'name username');
    
    res.json({ success: true, message: 'Message sent!', data: msg });
  } catch (err) {
    console.error('Error sending group message:', err);
    res.status(500).json({ success: false, message: 'Failed to send message' });
  }
});

// Get Group Messages
app.get('/api/groups/:groupId/messages', isAuthenticated, async (req, res) => {
  try {
    const messages = await Message.find({ 
      groupId: req.params.groupId,
      isGroupMessage: true
    })
    .populate('user', 'name username')
    .sort({ timestamp: -1 })
    .limit(50);
    
    res.json({ success: true, messages: messages.reverse() || [] });
  } catch (err) {
    console.error('Error fetching group messages:', err);
    res.status(500).json({ success: false, message: 'Failed to load messages' });
  }
});

// Activity Feed API
app.get('/api/activity', isAuthenticated, async (req, res) => {
  try {
    const activity = await Message.find({ profession: req.user.profession })
      .populate('user', 'username')
      .sort({ timestamp: -1 })
      .limit(30);
    
    const activityFeed = activity.map(msg => ({
      _id: msg._id,
      user: msg.user,
      description: msg.isDiscussion ? 'started a discussion' : msg.isEvent ? 'created an event' : msg.isGroup ? 'created a group' : 'posted a message',
      type: msg.isDiscussion ? 'discussion' : msg.isEvent ? 'event' : msg.isGroup ? 'group' : 'message',
      timestamp: msg.timestamp
    }));
    
    res.json({ success: true, activity: activityFeed });
  } catch (err) {
    console.error('Error fetching activity:', err);
    res.status(500).json({ success: false, message: 'Failed to load activity' });
  }
});

// Top Members API
app.get('/api/top-members', isAuthenticated, async (req, res) => {
  try {
    const members = await User.find({ 
      profession: req.user.profession,
      isAdmin: false 
    })
    .sort({ points: -1 })
    .limit(12)
    .select('username profession points');
    
    const membersWithContributions = members.map(member => ({
      _id: member._id,
      username: member.username,
      profession: member.profession || 'Member',
      points: member.points || 0,
      contributions: Math.floor((member.points || 0) / 10)
    }));
    
    res.json({ success: true, members: membersWithContributions });
  } catch (err) {
    console.error('Error fetching members:', err);
    res.status(500).json({ success: false, message: 'Failed to load members' });
  }
});

// Update sendDailyPublicationEmails to handle multiple images and documents
async function sendDailyPublicationEmails() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const publications = await Publication.find({
      createdAt: { $gte: today }
    })
      .sort({ likeCount: -1, createdAt: -1 })
      .limit(2)
      .populate('postedBy', 'username')
      .lean();

    if (publications.length === 0) {
      console.log('No new publications today');
      return;
    }
    const users = await User.find({ isAdmin: false }).select('email username');
    const emailList = users.map(user => user.email);
    const publicationHtml = publications.map((pub, index) => {
      const imageTags = pub.images.map((img, j) => `<img src="cid:pub-${index}-img-${j}" alt="Publication Image ${j+1}" style="max-width: 300px;">`).join('');
      const docLinks = pub.documents.map((doc, j) => `<p><a href="https://bookhive-rsd.onrender.com/view-pub-doc/${pub._id}/${j}">View PDF: ${doc.filename}</a></p>`).join('');
      return `
        <div>
          <h3>Post by ${pub.postedBy.username}</h3>
          <p>${pub.content}</p>
          ${imageTags}
          ${docLinks}
          <p><a href="https://bookhive-rsd.onrender.com/publications">View Post</a></p>
        </div>
      `;
    }).join('<hr>');
    for (const email of emailList) {
      const attachments = [];
      publications.forEach((pub, index) => {
        pub.images.forEach((img, j) => {
          attachments.push({
            filename: img.filename,
            content: img.data,
            cid: `pub-${index}-img-${j}`,
            contentType: img.contentType
          });
        });
      });

      const publicationText = publicationHtml.replace(/<[^>]*>?/gm, '');

      const mailOptions = {
        from: `"BookHive Team" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Daily Publication Updates from BookHive',
        html: `
          <h2>Today's Top Publications on BookHive</h2>
          ${publicationHtml}
          <p>Visit <a href="https://bookhive-rsd.onrender.com/publications">Publications</a> to see more.</p>
          <p>Best regards,<br>BookHive Team</p>
        `,
        text: `Today's Top Publications on BookHive\n\n${publicationText}\n\nVisit Publications to see more: https://bookhive-rsd.onrender.com/publications\n\nBest regards,\nBookHive Team`,
        headers: {
            'X-Priority': '3',
            'X-MSMail-Priority': 'Normal',
            'Importance': 'Normal'
        },
        attachments
      };
      await transporter.sendMail(mailOptions);
      console.log(`Daily publication email sent to: ${email}`);
    }
    console.log('Daily publication emails sent successfully');
  } catch (err) {
    console.error('Error sending daily publication emails:', err);
  }
}
app.get('/create-app', isAuthenticated, (req, res) => {
  res.render('create-app', {
    user: req.user,
    currentPage: 'create-app'
  });
});
// Update the /api/applications/create post route to store icon as Buffer
app.post('/api/applications/create', isAuthenticated, ApplicationImageUpload.single('icon'), async (req, res) => {
  const { 'app-name': name, 'app-description': description, 'app-code': code } = req.body;
  try {
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Application name and code are required.' });
    }
    const scriptsDir = path.join(__dirname, 'user-applications', 'scripts');
    const metadataDir = path.join(__dirname, 'user-applications', 'metadata');
    await fs.mkdir(scriptsDir, { recursive: true });
    await fs.mkdir(metadataDir, { recursive: true });
    const appId = Date.now().toString();
    const scriptPath = path.join(scriptsDir, `user-app-${appId}.js`);
    const metadataPath = path.join(metadataDir, `user-app-${appId}.json`);
    await fs.writeFile(scriptPath, code);
    const application = new Application({
      name,
      description: description || '',
      creatorId: req.user._id,
      filePath: scriptPath,
      icon: req.file ? req.file.buffer : null,
      iconType: req.file ? req.file.mimetype : null
    });
    await application.save();
    await fs.writeFile(metadataPath, JSON.stringify({
      id: application._id.toString(),
      name,
      description: description || '',
      creatorId: req.user._id,
      iconPath: `/app-icon/${application._id}`
    }));
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving application:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to save application.' });
  }
});
app.get('/app-icon/:appId', isAuthenticated, async (req, res) => {
  try {
    const application = await Application.findById(req.params.appId);
    if (!application || !application.icon) {
      return res.sendFile(path.join(__dirname, 'public', 'images', 'default-app-icon.png'));
    }
    res.set({
      'Content-Type': application.iconType || 'image/png',
      'Content-Disposition': `inline; filename="app-icon-${application._id}.png"`
    });
    res.send(application.icon);
  } catch (err) {
    console.error('Error serving app icon:', err);
    res.status(500).send('Failed to load icon');
  }
});
// Route to serve user application scripts
app.get('/applications/:appId/script', isAuthenticated, async (req, res) => {
  try {
    const appId = req.params.appId;
    let appPath = path.join(__dirname, 'applications', `${appId}.js`);
    try {
      await fs.access(appPath);
      res.set('Content-Type', 'text/javascript');
      return res.sendFile(appPath);
    } catch {
      const userApp = await Application.findById(appId);
      if (!userApp) {
        return res.status(404).send('Application script not found');
      }
      res.set('Content-Type', 'text/javascript');
      res.sendFile(userApp.filePath);
    }
  } catch (err) {
    console.error('Error serving app script:', err);
    res.status(500).send('Failed to load application script');
  }
});
// Update rendering logic where iconPath is used (e.g., in /applications get route)
app.get('/applications', isAuthenticated, async (req, res) => {
  try {
    const user = req.user;
    if (user.isAdmin) {
      return res.redirect('/admin');
    }
    const userApps = await Application.find({}).select('name _id');
    const applications = [
      ...userApps.map(app => ({
        id: app._id.toString(),
        name: app.name,
        iconPath: `/app-icon/${app._id}` // Use the new route for icon
      }))
    ];
    res.render('application', {
      user,
      applications,
      appId: null,
      note: req.note ? req.note.content : '',
      currentPage: 'applications' // Add this line
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.render('error', {
      user,
      message: 'Failed to load applications.',
      note: req.note ? req.note.content : ''
    });
  }
});

// ============================================================
// SCHEMA-AWARE QUERY CLASSIFICATION & ANALYSIS
// ============================================================

// Schema field mapping for smart searching
const SCHEMA_MAPPING = {
  books: {
    collection: 'books',
    searchFields: ['title', 'author', 'description', 'tags'],
    filterFields: { visibility: 'public' },
    keywordFields: {
      'title': 'title',
      'author': 'author',
      'by': 'author',
      'writer': 'author',
      'creator': 'uploadedBy',
      'tags': 'tags',
      'tag': 'tags'
    }
  },
  users: {
    collection: 'users',
    searchFields: ['username', 'email', 'profession'],
    filterFields: { profession: 'BookHive' },
    keywordFields: {
      'user': 'username',
      'member': 'profession',
      'admin': 'isAdmin',
      'username': 'username'
    }
  },
  news: {
    collection: 'news',
    searchFields: ['title', 'content'],
    filterFields: {},
    keywordFields: {
      'news': 'title',
      'article': 'content',
      'update': 'content',
      'title': 'title'
    }
  },
  publications: {
    collection: 'publications',
    searchFields: ['content'],
    filterFields: {},
    keywordFields: {
      'post': 'content',
      'publication': 'content',
      'article': 'content'
    }
  },
  messages: {
    collection: 'messages',
    searchFields: ['content', 'category', 'tags', 'eventTitle', 'groupName'],
    filterFields: { profession: 'BookHive' },
    keywordFields: {
      'discussion': 'isDiscussion',
      'event': 'isEvent',
      'group': 'isGroup',
      'message': 'content',
      'category': 'category'
    }
  }
};

// Keyword analysis for better query classification
function analyzeQuery(query) {
  const lowerQuery = query.toLowerCase().trim();
  
  const analysis = {
    isAuthorQuery: /\b(who|author|writer|creator|poet|by|from)\b/i.test(lowerQuery),
    isBookQuery: /\b(book|title|novel|publication|write|reading|read)\b/i.test(lowerQuery),
    isTopicQuery: /\b(python|javascript|java|sql|mysql|database|web|cloud|data|machine|learning|ai|artificial|programming|code)\b/i.test(lowerQuery),
    isNewsQuery: /\b(news|update|latest|recent|current|new|today|yesterday|week)\b/i.test(lowerQuery),
    isEventQuery: /\b(event|conference|meeting|seminar|upcoming|scheduled|when)\b/i.test(lowerQuery),
    isDiscussionQuery: /\b(discussion|forum|topic|thread|comment|debate|talk)\b/i.test(lowerQuery),
    isGroupQuery: /\b(group|community|team|circle|club|organization)\b/i.test(lowerQuery),
    isUserQuery: /\b(user|member|people|person|admin|administrator|who)\b/i.test(lowerQuery),
    isPopularityQuery: /\b(popular|trending|most|favorite|liked|top|best|famous)\b/i.test(lowerQuery),
    isDateQuery: /\b(recent|latest|today|yesterday|week|month|year|new|old)\b/i.test(lowerQuery)
  };
  
  return analysis;
}

// Determine which collection(s) to search based on query analysis
function determineCollections(analysis) {
  const collections = [];
  
  if (analysis.isAuthorQuery && analysis.isBookQuery) collections.push('books');
  else if (analysis.isAuthorQuery) collections.push('users');
  
  if (analysis.isTopicQuery && !analysis.isEventQuery) collections.push('books');
  
  if (analysis.isNewsQuery) collections.push('news');
  
  if (analysis.isEventQuery) collections.push('messages'); // Messages with isEvent=true
  
  if (analysis.isDiscussionQuery) collections.push('messages'); // Messages with isDiscussion=true
  
  if (analysis.isGroupQuery) collections.push('messages'); // Messages with isGroup=true
  
  if (analysis.isUserQuery) collections.push('users');
  
  if (analysis.isPopularityQuery && (analysis.isBookQuery || analysis.isTopicQuery)) {
    collections.push('books');
  }
  
  // If no specific collection identified, search books (most common)
  if (collections.length === 0 && !analysis.isNewsQuery && !analysis.isEventQuery) {
    collections.push('books');
  }
  
  return [...new Set(collections)]; // Remove duplicates
}

// Helper function to classify query intent based on schema analysis
function classifyQueryV2(query) {
  const analysis = analyzeQuery(query);
  const collections = determineCollections(analysis);
  
  console.log('Query Analysis:', { query, analysis, collections });
  
  // Determine primary query type
  if (analysis.isAuthorQuery && analysis.isBookQuery) return 'author_books_query';
  if (analysis.isAuthorQuery && !analysis.isBookQuery) return 'authors_query';
  if (analysis.isEventQuery) return 'events_query';
  if (analysis.isDiscussionQuery) return 'discussions_query';
  if (analysis.isGroupQuery) return 'groups_query';
  if (analysis.isNewsQuery) return 'news_query';
  if (analysis.isUserQuery) return 'users_query';
  if (analysis.isPopularityQuery && collections.includes('books')) return 'popular_books_query';
  if (analysis.isTopicQuery || analysis.isBookQuery) return 'books_query';
  
  return 'general_conversation';
}

// Helper function to determine query intent and classify user question - ENHANCED
function classifyQuery(query) {
    const lowerQuery = query.toLowerCase().trim();
    
    // Check for author-related queries FIRST (more specific)
    if (lowerQuery.match(/^(who|list|show|tell|get|find).*(author|writer|creator|poet|novelist)/i) ||
        lowerQuery.match(/author|authors only/i)) {
        return 'authors_query';
    }
    
    // Check for news queries with higher priority
    if (lowerQuery.match(/news|update|latest|recent|current|what.*new|announcement/i)) {
        return 'news_query';
    }
    
    // Check for publication/post queries
    if (lowerQuery.match(/publication|post|article|blog|share|published/i)) {
        return 'publication_query';
    }
    
    // Check for specific AI use case queries
    if (lowerQuery.match(/gemini|claude|ai assistant|use case/i)) {
        return 'usecase_query';
    }
    
    // Check for document-related queries (like joins, SQL, technical topics)
    if (lowerQuery.match(/join|inner join|left join|right join|sql join|database join|query|sql|database|relation|table|schema|field|column|index/i)) {
        return 'books_query';
    }
    
    // Check for books-related queries (more specific patterns)
    if (lowerQuery.match(/^(what|show|list|find|get|tell|any).*(book|title|novel|document)/i) ||
        lowerQuery.match(/book.*available|available.*book|books?$/i) ||
        lowerQuery.match(/^books?\s/i) ||
        lowerQuery.match(/(python|javascript|java|sql|mysql|database|web|cloud|data|machine|learning|artificial|programming|code|development|framework|library)/i)) {
        return 'books_query';
    }
    
    // Default to general conversation
    return 'general_conversation';
}

// Helper function to extract keywords from query
function extractKeywords(query) {
    // Remove common words that don't add search value
    const stopWords = new Set(['the', 'and', 'or', 'is', 'are', 'am', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could',
        'about', 'what', 'any', 'some', 'provide', 'provide', 'details', 'information',
        'show', 'tell', 'get', 'find', 'list', 'available', 'you', 'me', 'my', 'your',
        'this', 'that', 'these', 'those', 'a', 'an', 'can', 'want', 'like', 'help']);
    
    const allKeywords = query.toLowerCase().match(/\b\w{3,}\b/g) || [];
    const keywords = allKeywords.filter(k => !stopWords.has(k));
    
    return [...new Set(keywords)]; // Remove duplicates
}

// COLLECTION-SPECIFIC SEARCH FUNCTIONS
// ============================================================

// Search users by name, username, or email
async function searchUsersByKeywords(keywords) {
  try {
    const searchRegex = new RegExp(keywords.join('|'), 'i');
    const users = await User.find({
      $or: [
        { username: searchRegex },
        { email: searchRegex },
        { profession: searchRegex }
      ]
    }).select('username email profession isAdmin').limit(20);
    
    return users;
  } catch (err) {
    console.error('Error searching users:', err);
    return [];
  }
}

// Search news by title or content
async function searchNewsByKeywords(keywords) {
  try {
    const searchRegex = new RegExp(keywords.join('|'), 'i');
    const news = await News.find({
      $or: [
        { title: searchRegex },
        { content: searchRegex }
      ]
    }).sort({ createdAt: -1 }).limit(20);
    
    return news;
  } catch (err) {
    console.error('Error searching news:', err);
    return [];
  }
}

// Search messages with event details
async function searchEventsByKeywords(keywords) {
  try {
    const searchRegex = new RegExp(keywords.join('|'), 'i');
    const events = await Message.find({
      isEvent: true,
      $or: [
        { eventTitle: searchRegex },
        { eventType: searchRegex },
        { content: searchRegex }
      ]
    }).sort({ eventStart: -1 }).limit(20);
    
    return events;
  } catch (err) {
    console.error('Error searching events:', err);
    return [];
  }
}

// Search discussions by category or content
async function searchDiscussionsByKeywords(keywords) {
  try {
    const searchRegex = new RegExp(keywords.join('|'), 'i');
    const discussions = await Message.find({
      isDiscussion: true,
      $or: [
        { category: searchRegex },
        { tags: searchRegex },
        { content: searchRegex }
      ]
    }).sort({ createdAt: -1 }).limit(20);
    
    return discussions;
  } catch (err) {
    console.error('Error searching discussions:', err);
    return [];
  }
}

// Search groups by name or description
async function searchGroupsByKeywords(keywords) {
  try {
    const searchRegex = new RegExp(keywords.join('|'), 'i');
    const groups = await Message.find({
      isGroup: true,
      $or: [
        { groupName: searchRegex },
        { content: searchRegex }
      ]
    }).sort({ createdAt: -1 }).limit(20);
    
    return groups;
  } catch (err) {
    console.error('Error searching groups:', err);
    return [];
  }
}

// Search publications by content
async function searchPublicationsByKeywords(keywords) {
  try {
    const searchRegex = new RegExp(keywords.join('|'), 'i');
    const publications = await Publication.find({
      content: searchRegex
    }).sort({ createdAt: -1 }).limit(20);
    
    return publications;
  } catch (err) {
    console.error('Error searching publications:', err);
    return [];
  }
}

// Helper function to search books by keywords with fallback to all books
async function searchBooksByKeywords(keywords, queryText, getAllIfEmpty = false) {
    try {
        console.log('Searching with keywords:', keywords);
        
        let books = [];
        
        // If keywords provided, search by metadata
        if (keywords.length > 0) {
            const searchRegex = new RegExp(keywords.join('|'), 'i');
            
            // Search in title, author, tags, description AND filter by public visibility
            books = await Book.find({
                visibility: 'public',
                $or: [
                    { title: searchRegex },
                    { author: searchRegex },
                    { tags: searchRegex },
                    { description: searchRegex }
                ]
            })
            .select('title author description tags uploadDate fileSize visibility')
            .sort({ uploadDate: -1 })
            .limit(15);
            
            console.log('Books found with keyword filters:', books.length);
        }
        
        // If no books found, try getting all public books (Level 2 fallback)
        if (books.length === 0) {
            console.log('No keyword matches found, fetching all public books...');
            books = await Book.find({ visibility: 'public' })
                .select('title author description tags uploadDate fileSize visibility')
                .sort({ uploadDate: -1 })
                .limit(15);
            
            console.log('All public books found:', books.length);
        }
        
        return books;
    } catch (error) {
        console.error('Search books error:', error);
        return [];
    }
}

// Helper function to search book content by PDF text - ENHANCED FOR DOCUMENT TOPICS
async function searchBookContentByKeywords(keywords) {
    try {
        console.log('Searching PDF content with keywords:', keywords);
        
        if (keywords.length === 0) return [];
        
        const books = await Book.find({ visibility: 'public' })
            .select('title author description tags fileData uploadDate')
            .limit(30);
        
        const matchedBooks = [];
        const keywordLower = keywords.map(k => k.toLowerCase());
        
        for (const book of books) {
            try {
                if (book.fileData) {
                    const pdfData = await pdfParse(book.fileData);
                    const textContent = pdfData.text.toLowerCase();
                    
                    // Check if keywords match in PDF content with occurrence count
                    const keywordMatches = [];
                    keywordLower.forEach(keyword => {
                        if (textContent.includes(keyword)) {
                            const regex = new RegExp(keyword, 'gi');
                            const matches = textContent.match(regex);
                            keywordMatches.push({
                                keyword,
                                count: matches ? matches.length : 0,
                                found: true
                            });
                        }
                    });
                    
                    if (keywordMatches.some(m => m.found)) {
                        matchedBooks.push({
                            title: book.title,
                            author: book.author,
                            description: book.description,
                            tags: book.tags,
                            uploadDate: book.uploadDate,
                            matchedInContent: true,
                            keywordMatches: keywordMatches.filter(m => m.found)
                        });
                    }
                }
            } catch (pdfError) {
                console.error(`Error parsing PDF for ${book.title}:`, pdfError.message);
            }
        }
        
        console.log('PDF search matched books:', matchedBooks.length);
        return matchedBooks;
    } catch (error) {
        console.error('Search book content error:', error);
        return [];
    }
}

// Helper function to get all authors
async function getAllAuthors() {
    try {
        const authors = await Book.aggregate([
            { $match: { visibility: 'public' } },
            {
                $group: {
                    _id: '$author',
                    bookCount: { $sum: 1 },
                    books: { $push: '$title' }
                }
            },
            { $sort: { bookCount: -1 } },
            { $limit: 20 }
        ]);
        return authors;
    } catch (error) {
        console.error('Get authors error:', error);
        return [];
    }
}

// Helper function to get all public books
async function getAllPublicBooks() {
    try {
        const books = await Book.find({ visibility: 'public' })
            .select('title author description tags uploadDate fileSize')
            .sort({ uploadDate: -1 })
            .limit(20);
        return books;
    } catch (error) {
        console.error('Get all books error:', error);
        return [];
    }
}

// Helper function to format books response
function formatBooksResponse(books, isSearchResult = false) {
    if (!books || books.length === 0) {
        let message = isSearchResult 
            ? 'No books found matching your search. Try asking for all available books or a specific topic.'
            : 'No public books are currently available in the system.';
        return message;
    }
    
    let response = '**📚 Books Available in BookHive:**\n\n';
    books.forEach((book, index) => {
        response += `${index + 1}. **${book.title}** by *${book.author}*\n`;
        if (book.description) {
            response += `   📄 ${book.description.substring(0, 80)}...\n`;
        }
        if (book.tags && book.tags.length > 0) {
            response += `   🏷️ Tags: ${book.tags.slice(0, 3).join(', ')}\n`;
        }
        response += '\n';
    });
    
    response += '\n**💡 Would you like to know more?**\n';
    response += '- Ask for **specific topics** (e.g., "books on AI")\n';
    response += '- Ask for **authors** available in BookHive\n';
    response += '- Ask to **see more books**';
    
    return response;
}

// Helper function to format authors response
function formatAuthorsResponse(authors) {
    if (!authors || authors.length === 0) {
        return 'No authors available in the system yet. Be the first to upload a book!';
    }
    
    let response = '**✍️ Current Authors Available in BookHive:**\n\n';
    authors.forEach((author, index) => {
        const authorName = author._id || 'Unknown';
        response += `${index + 1}. **${authorName}** - ${author.bookCount} book(s)\n`;
        if (author.books && author.books.length > 0) {
            response += `   📚 ${author.books.slice(0, 2).join(', ')}\n`;
        }
    });
    
    response += '\n**Want to explore more?** Ask me about specific books or topics!';
    return response;
}

app.post('/api/chatbot', isAuthenticated, async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ success: false, message: 'Query is required.' });

        const queryType = classifyQuery(query);
        const keywords = extractKeywords(query);
        
        console.log('=== CHATBOT DEBUG ===');
        console.log('User Query:', query);
        console.log('Query Type:', queryType);
        console.log('Keywords:', keywords);

        // --- MULTI-COLLECTION SCHEMA-AWARE SEARCH ---
        
        // --- Step 1: Handle Books Query ---
        if (queryType === 'books_query') {
            console.log('Processing BOOKS_QUERY...');
            
            let books = await searchBooksByKeywords(keywords, query, false);
            console.log('Books found with keyword search:', books.length);
            
            // LEVEL 2: If no metadata matches but we have keywords, search PDF content
            if (books.length === 0 && keywords.length > 0) {
                console.log('No metadata matches, searching PDF content for specific topics...');
                books = await searchBookContentByKeywords(keywords);
                console.log('Books found with PDF content search:', books.length);
                
                if (books.length > 0) {
                    let response = '**📚 Books with "' + keywords.join(', ') + '" in Content:**\n\n';
                    books.forEach((book, index) => {
                        response += `${index + 1}. **${book.title}** by *${book.author}*\n`;
                        if (book.description) {
                            response += `   📄 ${book.description.substring(0, 80)}...\n`;
                        }
                        if (book.keywordMatches && book.keywordMatches.length > 0) {
                            response += `   ✓ Topics found: ${book.keywordMatches.map(m => m.keyword).join(', ')}\n`;
                        }
                        response += '\n';
                    });
                    response += '\n**💡 Found in document content!** These books contain your search terms.';
                    return res.json({ success: true, response });
                }
            }
            
            // LEVEL 3: If still no results, get all public books
            if (books.length === 0) {
                console.log('No matches found, fetching all public books as fallback...');
                books = await getAllPublicBooks();
                console.log('All public books found:', books.length);
            }
            
            const response = formatBooksResponse(books, keywords.length > 0);
            return res.json({ success: true, response });
        }

        // --- Step 2: Handle Authors Query ---
        if (queryType === 'authors_query') {
            console.log('Processing AUTHORS_QUERY...');
            const authors = await getAllAuthors();
            console.log('Authors found:', authors.length);
            const response = formatAuthorsResponse(authors);
            return res.json({ success: true, response });
        }

        // --- Step 3: Handle Users/Members Query ---
        if (queryType.includes('user') || query.toLowerCase().match(/\b(member|people|person|admin|user)\b/i)) {
            console.log('Processing USERS_QUERY...');
            const users = await searchUsersByKeywords(keywords);
            console.log('Users found:', users.length);
            
            if (users.length > 0) {
                let response = '**👥 Members in BookHive:**\n\n';
                users.forEach((user, index) => {
                    response += `${index + 1}. **${user.username}**\n`;
                    if (user.email) response += `   📧 ${user.email}\n`;
                    if (user.profession) response += `   💼 ${user.profession}\n`;
                    if (user.isAdmin) response += `   ⭐ Administrator\n`;
                    response += '\n';
                });
                return res.json({ success: true, response });
            }
        }

        // --- Step 4: Handle Events Query ---
        if (queryType.includes('event') || query.toLowerCase().match(/\b(event|conference|meeting|seminar|upcoming|scheduled)\b/i)) {
            console.log('Processing EVENTS_QUERY...');
            const events = await searchEventsByKeywords(keywords);
            console.log('Events found:', events.length);
            
            if (events.length > 0) {
                let response = '**📅 Upcoming Events:**\n\n';
                events.forEach((event, index) => {
                    response += `${index + 1}. **${event.eventTitle || 'Untitled'}**\n`;
                    if (event.eventType) response += `   🎯 Type: ${event.eventType}\n`;
                    if (event.eventStart) response += `   ⏰ Start: ${new Date(event.eventStart).toLocaleString()}\n`;
                    response += '\n';
                });
                return res.json({ success: true, response });
            }
        }

        // --- Step 5: Handle Discussions Query ---
        if (queryType.includes('discussion') || query.toLowerCase().match(/\b(discussion|forum|topic|thread|debate)\b/i)) {
            console.log('Processing DISCUSSIONS_QUERY...');
            const discussions = await searchDiscussionsByKeywords(keywords);
            console.log('Discussions found:', discussions.length);
            
            if (discussions.length > 0) {
                let response = '**💬 Popular Discussions:**\n\n';
                discussions.forEach((disc, index) => {
                    response += `${index + 1}. **${disc.category || 'General Discussion'}**\n`;
                    if (disc.tags && disc.tags.length > 0) response += `   🏷️ ${disc.tags.join(', ')}\n`;
                    response += `   💭 ${disc.content.substring(0, 60)}...\n\n`;
                });
                return res.json({ success: true, response });
            }
        }

        // --- Step 6: Handle Groups Query ---
        if (queryType.includes('group') || query.toLowerCase().match(/\b(group|community|team|circle|organization)\b/i)) {
            console.log('Processing GROUPS_QUERY...');
            const groups = await searchGroupsByKeywords(keywords);
            console.log('Groups found:', groups.length);
            
            if (groups.length > 0) {
                let response = '**🤝 Active Groups:**\n\n';
                groups.forEach((group, index) => {
                    response += `${index + 1}. **${group.groupName || 'Unnamed Group'}**\n`;
                    response += `   📝 ${group.content.substring(0, 60)}...\n\n`;
                });
                response += '\n**📢 Was this helpful?** Tell us if these results were what you needed!';
                return res.json({ success: true, response });
            }
        }

        // --- Step 6.5: Handle Publications Query ---
        if (queryType.includes('publication') || query.toLowerCase().match(/\b(post|publication|article|blog|share)\b/i)) {
            console.log('Processing PUBLICATIONS_QUERY...');
            const publications = await searchPublicationsByKeywords(keywords);
            console.log('Publications found:', publications.length);
            
            if (publications.length > 0) {
                let response = '**📑 Recent Publications:**\n\n';
                publications.forEach((pub, index) => {
                    response += `${index + 1}. **Publication**\n`;
                    response += `   📝 ${pub.content.substring(0, 80)}...\n`;
                    response += `   👍 ${pub.likeCount || 0} likes\n\n`;
                });
                response += '\n**📢 Was this helpful?** Tell us what you think!';
                return res.json({ success: true, response });
            }
        }

        // --- Step 7: Handle AI Use Case Queries ---
        if (queryType === 'usecase_query') {
            console.log('Processing USECASE_QUERY...');
            
            const isGeminiQuery = query.toLowerCase().includes('gemini');
            const isClaudeQuery = query.toLowerCase().includes('claude');
            
            let searchTerm = isGeminiQuery ? 'gemini' : (isClaudeQuery ? 'claude' : '');
            console.log('AI Search Term:', searchTerm);
            
            if (searchTerm) {
                let books = await searchBooksByKeywords([searchTerm], query, false);
                console.log('Books found with AI keyword search:', books.length);
                
                if (books.length > 0) {
                    const response = formatBooksResponse(books, true);
                    return res.json({ success: true, response });
                } else {
                    console.log('No AI-specific matches, searching PDF content...');
                    books = await searchBookContentByKeywords([searchTerm]);
                    console.log('Books found with AI PDF search:', books.length);
                    
                    if (books.length > 0) {
                        const response = formatBooksResponse(books, true);
                        return res.json({ success: true, response });
                    } else {
                        console.log('No AI-specific books found, showing alternatives...');
                        const allBooks = await getAllPublicBooks();
                        
                        let response = `**📖 No books specifically about "${searchTerm}" use cases found.**\n\n`;
                        response += `But here are **other books available** that might interest you:\n\n`;
                        
                        if (allBooks.length > 0) {
                            allBooks.slice(0, 5).forEach((book, index) => {
                                response += `${index + 1}. **${book.title}** by *${book.author}*\n`;
                            });
                            response += `\n**💡 Suggestions:**\n- Ask for **all available books**\n- Ask about **authors** in BookHive\n- Try searching with **different keywords**`;
                        } else {
                            response += 'No books are currently available in the system.';
                        }
                        
                        return res.json({ success: true, response });
                    }
                }
            }
        }

        // --- Step 8: Handle News Query - NOW SEARCHES WITH KEYWORDS ---
        if (queryType === 'news_query') {
            console.log('Processing NEWS_QUERY...');
            try {
                let news = [];
                
                // If keywords provided, search news
                if (keywords.length > 0) {
                    console.log('Searching news with keywords:', keywords);
                    news = await searchNewsByKeywords(keywords);
                    console.log('News found with keyword search:', news.length);
                }
                
                // If no keyword matches, get latest news
                if (news.length === 0) {
                    console.log('No keyword matches, fetching latest news...');
                    news = await News.find()
                        .select('title content createdAt')
                        .sort({ createdAt: -1 })
                        .limit(5);
                    console.log('Latest news found:', news.length);
                }
                
                if (news.length === 0) {
                    return res.json({ success: true, response: '📰 No news available at this time.' });
                }
                
                let response = '**📰 Latest News' + (keywords.length > 0 ? ' about ' + keywords.join(', ') : '') + ':**\n\n';
                news.forEach((item, index) => {
                    response += `${index + 1}. **${item.title}**\n`;
                    response += `   ${item.content.substring(0, 100)}...\n\n`;
                });
                
                response += '\n**💡 Want to explore more?** Ask about books, authors, events, or discussions!';
                response += '\n**📢 Was this helpful?** Let us know your feedback!';
                return res.json({ success: true, response });
            } catch (error) {
                console.error('News query error:', error);
                return res.json({ success: true, response: 'Unable to fetch news at this moment.' });
            }
        }

        // --- Step 9: Handle General Conversation ---
        console.log('Processing GENERAL_CONVERSATION...');
        const generalResponses = [
            "👋 **Hello! I'm the BookHive AI Assistant.**\n\nI can help you with:\n- 📚 **What books are available?** - I'll show you our book collection\n- ✍️ **Who are the authors?** - I'll list all authors in BookHive\n- 📰 **Recent news** - I'll share the latest updates\n- 👥 **Members & Users** - Find community members\n- 📅 **Events** - Upcoming events and conferences\n- 💬 **Discussions** - Active forum discussions\n\n**What would you like to know?**",
            
            "👋 **Hi there! Welcome to BookHive.**\n\nYou can ask me about:\n- 📚 Available books in our collection\n- ✍️ Authors and their work\n- 📰 Latest news and updates\n- 👥 Community members\n- 📅 Upcoming events\n- 💬 Discussions & forums\n\n**How can I assist you today?**",
            
            "👋 **I'm here to help!**\n\nYou can ask me:\n- 📚 What books do you have?\n- ✍️ Who are the current authors?\n- 📰 What's new in BookHive?\n- 👥 Members available?\n- 📅 Any upcoming events?\n- 💬 Active discussions?\n\n**What interests you?**"
        ];
        
        const randomResponse = generalResponses[Math.floor(Math.random() * generalResponses.length)];
        return res.json({ success: true, response: randomResponse });

    } catch (err) {
        console.error('=== CHATBOT ERROR ===', err);
        res.status(500).json({ success: false, message: 'An error occurred while processing your request. Please try again later.' });
    }
});

// ============================================================
// CHATBOT FEEDBACK API - User Training System
// ============================================================
app.post('/api/chatbot/feedback', isAuthenticated, async (req, res) => {
    try {
        const { userQuery, botResponse, feedback, correction, correctBookIds } = req.body;
        
        if (!userQuery || !botResponse || !feedback) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        // Validate feedback type
        const validFeedback = ['helpful', 'incorrect', 'irrelevant', 'unclear'];
        if (!validFeedback.includes(feedback)) {
            return res.status(400).json({ success: false, message: 'Invalid feedback type' });
        }
        
        // Save feedback for training
        const feedbackRecord = new ChatbotFeedback({
            userId: req.user._id,
            userQuery,
            botResponse,
            userFeedback: feedback,
            userCorrection: correction || null,
            correctBookIds: correctBookIds || []
        });
        
        await feedbackRecord.save();
        
        console.log(`Chatbot Feedback Saved: ${feedback} from ${req.user.username}`);
        console.log(`Query: "${userQuery}"`);
        if (correction) console.log(`Correction: "${correction}"`);
        
        // Get pattern analysis for learning
        const recentFeedback = await ChatbotFeedback.find()
            .sort({ createdAt: -1 })
            .limit(100);
        
        // Calculate accuracy
        const helpfulCount = recentFeedback.filter(f => f.userFeedback === 'helpful').length;
        const incorrectCount = recentFeedback.filter(f => f.userFeedback === 'incorrect').length;
        const accuracy = (helpfulCount / recentFeedback.length * 100).toFixed(2);
        
        res.json({ 
            success: true, 
            message: 'Thank you for your feedback! It helps us improve.',
            stats: {
                accuracy: `${accuracy}%`,
                totalFeedback: recentFeedback.length,
                helpful: helpfulCount,
                incorrect: incorrectCount
            }
        });
        
    } catch (err) {
        console.error('Chatbot feedback error:', err);
        res.status(500).json({ success: false, message: 'Error saving feedback' });
    }
});

// ============================================================
// ADMIN API - View Chatbot Feedback for Training
// ============================================================
app.get('/api/chatbot/feedback/stats', isAuthenticated, async (req, res) => {
    try {
        // Only admins can view stats
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        const allFeedback = await ChatbotFeedback.find()
            .populate('userId', 'username')
            .populate('correctBookIds', 'title author')
            .sort({ createdAt: -1 })
            .limit(100);
        
        // Calculate statistics
        const stats = {
            totalFeedback: allFeedback.length,
            helpful: allFeedback.filter(f => f.userFeedback === 'helpful').length,
            incorrect: allFeedback.filter(f => f.userFeedback === 'incorrect').length,
            irrelevant: allFeedback.filter(f => f.userFeedback === 'irrelevant').length,
            unclear: allFeedback.filter(f => f.userFeedback === 'unclear').length,
            accuracy: ((allFeedback.filter(f => f.userFeedback === 'helpful').length / allFeedback.length) * 100).toFixed(2)
        };
        
        // Common incorrect patterns
        const incorrectPatterns = allFeedback
            .filter(f => f.userFeedback === 'incorrect')
            .map(f => ({ query: f.userQuery, correction: f.userCorrection }));
        
        res.json({
            success: true,
            stats,
            recentFeedback: allFeedback.slice(0, 20),
            incorrectPatterns: incorrectPatterns.slice(0, 10)
        });
        
    } catch (err) {
        console.error('Feedback stats error:', err);
        res.status(500).json({ success: false, message: 'Error fetching feedback stats' });
    }
});

// ============================================================
// IMPROVE SEARCH - Based on User Feedback
// ============================================================
app.post('/api/chatbot/learn', isAuthenticated, async (req, res) => {
    try {
        // Only admins can trigger learning
        if (!req.user.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin access required' });
        }
        
        // Get all incorrect feedback
        const incorrectFeedback = await ChatbotFeedback.find({ userFeedback: 'incorrect' });
        
        // Analyze patterns
        const queryPatterns = {};
        incorrectFeedback.forEach(feedback => {
            const keywords = feedback.userQuery.toLowerCase().split(/\s+/);
            keywords.forEach(kw => {
                if (kw.length > 3) {
                    queryPatterns[kw] = (queryPatterns[kw] || 0) + 1;
                }
            });
        });
        
        // Get most problematic queries
        const sortedPatterns = Object.entries(queryPatterns)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
        
        res.json({
            success: true,
            message: 'Learning analysis complete',
            analysis: {
                totalIncorrectResponses: incorrectFeedback.length,
                problemKeywords: sortedPatterns,
                recommendations: [
                    'Review keywords causing incorrect results',
                    'Consider adding more descriptive book tags',
                    'Update query classification patterns',
                    'Check book visibility settings (should be "public")'
                ]
            }
        });
        
    } catch (err) {
        console.error('Learning error:', err);
        res.status(500).json({ success: false, message: 'Error during learning' });
    }
});



server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
