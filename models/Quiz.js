const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
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
    enum: ['beginner', 'intermediate', 'advanced', 'easy', 'medium', 'hard'], // Added easy, medium, hard
    default: 'intermediate'
  },
  category: {
    type: String,
    enum: ['technology', 'science', 'business', 'education', 'health', 'arts', 'general', 'custom'], // Added custom
    default: 'general',
    index: true
  },
  // New fields for custom quizzes
  isCustom: {
    type: Boolean,
    default: false,
    index: true
  },
  customTopic: {
    type: String,
    trim: true,
    maxLength: 200
  },
  questions: [{
    question: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      enum: ['multiple-choice', 'true-false', 'short-answer', 'essay'],
      default: 'multiple-choice'
    },
    options: [{
      text: {
        type: String,
        required: true,
        trim: true
      },
      isCorrect: {
        type: Boolean,
        default: false
      }
    }],
    correctAnswer: {
      type: String,
      trim: true
    },
    explanation: {
      type: String,
      trim: true
    },
    points: {
      type: Number,
      min: 1,
      max: 10,
      default: 1
    },
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard'],
      default: 'medium'
    },
    tags: [{
      type: String,
      trim: true,
      lowercase: true
    }]
  }],
  settings: {
    timeLimit: {
      type: Number,
      min: 0 // in minutes, 0 means no time limit
    },
    randomizeQuestions: {
      type: Boolean,
      default: true
    },
    randomizeOptions: {
      type: Boolean,
      default: true
    },
    showCorrectAnswer: {
      type: Boolean,
      default: true
    },
    allowRetakes: {
      type: Boolean,
      default: true
    },
    maxAttempts: {
      type: Number,
      min: 1,
      max: 10,
      default: 3
    },
    passingScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 70
    }
  },
  analytics: {
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
    bestScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    averageTimeSpent: {
      type: Number,
      min: 0,
      default: 0 // in minutes
    },
    passRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    lastTaken: {
      type: Date,
      default: null
    }
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft'
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

// Virtual for total questions
quizSchema.virtual('totalQuestions').get(function() {
  return this.questions.length;
});

// Virtual for total points
quizSchema.virtual('totalPoints').get(function() {
  return this.questions.reduce((total, question) => total + question.points, 0);
});

// Virtual for estimated time to complete (based on questions)
quizSchema.virtual('estimatedTime').get(function() {
  const baseTimePerQuestion = 1.5; // minutes
  const difficultyMultiplier = {
    'easy': 0.8,
    'medium': 1.0,
    'hard': 1.5
  };
  
  return this.questions.reduce((total, question) => {
    const multiplier = difficultyMultiplier[question.difficulty] || 1.0;
    return total + (baseTimePerQuestion * multiplier);
  }, 0);
});

// Virtual for quiz completion status
quizSchema.virtual('completionStatus').get(function() {
  if (this.status === 'draft') return 'draft';
  if (this.analytics.totalAttempts === 0) return 'not-started';
  if (this.analytics.bestScore >= this.settings.passingScore) return 'passed';
  return 'attempted';
});

// Indexes for efficient queries
quizSchema.index({ contentId: 1, userId: 1, isActive: 1 });
quizSchema.index({ clerkUserId: 1, isActive: 1, createdAt: -1 });
quizSchema.index({ category: 1, difficulty: 1, status: 1 });
quizSchema.index({ status: 1, isActive: 1 });
quizSchema.index({ 'analytics.lastTaken': -1 });

// Text search index
quizSchema.index({
  title: 'text',
  description: 'text',
  'questions.question': 'text'
}, {
  weights: {
    title: 10,
    description: 5,
    'questions.question': 3
  }
});

// Validate at least one question exists
quizSchema.pre('save', function(next) {
  if (this.status === 'published' && this.questions.length === 0) {
    next(new Error('Published quiz must have at least one question'));
  }
  next();
});

// Validate multiple choice questions have correct answers
quizSchema.pre('save', function(next) {
  for (const question of this.questions) {
    if (question.type === 'multiple-choice') {
      const hasCorrectOption = question.options.some(option => option.isCorrect);
      if (!hasCorrectOption) {
        next(new Error(`Multiple choice question "${question.question}" must have at least one correct answer`));
      }
    }
  }
  next();
});

module.exports = mongoose.model('Quiz', quizSchema);
