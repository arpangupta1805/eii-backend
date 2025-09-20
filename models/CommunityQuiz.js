const mongoose = require('mongoose');

const communityQuizSchema = new mongoose.Schema({
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
  // Reference to community content if quiz is based on shared content
  communityContentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CommunityContent',
    default: null
  },
  // Reference to original content if quiz is based on personal content
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
  difficulty: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'easy', 'medium', 'hard'],
    default: 'intermediate'
  },
  category: {
    type: String,
    enum: ['technology', 'science', 'business', 'education', 'health', 'arts', 'general', 'custom'],
    default: 'general',
    index: true
  },
  isCustom: {
    type: Boolean,
    default: false
  },
  customTopic: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    enum: ['public', 'private'],
    default: 'public',
    index: true
  },
  // For private quizzes
  accessCode: {
    type: String,
    default: null
  },
  allowedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  questions: [{
    question: {
      type: String,
      required: true,
      trim: true
    },
    options: [{
      type: String,
      required: true,
      trim: true
    }],
    correctAnswer: {
      type: Number,
      required: true,
      min: 0,
      max: 3
    },
    explanation: {
      type: String,
      trim: true,
      default: ''
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium'
    },
    points: {
      type: Number,
      default: 1,
      min: 1
    }
  }],
  timeLimit: {
    type: Number,
    default: 30, // minutes
    min: 5,
    max: 180
  },
  maxAttempts: {
    type: Number,
    default: 1,
    min: 1,
    max: 5
  },
  passingScore: {
    type: Number,
    default: 60, // percentage
    min: 0,
    max: 100
  },
  isActive: {
    type: Boolean,
    default: true
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'published'
  },
  stats: {
    totalAttempts: {
      type: Number,
      default: 0
    },
    averageScore: {
      type: Number,
      default: 0
    },
    highestScore: {
      type: Number,
      default: 0
    },
    completionRate: {
      type: Number,
      default: 0
    }
  },
  settings: {
    showAnswersAfterSubmission: {
      type: Boolean,
      default: true
    },
    allowDiscussion: {
      type: Boolean,
      default: true
    },
    shuffleQuestions: {
      type: Boolean,
      default: false
    },
    shuffleOptions: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient queries
communityQuizSchema.index({ communityId: 1, status: 1, type: 1, createdAt: -1 });
communityQuizSchema.index({ userId: 1, communityId: 1 });
communityQuizSchema.index({ accessCode: 1 }, { sparse: true });
communityQuizSchema.index({ type: 1, communityId: 1 });

// Virtual for question count
communityQuizSchema.virtual('questionCount').get(function() {
  return this.questions.length;
});

// Virtual for total possible points
communityQuizSchema.virtual('totalPoints').get(function() {
  return this.questions.reduce((sum, q) => sum + q.points, 0);
});

// Virtual for author information
communityQuizSchema.virtual('author', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Generate random access code for private quizzes
communityQuizSchema.pre('save', function(next) {
  if (this.type === 'private' && !this.accessCode) {
    this.accessCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('CommunityQuiz', communityQuizSchema);