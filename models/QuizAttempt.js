const mongoose = require('mongoose');

const quizAttemptSchema = new mongoose.Schema({
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true,
    index: true
  },
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Content',
    required: false, // Made optional for custom quizzes
    index: true
  },
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
  attemptNumber: {
    type: Number,
    required: true,
    min: 1
  },
  answers: [{
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true
    },
    sectionTitle: {
      type: String,
      trim: true
    },
    userAnswer: {
      type: String,
      required: true,
      trim: true
    },
    isCorrect: {
      type: Boolean,
      required: true
    },
    points: {
      type: Number,
      min: 0,
      default: 0
    },
    timeSpent: {
      type: Number,
      min: 0,
      default: 0 // in seconds
    }
  }],
  score: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  totalPoints: {
    type: Number,
    min: 0,
    default: 0
  },
  maxPoints: {
    type: Number,
    min: 0,
    default: 0
  },
  timeSpent: {
    type: Number,
    min: 0,
    default: 0 // in minutes
  },
  startedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  completedAt: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: ['in-progress', 'completed', 'abandoned', 'timed-out'],
    default: 'in-progress'
  },
  passed: {
    type: Boolean,
    default: false
  },
  feedback: {
    overall: {
      type: String,
      trim: true
    },
    strengths: [String],
    weaknesses: [String],
    recommendations: [String]
  },
  sectionScores: [{
    sectionTitle: String,
    score: {
      type: Number,
      min: 0,
      max: 100
    },
    totalQuestions: Number,
    correctAnswers: Number
  }],
  aiSummary: {
    overallPerformance: {
      type: String,
      enum: ['excellent', 'good', 'average', 'needs-improvement']
    },
    summary: String,
    strengths: [String],
    weaknesses: [String],
    recommendations: [String],
    topicsMastered: [String],
    topicsToReview: [String],
    nextSteps: String,
    motivationalMessage: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for completion time in minutes
quizAttemptSchema.virtual('completionTime').get(function() {
  if (this.completedAt && this.startedAt) {
    return Math.round((this.completedAt - this.startedAt) / (1000 * 60)); // in minutes
  }
  return null;
});

// Virtual for percentage score
quizAttemptSchema.virtual('percentageScore').get(function() {
  if (this.maxPoints > 0) {
    return Math.round((this.totalPoints / this.maxPoints) * 100);
  }
  return 0;
});

// Virtual for correct answers count
quizAttemptSchema.virtual('correctAnswers').get(function() {
  return this.answers.filter(answer => answer.isCorrect).length;
});

// Virtual for total questions count
quizAttemptSchema.virtual('totalQuestions').get(function() {
  return this.answers.length;
});

// Virtual for accuracy rate
quizAttemptSchema.virtual('accuracy').get(function() {
  if (this.answers.length > 0) {
    return Math.round((this.correctAnswers / this.answers.length) * 100);
  }
  return 0;
});

// Indexes for efficient queries
quizAttemptSchema.index({ quizId: 1, userId: 1, attemptNumber: 1 }, { unique: true });
quizAttemptSchema.index({ clerkUserId: 1, completedAt: -1 });
quizAttemptSchema.index({ contentId: 1, userId: 1 });
quizAttemptSchema.index({ status: 1, startedAt: -1 });
quizAttemptSchema.index({ passed: 1, score: -1 });

// Pre-save middleware to calculate score and determine pass/fail
quizAttemptSchema.pre('save', function(next) {
  if (this.isModified('answers') || this.isNew) {
    // Calculate total points and score
    this.totalPoints = this.answers.reduce((total, answer) => total + (answer.points || 0), 0);
    
    if (this.maxPoints > 0) {
      this.score = Math.round((this.totalPoints / this.maxPoints) * 100);
    }
  }
  next();
});

// Method to mark attempt as completed
quizAttemptSchema.methods.complete = function() {
  this.status = 'completed';
  this.completedAt = new Date();
  this.timeSpent = Math.round((this.completedAt - this.startedAt) / (1000 * 60));
  return this.save();
};

// Method to abandon attempt
quizAttemptSchema.methods.abandon = function() {
  this.status = 'abandoned';
  return this.save();
};

// Static method to get user's best attempt for a quiz
quizAttemptSchema.statics.getBestAttempt = function(quizId, userId) {
  return this.findOne({ 
    quizId, 
    userId, 
    status: 'completed' 
  }).sort({ score: -1, completedAt: -1 });
};

// Static method to get user's latest attempt for a quiz
quizAttemptSchema.statics.getLatestAttempt = function(quizId, userId) {
  return this.findOne({ 
    quizId, 
    userId 
  }).sort({ attemptNumber: -1 });
};

// Static method to get user's attempt history for a quiz
quizAttemptSchema.statics.getAttemptHistory = function(quizId, userId) {
  return this.find({ 
    quizId, 
    userId,
    status: 'completed'
  }).sort({ attemptNumber: -1 });
};

module.exports = mongoose.model('QuizAttempt', quizAttemptSchema);
