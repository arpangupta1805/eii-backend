const mongoose = require('mongoose');

const contentSchema = new mongoose.Schema({
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
  title: {
    type: String,
    required: true,
    trim: true,
    maxLength: 200
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
  fileType: {
    type: String,
    enum: ['pdf', 'txt', 'docx'],
    default: 'pdf'
  },
  category: {
    type: String,
    enum: ['technology', 'science', 'business', 'education', 'health', 'arts', 'general'],
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
    enum: ['processing', 'processed', 'failed'],
    default: 'processing'
  },
  progress: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  metadata: {
    wordCount: {
      type: Number,
      min: 0
    },
    pageCount: {
      type: Number,
      min: 0,
      default: 1
    },
    fileSize: {
      type: Number,
      min: 0 // in bytes
    },
    readingTime: {
      type: Number,
      min: 0 // estimated reading time in minutes
    },
    language: {
      type: String,
      default: 'en'
    }
  },
  aiSummary: {
    summary: {
      type: String,
      maxLength: 2000
    },
    keyTopics: [{
      topic: String,
      confidence: {
        type: Number,
        min: 0,
        max: 1
      }
    }],
    difficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'intermediate'
    },
    learningObjectives: [String],
    prerequisites: [String],
    estimatedStudyTime: {
      type: Number,
      min: 0 // in minutes
    },
    sections: [{
      title: String,
      content: String,
      keyPoints: [String]
    }],
    generatedAt: {
      type: Date,
      default: Date.now
    }
  },
  analytics: {
    views: {
      type: Number,
      default: 0,
      min: 0
    },
    totalStudyTime: {
      type: Number,
      default: 0,
      min: 0 // in minutes
    },
    quizzesTaken: {
      type: Number,
      default: 0,
      min: 0
    },
    averageQuizScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    lastAccessed: {
      type: Date,
      default: null
    }
  },
  quizHistory: {
    hasQuiz: {
      type: Boolean,
      default: false
    },
    quizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quiz',
      default: null
    },
    totalAttempts: {
      type: Number,
      default: 0,
      min: 0
    },
    bestScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    lastAttempt: {
      type: Date,
      default: null
    },
    isPassed: {
      type: Boolean,
      default: false
    },
    attempts: [{
      attemptId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'QuizAttempt'
      },
      score: {
        type: Number,
        min: 0,
        max: 100
      },
      passed: {
        type: Boolean,
        default: false
      },
      completedAt: {
        type: Date
      }
    }]
  },
  isPublic: {
    type: Boolean,
    default: false
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

// Virtual for content status based on progress
contentSchema.virtual('contentStatus').get(function() {
  if (this.progress === 0) return 'new';
  if (this.progress === 100) return 'completed';
  return 'in-progress';
});

// Indexes for efficient queries
contentSchema.index({ userId: 1, isActive: 1, createdAt: -1 });
contentSchema.index({ clerkUserId: 1, isActive: 1, createdAt: -1 });
contentSchema.index({ category: 1, isActive: 1 });
contentSchema.index({ tags: 1, isActive: 1 });
contentSchema.index({ 'aiSummary.difficulty': 1, isActive: 1 });

// Text search index
contentSchema.index({
  title: 'text',
  originalText: 'text',
  'aiSummary.summary': 'text',
  'aiSummary.keyTopics.topic': 'text'
}, {
  weights: {
    title: 10,
    'aiSummary.summary': 5,
    'aiSummary.keyTopics.topic': 3,
    originalText: 1
  }
});

module.exports = mongoose.model('Content', contentSchema);
