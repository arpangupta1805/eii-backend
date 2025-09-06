const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
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
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Content',
    required: true,
    index: true
  },
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    index: true
  },
  progressType: {
    type: String,
    enum: ['content', 'quiz'],
    required: true,
    index: true
  },
  
  // Content Progress Fields
  contentProgress: {
    status: {
      type: String,
      enum: ['not-started', 'reading', 'completed', 'bookmarked'],
      default: 'not-started'
    },
    percentageRead: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    timeSpent: {
      type: Number,
      min: 0,
      default: 0 // in minutes
    },
    bookmarks: [{
      position: Number, // Character position or page number
      note: String,
      timestamp: {
        type: Date,
        default: Date.now
      }
    }],
    highlights: [{
      startPosition: Number,
      endPosition: Number,
      text: String,
      color: {
        type: String,
        default: '#ffeb3b'
      },
      timestamp: {
        type: Date,
        default: Date.now
      }
    }],
    notes: [{
      content: String,
      position: Number,
      timestamp: {
        type: Date,
        default: Date.now
      }
    }],
    lastReadPosition: {
      type: Number,
      default: 0
    },
    sessionsCount: {
      type: Number,
      default: 0,
      min: 0
    },
    averageSessionTime: {
      type: Number,
      default: 0,
      min: 0 // in minutes
    }
  },
  
  // Quiz Progress Fields
  quizProgress: {
    attempts: [{
      attemptNumber: {
        type: Number,
        required: true
      },
      startedAt: {
        type: Date,
        default: Date.now
      },
      completedAt: Date,
      timeSpent: {
        type: Number,
        min: 0 // in minutes
      },
      score: {
        type: Number,
        min: 0,
        max: 100
      },
      totalQuestions: Number,
      correctAnswers: Number,
      answers: [{
        questionId: String,
        userAnswer: mongoose.Schema.Types.Mixed, // Can be string, array, or boolean
        isCorrect: Boolean,
        pointsEarned: Number,
        timeSpent: Number // in seconds
      }],
      status: {
        type: String,
        enum: ['in-progress', 'completed', 'abandoned'],
        default: 'in-progress'
      },
      feedback: String
    }],
    bestScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    totalAttempts: {
      type: Number,
      default: 0,
      min: 0
    },
    averageScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    isPassed: {
      type: Boolean,
      default: false
    },
    lastAttemptDate: Date,
    totalTimeSpent: {
      type: Number,
      default: 0,
      min: 0 // in minutes
    }
  },
  
  // Learning Analytics
  analytics: {
    strengths: [{
      topic: String,
      confidence: {
        type: Number,
        min: 0,
        max: 1
      }
    }],
    weaknesses: [{
      topic: String,
      needsImprovement: {
        type: Number,
        min: 0,
        max: 1
      }
    }],
    learningPatterns: {
      bestTimeToStudy: {
        type: String,
        enum: ['morning', 'afternoon', 'evening', 'night']
      },
      averageSessionLength: Number, // in minutes
      preferredDifficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard']
      },
      retentionRate: {
        type: Number,
        min: 0,
        max: 1
      }
    },
    recommendations: [{
      type: {
        type: String,
        enum: ['review', 'practice', 'advance', 'break']
      },
      message: String,
      priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
      },
      createdAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  
  // Metadata
  lastAccessed: {
    type: Date,
    default: Date.now
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

// Virtual for overall completion percentage
progressSchema.virtual('overallCompletion').get(function() {
  if (this.progressType === 'content') {
    return this.contentProgress.percentageRead;
  } else if (this.progressType === 'quiz') {
    return this.quizProgress.isPassed ? 100 : 0;
  }
  return 0;
});

// Virtual for current streak
progressSchema.virtual('currentStreak').get(function() {
  // This would be calculated based on consecutive days of activity
  // Implementation would check daily activity patterns
  return 0; // Placeholder
});

// Virtual for total learning time
progressSchema.virtual('totalLearningTime').get(function() {
  if (this.progressType === 'content') {
    return this.contentProgress.timeSpent;
  } else if (this.progressType === 'quiz') {
    return this.quizProgress.totalTimeSpent;
  }
  return 0;
});

// Compound indexes for efficient queries
progressSchema.index({ userId: 1, contentId: 1, progressType: 1 }, { unique: true });
progressSchema.index({ clerkUserId: 1, progressType: 1, lastAccessed: -1 });
progressSchema.index({ contentId: 1, progressType: 1 });
progressSchema.index({ quizId: 1, progressType: 1 });
progressSchema.index({ progressType: 1, isActive: 1 });

// Index for analytics queries
progressSchema.index({ 'contentProgress.status': 1, isActive: 1 });
progressSchema.index({ 'quizProgress.isPassed': 1, isActive: 1 });
progressSchema.index({ lastAccessed: -1, isActive: 1 });

// Pre-save middleware to update analytics
progressSchema.pre('save', function(next) {
  this.lastAccessed = new Date();
  
  if (this.progressType === 'quiz' && this.quizProgress.attempts.length > 0) {
    // Update quiz analytics
    const completedAttempts = this.quizProgress.attempts.filter(attempt => attempt.status === 'completed');
    
    if (completedAttempts.length > 0) {
      this.quizProgress.totalAttempts = completedAttempts.length;
      this.quizProgress.bestScore = Math.max(...completedAttempts.map(attempt => attempt.score));
      this.quizProgress.averageScore = completedAttempts.reduce((sum, attempt) => sum + attempt.score, 0) / completedAttempts.length;
      this.quizProgress.lastAttemptDate = Math.max(...completedAttempts.map(attempt => attempt.completedAt));
      this.quizProgress.totalTimeSpent = completedAttempts.reduce((sum, attempt) => sum + attempt.timeSpent, 0);
    }
  }
  
  next();
});

module.exports = mongoose.model('Progress', progressSchema);
