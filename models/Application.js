const mongoose = require('mongoose');
const applicationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  filePath: { type: String, required: true },
  icon: { type: Buffer },  // Changed from iconPath: String to icon: Buffer
  iconType: { type: String }  // Added to store MIME type
});
module.exports = mongoose.models.Application || mongoose.model('Application', applicationSchema);