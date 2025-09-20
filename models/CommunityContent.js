const mongoose = require('mongoose');

const communityContentSchema = new mongoose.Schema({
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
  // Reference to original content if shared from personal content
  originalContentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Content',
    default: null
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxLength: 200
  },
  description: {
    type: String,
    trim: true,
    maxLength: 500
  },
  fileName: {
    type: String,
    required: true,
    trim: true
  },
  originalText: {
    type: String,
    required: true,
    minLength: 50
  },
  aiSummary: {
    summary: {
      type: String,
      maxLength: 2000
    },
    keyTopics: [String],
    difficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'intermediate'
    },
    estimatedReadTime: String,
    sections: [{
      title: String,
      summary: String,
      keyPoints: [String]
    }],
    generatedAt: {
      type: Date,
      default: Date.now
    }
  },
  fileType: {
    type: String,
    enum: ['pdf', 'txt', 'docx'],
    default: 'pdf'
  },
  category: {
    type: String,
    enum: ['notes', 'assignment', 'reference', 'practice', 'solution', 'general'],
    default: 'general',
    index: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved' // Auto-approve for now, can add moderation later
  },
  visibility: {
    type: String,
    enum: ['public', 'members-only'],
    default: 'members-only'
  },
  downloadCount: {
    type: Number,
    default: 0
  },
  likeCount: {
    type: Number,
    default: 0
  },
  viewCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient queries
communityContentSchema.index({ communityId: 1, status: 1, createdAt: -1 });
communityContentSchema.index({ userId: 1, communityId: 1 });
communityContentSchema.index({ category: 1, communityId: 1 });

// Virtual for author information
communityContentSchema.virtual('author', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

module.exports = mongoose.model('CommunityContent', communityContentSchema);