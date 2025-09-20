const mongoose = require('mongoose');

const communityMemberSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  clerkUserId: {
    type: String,
    required: true,
    index: true
  },
  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community',
    required: true,
    index: true
  },
  role: {
    type: String,
    enum: ['member', 'moderator', 'admin'],
    default: 'member'
  },
  joinedAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  stats: {
    messagesCount: {
      type: Number,
      default: 0
    },
    contentShared: {
      type: Number,
      default: 0
    },
    quizzesCreated: {
      type: Number,
      default: 0
    },
    quizzesTaken: {
      type: Number,
      default: 0
    },
    totalScore: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound index to ensure user can only join a community once
communityMemberSchema.index({ userId: 1, communityId: 1 }, { unique: true });
communityMemberSchema.index({ clerkUserId: 1, communityId: 1 }, { unique: true });

// Update last activity on save
communityMemberSchema.pre('save', function(next) {
  this.lastActivity = new Date();
  next();
});

module.exports = mongoose.model('CommunityMember', communityMemberSchema);