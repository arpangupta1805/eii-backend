const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    enum: ['JEE', 'NEET'] // Only these two communities for now
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['academic', 'professional', 'general'],
    default: 'academic'
  },
  icon: {
    type: String,
    default: null
  },
  color: {
    type: String,
    default: '#3B82F6' // Default blue color
  },
  isActive: {
    type: Boolean,
    default: true
  },
  memberCount: {
    type: Number,
    default: 0
  },
  settings: {
    allowContentSharing: {
      type: Boolean,
      default: true
    },
    allowQuizCreation: {
      type: Boolean,
      default: true
    },
    requireModeration: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for member count (could be calculated from CommunityMember)
communitySchema.virtual('activeMemberCount', {
  ref: 'CommunityMember',
  localField: '_id',
  foreignField: 'communityId',
  count: true,
  match: { isActive: true }
});

module.exports = mongoose.model('Community', communitySchema);