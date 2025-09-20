const mongoose = require('mongoose');

const communityQuizAttemptSchema = new mongoose.Schema({
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
  communityQuizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CommunityQuiz',
    required: true,
    index: true
  },
  communityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Community',
    required: true,
    index: true
  },
  attemptNumber: {
    type: Number,
    required: true,
    min: 1
  },
  answers: [{
    questionIndex: {
      type: Number,
      required: true
    },
    questionId: {
      type: String,
      required: false
    },
    selectedAnswer: {
      type: Number,
      required: false,
      default: null,
      min: 0,
      max: 3
    },
    isCorrect: {
      type: Boolean,
      default: false
    },
    timeSpent: {
      type: Number, // seconds spent on this question
      default: 0
    }
  }],
  score: {
    type: Number,
    required: false,
    default: 0,
    min: 0
  },
  percentage: {
    type: Number,
    required: false,
    default: 0,
    min: 0,
    max: 100
  },
  totalQuestions: {
    type: Number,
    required: false,
    default: 0
  },
  correctAnswers: {
    type: Number,
    required: false,
    default: 0,
    min: 0
  },
  totalTimeTaken: {
    type: Number, // total time in seconds
    required: false,
    default: 0,
    min: 0
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date,
    required: false,
    default: null
  },
  status: {
    type: String,
    enum: ['in-progress', 'completed', 'submitted', 'abandoned'],
    default: 'in-progress'
  },
  isPassed: {
    type: Boolean,
    required: false,
    default: false
  },
  rank: {
    type: Number,
    default: null // Will be calculated based on score/time
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for efficient queries
communityQuizAttemptSchema.index({ 
  userId: 1, 
  communityQuizId: 1, 
  attemptNumber: 1 
}, { unique: true });

communityQuizAttemptSchema.index({ 
  communityQuizId: 1, 
  score: -1, 
  timeSpent: 1 
}); // For leaderboard

communityQuizAttemptSchema.index({ 
  communityId: 1, 
  userId: 1, 
  createdAt: -1 
}); // For user's community quiz history

communityQuizAttemptSchema.index({ 
  clerkUserId: 1, 
  createdAt: -1 
}); // For user's overall quiz history

// Virtual for quiz information
communityQuizAttemptSchema.virtual('quiz', {
  ref: 'CommunityQuiz',
  localField: 'communityQuizId',
  foreignField: '_id',
  justOne: true
});

// Virtual for user information
communityQuizAttemptSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

module.exports = mongoose.model('CommunityQuizAttempt', communityQuizAttemptSchema);