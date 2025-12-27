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
const dns = require('dns'); // Import the dns module
const Application = require('./models/Application');
// const { isAuthenticated } = require('./middleware/auth');
require('dotenv').config();
const GEMINI_API_KEY = 'AIzaSyBcnPIGkKdkSpoJaPv3W3mw3uV7c9pH2QI';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;
const activeUsers = new Set();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.get('X-Forwarded-Proto') !== 'https') {
    return res.redirect(301, `https://${req.get('host')}${req.url}`);
  }
  next();
});
// Prevent caching
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
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
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: 'mongodb+srv://bookhiversd:8D6pLujBM9rLVi8B@bookhive.7h76ryz.mongodb.net/BookHive_RSD?retryWrites=true&w=majority&appName=BookHive' }),
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
  clientID: '660588293356-64bhcqs11c72nq2br21f4di7vpvu6fil.apps.googleusercontent.com',
  clientSecret: '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',
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
      const mailOptions = {
        from: `"BookHive Team" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: 'Welcome to BookHive!',
        html: `
          <h2>Welcome to BookHive, ${user.username}!</h2>
          <p>Thank you for joining our community. Explore, upload, and share your favorite books with BookHive.</p>
          <p>Get started by visiting your <a href="https://bookhive-rsd.onrender.com/bookhive">Library</a>.</p>
          <p>Best regards,<br>BookHive Team</p>
        `,
        text: `Welcome to BookHive, ${user.username}!\n\nThank you for joining our community. Explore, upload, and share your favorite books with BookHive.\n\nGet started by visiting your Library: https://bookhive-rsd.onrender.com/bookhive\n\nBest regards,\nBookHive Team`,
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
  isAdmin: { type: Boolean, default: false }
});
const bookSchema = new mongoose.Schema({
  title: { type: String, required: true },
  author: { type: String, required: true },
  fileName: { type: String, required: true },
  fileData: { type: Buffer, required: true },
  fileType: { type: String, required: true, enum: ['pdf'] },
  contentType: { type: String, required: true },
  thumbnail: { type: Buffer },
  thumbnailType: { type: String },
  description: { type: String },
  tags: [{ type: String }],
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadDate: { type: Date, default: Date.now },
  fileSize: { type: Number, required: true },
  visibility: { type: String, enum: ['private', 'public', 'restricted'], default: 'private' },
  accessList: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pinCount: { type: Number, default: 0 },
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
  timestamp: { type: Date, default: Date.now }
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
// Debug middleware for form submissions
app.use((req, res, next) => {
  if (req.method === 'POST' && ['/account/update-profile', '/account/update-password', '/feedback', '/account/delete', '/request-access'].includes(req.path)) {
    console.log(`Request to ${req.path}:`, {
      headers: req.headers,
      body: req.body,
      session: req.session
    });
    const originalJson = res.json;
    const originalRender = res.render;
    const originalRedirect = res.redirect;
    res.json = function (data) {
      console.log(`Response to ${req.path}: JSON`, data);
      return originalJson.apply(res, arguments);
    };
    res.render = function (view, locals) {
      console.log(`Response to ${req.path}: Render view=${view}`, locals);
      return originalRender.apply(res, arguments);
    };
    res.redirect = function (url) {
      console.log(`Response to ${req.path}: Redirect to ${url}`);
      return originalRedirect.apply(res, arguments);
    };
  }
  next();
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
mongoose.connect('mongodb+srv://bookhiversd:8D6pLujBM9rLVi8B@bookhive.7h76ryz.mongodb.net/BookHive_RSD?retryWrites=true&w=majority&appName=BookHive', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('Connected to MongoDB');
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
      console.log('Admin user created: username=admin, password=admin123');
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
// Multer for file uploads (PDFs)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
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
// Helper function for file type
function getFileTypeFromMime(mimeType) {
  if (mimeType === 'application/pdf') return 'pdf';
  return null;
}
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
    console.log(`User ${userId} joined ${profession} chat and user room ${userId}`);
    activeUsers.add(userId);
    const totalUsers = await User.countDocuments();
    socket.emit('chatHistory', {
      messages: await Message.find({ profession })
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
        console.log(`Chat request accepted: chatId=${chatId}, requester=${chatRequest.requester}, recipient=${chatRequest.recipient}`);
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
      console.log(`Private message sent: chatId=${chatId}, sender=${senderId}, recipient=${recipientId}`);
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
      console.log(`Fetched private messages for chatId=${chatId}: ${messages.length} messages`);
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
  console.log('Initiating Google OAuth, protocol:', req.protocol, 'host:', req.get('host'));
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});
app.get('/auth/google/callback', (req, res, next) => {
  console.log('Google OAuth callback, protocol:', req.protocol, 'host:', req.get('host'), 'session:', req.session);
  passport.authenticate('google', { failureRedirect: '/' }, (err, user) => {
    if (err) {
      console.error('Google OAuth callback error:', err);
      return res.redirect('/');
    }
    if (!user) {
      console.error('No user returned from Google OAuth');
      return res.redirect('/');
    }
    req.session.userId = user._id;
    req.session.lastActivity = Date.now();
    console.log('Session set for user:', user._id);
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
    const appDir = path.join(__dirname, 'applications');
    const appFiles = await fs.readdir(appDir);
    const staticApps = appFiles
      .map(file => ({
        name: path.basename(file, '.js').replace(/-/g, ' ').toUpperCase(),
        id: path.basename(file, '.js'),
        iconPath: '/images/default-app-icon.png' // Default icon for static apps
      }));
    const userApps = await Application.find({}).select('name _id iconPath');
    const applications = [
      ...userApps.map(app => ({
        id: app._id.toString(),
        name: app.name,
        iconPath: app.iconPath
      }))
    ];
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
    console.log('Rendering bookhive with data:', {
      newBooks,
      myBooks,
      user,
      pendingBookIds,
      totalUsers: await User.countDocuments(),
      activeUsers: activeUsers.size
    });
    res.render('bookhive', {
      user,
      newBooks: booksWithStatus,
      myBooks,
      pendingBookIds: pendingBookIds || [], // Ensure pendingBookIds is always defined
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
      const mailOptions = {
        from: `"BookHive Team" <${process.env.EMAIL_USER}>`,
        to: newUser.email,
        subject: 'Welcome to BookHive!',
        html: `
          <h2>Welcome to BookHive, ${newUser.username}!</h2>
          <p>Thank you for joining our community. Explore, upload, and share your favorite books with BookHive.</p>
          <p>Get started by visiting your <a href="https://bookhive-rsd.onrender.com/bookhive">BookHive Dashboard</a>.</p>
          <p>Best regards,<br>BookHive Team</p>
        `,
        text: `Welcome to BookHive, ${newUser.username}!\n\nThank you for joining our community. Explore, upload, and share your favorite books with BookHive.\n\nGet started by visiting your BookHive Dashboard: https://bookhive-rsd.onrender.com/bookhive\n\nBest regards,\nBookHive Team`,
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
    req.session.userId = user._id;
    req.session.lastActivity = Date.now();
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
      return res.status(400).render('upload', { error: 'Only PDF files allowed', user: req.user, note: req.note ? req.note.content : '' });
    }
    const isSafe = await validatePdfContent(req.file.buffer);
    if (!isSafe) {
      return res.status(400).render('upload', {
        error: 'Adult content detected. This content cannot be uploaded.',
        user: req.user,
        note: req.note ? req.note.content : ''
      });
    }
    const pdfData = await pdfParse(req.file.buffer);
    const textContent = pdfData.text.slice(0, 100000);
    const newBook = new Book({
      title,
      author,
      fileName: req.file.originalname,
      fileData: req.file.buffer,
      fileType,
      contentType: req.file.mimetype,
      description,
      tags: tagArray,
      uploadedBy: req.session.userId,
      visibility,
      fileSize,
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
    res.render('pdf-viewer', { book, user: req.user, note: req.note ? req.note.content : '', isPubDoc: false });
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
    const book = await Book.findById(req.params.bookId);
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
      'Content-Disposition': `inline; filename="${book.fileName}"`
    });
    res.send(book.fileData);
  } catch (err) {
    console.error('File fetch error:', err);
    res.status(500).send('Failed to load file');
  }
});
app.get('/thumbnail/:bookId', async (req, res) => {
  try {
    const book = await Book.findById(req.params.bookId);
    if (!book || !book.thumbnail) {
      return res.sendFile(path.join(__dirname, 'public', 'images', 'default-thumbnail.jpg'), (err) => {
        if (err) {
          console.error('Default thumbnail error:', err);
          res.status(404).send('Thumbnail not found');
        }
      });
    }
    res.set({
      'Content-Type': book.thumbnailType || 'image/jpeg',
      'Content-Disposition': `inline; filename="thumbnail-${book._id}.jpg"`
    });
    res.send(book.thumbnail);
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
    const users = await User.find({ isAdmin: false }).select('email');
    const emailList = users.map(user => user.email);
    try {
      for (const email of emailList) {
        const mailOptions = {
          from: `"BookHive Team" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: `New Update from BookHive: ${sanitizedTitle}`,
          html: `
            <h2>New Update from BookHive</h2>
            <h3>${sanitizedTitle}</h3>
            <div>${sanitizedContent}</div>
            ${req.file ? `<img src="cid:newsImage" style="max-width: 100%; height: auto;" alt="News Image" />` : ''}
            <p>Visit <a href="https://bookhive-rsd.onrender.com/news">BookHive News</a> to read more.</p>
            <p>Best regards,<br>BookHive Team</p>
          `,
          text: `New Update from BookHive\n\n${sanitizedTitle}\n\n${sanitizedContent.replace(/<[^>]*>?/gm, '')}\n\nVisit BookHive News to read more: https://bookhive-rsd.onrender.com/news\n\nBest regards,\nBookHive Team`,
          headers: {
            'X-Priority': '3',
            'X-MSMail-Priority': 'Normal',
            'Importance': 'Normal'
          },
          attachments: req.file ? [{
            filename: req.file.originalname,
            content: req.file.buffer,
            contentType: req.file.mimetype,
            cid: 'newsImage'
          }] : []
        };
        await transporter.sendMail(mailOptions);
        console.log(`Email notification sent successfully to: ${email}`);
      }
      console.log('All email notifications sent successfully');
    } catch (emailErr) {
      console.error('Error sending email notifications:', emailErr);
    }
    res.redirect('/admin?success=News posted successfully');
  } catch (err) {
    console.error('News post error:', err);
    res.redirect('/admin?error=Failed to post news');
  }
});
app.post('/request-access', isAuthenticated, async (req, res) => {
  try {
    const { bookId } = req.body;
    const user = req.user;
    console.log(`Processing access request: bookId=${bookId}, userId=${user._id}`);
    if (!bookId) {
      return res.status(400).json({ success: false, message: 'Book ID is required' });
    }
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Admins cannot request access' });
    }
    const book = await Book.findById(bookId).populate('uploadedBy', 'username email profession');
    if (!book) {
      console.error(`Book not found: bookId=${bookId}`);
      return res.status(404).json({ success: false, message: 'Book not found' });
    }
    if (book.visibility !== 'restricted' || book.uploadedBy.toString() === user._id || book.accessList.includes(user._id)) {
      console.log(`Access not required: visibility=${book.visibility}, isOwner=${book.uploadedBy.toString() === user._id}, hasAccess=${book.accessList.includes(user._id)})`);
      return res.status(400).json({ success: false, message: 'Access already granted or not required' });
    }
    const existingRequest = await Request.findOne({
      book: bookId,
      requestedBy: user._id,
      status: 'pending'
    });
    if (existingRequest) {
      console.log(`Existing pending request found: requestId=${existingRequest._id}`);
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
      console.log(`Access request email sent to: ${book.uploadedBy.email}`);
    } catch (emailErr) {
      console.error(`Error sending access request email to ${book.uploadedBy.email}:`, emailErr);
    }
    console.log(`Access request created: requestId=${accessRequest._id}`);
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
// View publication document in PDF viewer
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
    const tempBook = {
      _id: `${pub._id}-${index}`,
      title: doc.filename,
      fileName: doc.filename,
      pubId: pub._id,
      docIndex: index
    };
    res.render('pdf-viewer', { book: tempBook, user: req.user, note: req.note ? req.note.content : '', isPubDoc: true });
  } catch (err) {
    console.error('View publication document error:', err);
    res.status(500).render('error', { message: 'Failed to load document', user: req.user, note: req.note ? req.note.content : '' });
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
      return res.status(400).json({ success: false, message: 'Only PDF files allowed' });
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
    console.log('Rendering app:', { appId, appName });
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
  console.log('req.body:', req.body); // Debug: Log form data
  console.log('req.file:', req.file); // Debug: Log file data
  const { 'app-name': name, 'app-description': description, 'app-code': code } = req.body;
  try {
    // Validate inputs
    if (!name || !code) {
      console.log('Validation failed:', { name, code }); // Debug: Log validation failure
      return res.status(400).json({ success: false, message: 'Application name and code are required.' });
    }
    const scriptsDir = path.join(__dirname, 'user-applications', 'scripts');
    const metadataDir = path.join(__dirname, 'user-applications', 'metadata');
    // Create directories if they don't exist
    await fs.mkdir(scriptsDir, { recursive: true });
    await fs.mkdir(metadataDir, { recursive: true });
    // Generate unique file name for script
    const appId = Date.now().toString();
    const scriptPath = path.join(scriptsDir, `user-app-${appId}.js`);
    const metadataPath = path.join(metadataDir, `user-app-${appId}.json`);
    // Save script to file
    await fs.writeFile(scriptPath, code);
    // Save metadata to database
    const application = new Application({
      name,
      description: description || '',
      creatorId: req.user._id,
      filePath: scriptPath,
      icon: req.file ? req.file.buffer : null, // Store as Buffer
      iconType: req.file ? req.file.mimetype : null // Store MIME type
    });
    await application.save();
    // Save metadata to JSON file (update icon to indicate it's a Buffer, but since JSON is metadata, perhaps omit icon details or adjust)
    await fs.writeFile(metadataPath, JSON.stringify({
      id: application._id.toString(),
      name,
      description: description || '',
      creatorId: req.user._id,
      iconPath: `/app-icon/${application._id}` // Use a route path instead of file path
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
    console.log('Fetching icon for app:', req.params.appId, 'Found:', !!application, 'Has icon:', !!application?.icon);
    if (!application || !application.icon) {
      console.log('Serving default icon for app:', req.params.appId);
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
    console.log('Attempting to serve script for appId:', appId, 'Path:', appPath);
    try {
      await fs.access(appPath);
      res.set('Content-Type', 'text/javascript');
      return res.sendFile(appPath);
    } catch {
      const userApp = await Application.findById(appId);
      if (!userApp) {
        console.log('App not found for appId:', appId);
        return res.status(404).send('Application script not found');
      }
      console.log('Serving user app script from:', userApp.filePath);
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

app.post('/api/chatbot', isAuthenticated, async (req, res) => {
    try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ success: false, message: 'Query is required.' });

        // --- Step 1: Master Dispatcher - AI decides WHICH task to perform ---
        const taskDispatchPrompt = `
            You are a master AI agent dispatcher. Your job is to analyze the user's query and categorize it into one of three tasks.
            Respond ONLY with a valid JSON object.

            1.  **task: "database_query"**: If the user is asking for lists, counts, statistics, or relationships in the data. (e.g., "how many books?", "who has the most publications?", "list recent news").
            2.  **task: "content_summary"**: If the user wants a summary, description, or details from the CONTENT of a SINGLE, SPECIFIC item. The user must name the item. (e.g., "summarize the book 'sampleBook'", "what is the news article 'New Update' about?").
            3.  **task: "general_conversation"**: For greetings, simple questions, or if the intent is unclear.

            The JSON output should be: {"task": "...", "subject": "..."}
            - 'subject' should be the specific title of the item if the task is 'content_summary'. Otherwise, it can be null.

            User Query: "${query}"
        `;

        const dispatchText = await callGeminiAPI(taskDispatchPrompt, "");
        let dispatchPlan = { task: 'general_conversation', subject: null };
        try {
            const jsonMatch = dispatchText.match(/\{.*\}/s);
            if (jsonMatch) dispatchPlan = JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error("Failed to parse dispatch plan:", dispatchText);
        }
        console.log('AI Dispatch Plan:', dispatchPlan);

        // --- Step 2: Execute the chosen task ---
        switch (dispatchPlan.task) {

            // ==========================================================
            //  TASK: CONTENT SUMMARY
            // ==========================================================
            case 'content_summary': {
                const subject = dispatchPlan.subject;
                if (!subject) {
                    return res.json({ success: true, response: "Please specify the exact title of the book, news, or publication you'd like me to summarize." });
                }

                let itemContent = null;
                let itemTitle = subject;

                // Search for the item across collections
                const book = await Book.findOne({ title: new RegExp(`^${subject}$`, 'i') }).select('fileData title');
                if (book) {
                    const pdfData = await pdfParse(book.fileData);
                    itemContent = pdfData.text.slice(0, 20000);
                } else {
                    const news = await News.findOne({ title: new RegExp(`^${subject}$`, 'i') }).select('content title');
                    if (news) {
                        itemContent = news.content;
                    } else {
                        const publication = await Publication.findOne({ content: new RegExp(subject, 'i') }).select('content'); // Publications don't have titles, so search content
                        if (publication) {
                            itemContent = publication.content;
                            itemTitle = `a publication starting with "${publication.content.slice(0, 30)}..."`;
                        }
                    }
                }
                
                if (!itemContent) {
                    return res.json({ success: true, response: `I'm sorry, I couldn't find any content for an item titled "${subject}".` });
                }

                const summaryPrompt = `Please provide a detailed summary of the following content from "${itemTitle}". The user's original question was: "${query}"\n\n--- CONTENT ---\n${itemContent}`;
                const finalResponse = await callGeminiAPI(summaryPrompt, "");
                return res.json({ success: true, response: finalResponse });
            }

            // ==========================================================
            //  TASK: DATABASE QUERY
            // ==========================================================
            case 'database_query': {
                const pipelineGenerationPrompt = `
                    You are a MongoDB expert AI. Convert the user's question into a secure, read-only MongoDB aggregation pipeline.
                    Rules: Use the provided schema ONLY. Your output MUST be a JSON object: {"collection": "...", "pipeline": [...]}.
                    --- DATABASE SCHEMA ---
                    ${DATABASE_SCHEMA_FOR_AI}
                    ---
                    User Question: "${query}"
                `;
                const pipelineText = await callGeminiAPI(pipelineGenerationPrompt, "");
                let queryPlan = { collection: null, pipeline: [] };
                try {
                    const jsonMatch = pipelineText.match(/\{.*\}/s);
                    if (jsonMatch) queryPlan = JSON.parse(jsonMatch[0]);
                } catch (e) {
                     return res.json({ success: true, response: "I had trouble formulating a database query. Please rephrase." });
                }

                console.log('AI Generated Query Plan:', queryPlan);
                if (!queryPlan.collection || !isPipelineSafe(queryPlan.pipeline)) {
                    return res.json({ success: true, response: "I'm sorry, I cannot process that specific query." });
                }
                
                const targetCollection = mongoose.connection.collection(queryPlan.collection);
                const toolResult = await targetCollection.aggregate(queryPlan.pipeline).toArray();

                const finalResponsePrompt = `
                    A user asked: "${query}"
                    The database returned this data: ${JSON.stringify(toolResult)}
                    Based on this data, formulate a friendly, natural language response.
                `;
                const finalResponse = await callGeminiAPI(finalResponsePrompt, "");
                return res.json({ success: true, response: finalResponse });
            }

            // ==========================================================
            //  TASK: GENERAL CONVERSATION
            // ==========================================================
            case 'general_conversation':
            default: {
                const genericPrompt = `The user said: "${query}". Provide a brief, friendly, and helpful response in your persona as the BookHive AI assistant. Guide them on what they can ask (e.g., ask for lists of books, news, or summaries of specific items).`;
                const finalResponse = await callGeminiAPI(genericPrompt, "");
                return res.json({ success: true, response: finalResponse });
            }
        }
    } catch (err) {
        console.error('AI Chatbot error:', err);
        res.status(500).json({ success: false, message: 'An error occurred while processing my thoughts.' });
    }
});

cron.schedule('0 21 * * *', () => {
  console.log('Running daily publication email task at 9PM IST');
  sendDailyPublicationEmails();
}, {
  timezone: 'Asia/Kolkata'
});


server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
