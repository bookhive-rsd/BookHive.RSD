const mongoose = require('mongoose');
const applicationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  filePath: { type: String, required: true },
  iconPath: { type: String, default: '/images/default-app-icon.png' },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.models.Application || mongoose.model('Application', applicationSchema);