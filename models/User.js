const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  clerkUserId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: true,
    trim: true
  },
  profileImage: {
    type: String,
    default: null
  },
  profile: {
    level: {
      type: Number,
      default: 1,
      min: 1
    },
    totalScore: {
      type: Number,
      default: 0,
      min: 0
    },
    completedQuizzes: {
      type: Number,
      default: 0,
      min: 0
    },
    totalStudyTime: {
      type: Number,
      default: 0, // in minutes
      min: 0
    },
    streak: {
      current: {
        type: Number,
        default: 0,
        min: 0
      },
      longest: {
        type: Number,
        default: 0,
        min: 0
      },
      lastActivity: {
        type: Date,
        default: null
      }
    },
    preferences: {
      difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        default: 'medium'
      },
      studyGoal: {
        type: Number,
        default: 30, // minutes per day
        min: 5,
        max: 480
      },
      notifications: {
        email: {
          type: Boolean,
          default: true
        },
        reminders: {
          type: Boolean,
          default: true
        }
      },
      theme: {
        type: String,
        enum: ['light', 'dark', 'auto'],
        default: 'light'
      }
    }
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

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for display name (for UI compatibility)
userSchema.virtual('displayName').get(function() {
  return this.fullName;
});

// Index for efficient queries
userSchema.index({ clerkUserId: 1, isActive: 1 });
userSchema.index({ email: 1, isActive: 1 });

module.exports = mongoose.model('User', userSchema);
