const mongoose = require('mongoose');

const communityMessageSchema = new mongoose.Schema({
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
  // For quiz discussions - reference to specific quiz
  communityQuizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CommunityQuiz',
    default: null,
    index: true
  },
  // Message content
  content: {
    type: String,
    required: true,
    trim: true,
    maxLength: 2000
  },
  type: {
    type: String,
    enum: ['general', 'quiz-discussion', 'announcement'],
    default: 'general'
  },
  // For replies and threading
  parentMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CommunityMessage',
    default: null,
    index: true
  },
  // File attachments (optional)
  attachments: [{
    fileName: String,
    fileUrl: String,
    fileType: {
      type: String,
      enum: ['image', 'document', 'link']
    },
    fileSize: Number
  }],
  // Message interactions
  reactions: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    emoji: {
      type: String,
      enum: ['👍', '👎', '❤️', '😂', '😮', '😢', '😡']
    }
  }],
  replyCount: {
    type: Number,
    default: 0
  },
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date,
    default: null
  },
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  },
  // Moderation
  isFlagged: {
    type: Boolean,
    default: false
  },
  flagReason: {
    type: String,
    default: null
  },
  moderatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient queries
communityMessageSchema.index({ 
  communityId: 1, 
  type: 1, 
  createdAt: -1 
});

communityMessageSchema.index({ 
  communityQuizId: 1, 
  createdAt: -1 
}, { sparse: true });

communityMessageSchema.index({ 
  parentMessageId: 1, 
  createdAt: 1 
}, { sparse: true });

communityMessageSchema.index({ 
  userId: 1, 
  communityId: 1, 
  createdAt: -1 
});

// Virtual for author information
communityMessageSchema.virtual('author', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Virtual for reply messages
communityMessageSchema.virtual('replies', {
  ref: 'CommunityMessage',
  localField: '_id',
  foreignField: 'parentMessageId'
});

module.exports = mongoose.model('CommunityMessage', communityMessageSchema);