const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 50
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  category: {
    type: String,
    enum: [
      'Study Group',
      'JEE Preparation', 
      'NEET Preparation',
      'Subject Specific',
      'Doubt Solving',
      'Mock Tests',
      'Motivation',
      'Other',
      'academic', // Legacy support
      'professional', // Legacy support
      'general' // Legacy support
    ],
    default: 'Study Group'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  icon: {
    type: String,
    default: '📖'
  },
  color: {
    type: String,
    default: 'from-blue-400 to-indigo-500'
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
    isPrivate: {
      type: Boolean,
      default: false
    },
    allowMemberInvites: {
      type: Boolean,
      default: true
    },
    requireApproval: {
      type: Boolean,
      default: false
    },
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