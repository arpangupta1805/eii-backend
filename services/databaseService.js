const User = require('../models/User');
const Content = require('../models/Content');
const Quiz = require('../models/Quiz');
const Progress = require('../models/Progress');
const mongoose = require('mongoose');

class DatabaseService {
  // User operations
  async createUser(userData) {
    try {
      const user = new User(userData);
      await user.save();
      return { success: true, data: user };
    } catch (error) {
      console.error('Create user error:', error);
      return { success: false, error: error.message };
    }
  }

  async getUserByClerkId(clerkUserId) {
    try {
      const user = await User.findOne({ clerkUserId, isActive: true });
      return { success: true, data: user };
    } catch (error) {
      console.error('Get user by clerk ID error:', error);
      return { success: false, error: error.message };
    }
  }

  async updateUser(clerkUserId, updateData) {
    try {
      const user = await User.findOneAndUpdate(
        { clerkUserId, isActive: true },
        { ...updateData, updatedAt: new Date() },
        { new: true, runValidators: true }
      );
      return { success: true, data: user };
    } catch (error) {
      console.error('Update user error:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteUser(clerkUserId) {
    try {
      // Soft delete - mark as inactive
      const user = await User.findOneAndUpdate(
        { clerkUserId },
        { isActive: false, updatedAt: new Date() },
        { new: true }
      );
      return { success: true, data: user };
    } catch (error) {
      console.error('Delete user error:', error);
      return { success: false, error: error.message };
    }
  }

  // Content operations
  async createContent(contentData) {
    try {
      const content = new Content(contentData);
      await content.save();
      return { success: true, data: content };
    } catch (error) {
      console.error('Create content error:', error);
      return { success: false, error: error.message };
    }
  }

  async getContentById(contentId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(contentId)) {
        return { success: false, error: 'Invalid content ID format' };
      }

      const content = await Content.findById(contentId)
        .populate('userId', 'firstName lastName email')
        .where({ isActive: true });
      
      return { success: true, data: content };
    } catch (error) {
      console.error('Get content by ID error:', error);
      return { success: false, error: error.message };
    }
  }

  async getContentByUser(clerkUserId, options = {}) {
    try {
      const {
        page = 1,
        limit = 10,
        category,
        status,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options;

      const query = { clerkUserId, isActive: true };
      
      if (category) query.category = category;
      if (status) query.status = status;

      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

      const [content, total] = await Promise.all([
        Content.find(query)
          .sort(sort)
          .skip(skip)
          .limit(parseInt(limit))
          .select('-originalText'), // Exclude large text field for list view
        Content.countDocuments(query)
      ]);

      return {
        success: true,
        data: {
          content,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      };
    } catch (error) {
      console.error('Get content by user error:', error);
      return { success: false, error: error.message };
    }
  }

  async updateContent(contentId, clerkUserId, updateData) {
    try {
      if (!mongoose.Types.ObjectId.isValid(contentId)) {
        return { success: false, error: 'Invalid content ID format' };
      }

      const content = await Content.findOneAndUpdate(
        { _id: contentId, clerkUserId, isActive: true },
        { ...updateData, updatedAt: new Date() },
        { new: true, runValidators: true }
      );
      
      if (!content) {
        return { success: false, error: 'Content not found or access denied' };
      }
      
      return { success: true, data: content };
    } catch (error) {
      console.error('Update content error:', error);
      return { success: false, error: error.message };
    }
  }

  async deleteContent(contentId, clerkUserId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(contentId)) {
        return { success: false, error: 'Invalid content ID format' };
      }

      const content = await Content.findOneAndUpdate(
        { _id: contentId, clerkUserId },
        { isActive: false, updatedAt: new Date() },
        { new: true }
      );
      
      if (!content) {
        return { success: false, error: 'Content not found or access denied' };
      }
      
      // Also soft delete related quizzes and progress
      await Promise.all([
        Quiz.updateMany(
          { contentId, clerkUserId },
          { isActive: false, updatedAt: new Date() }
        ),
        Progress.updateMany(
          { contentId, clerkUserId },
          { isActive: false, updatedAt: new Date() }
        )
      ]);
      
      return { success: true, data: content };
    } catch (error) {
      console.error('Delete content error:', error);
      return { success: false, error: error.message };
    }
  }

  // Quiz operations
  async createQuiz(quizData) {
    try {
      const quiz = new Quiz(quizData);
      await quiz.save();
      return { success: true, data: quiz };
    } catch (error) {
      console.error('Create quiz error:', error);
      return { success: false, error: error.message };
    }
  }

  async getQuizById(quizId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(quizId)) {
        return { success: false, error: 'Invalid quiz ID format' };
      }

      const quiz = await Quiz.findById(quizId)
        .populate('contentId', 'title category')
        .populate('userId', 'firstName lastName email')
        .where({ isActive: true });
      
      return { success: true, data: quiz };
    } catch (error) {
      console.error('Get quiz by ID error:', error);
      return { success: false, error: error.message };
    }
  }

  async getQuizzesByContent(contentId, clerkUserId) {
    try {
      if (!mongoose.Types.ObjectId.isValid(contentId)) {
        return { success: false, error: 'Invalid content ID format' };
      }

      const quizzes = await Quiz.find({
        contentId,
        clerkUserId,
        isActive: true
      }).sort({ createdAt: -1 });
      
      return { success: true, data: quizzes };
    } catch (error) {
      console.error('Get quizzes by content error:', error);
      return { success: false, error: error.message };
    }
  }

  async updateQuiz(quizId, clerkUserId, updateData) {
    try {
      if (!mongoose.Types.ObjectId.isValid(quizId)) {
        return { success: false, error: 'Invalid quiz ID format' };
      }

      const quiz = await Quiz.findOneAndUpdate(
        { _id: quizId, clerkUserId, isActive: true },
        { ...updateData, updatedAt: new Date() },
        { new: true, runValidators: true }
      );
      
      if (!quiz) {
        return { success: false, error: 'Quiz not found or access denied' };
      }
      
      return { success: true, data: quiz };
    } catch (error) {
      console.error('Update quiz error:', error);
      return { success: false, error: error.message };
    }
  }

  // Progress operations
  async createProgress(progressData) {
    try {
      const progress = new Progress(progressData);
      await progress.save();
      return { success: true, data: progress };
    } catch (error) {
      console.error('Create progress error:', error);
      return { success: false, error: error.message };
    }
  }

  async getProgressByUser(clerkUserId, options = {}) {
    try {
      const {
        progressType,
        contentId,
        limit = 20,
        sortBy = 'lastAccessed',
        sortOrder = 'desc'
      } = options;

      const query = { clerkUserId, isActive: true };
      
      if (progressType) query.progressType = progressType;
      if (contentId && mongoose.Types.ObjectId.isValid(contentId)) {
        query.contentId = contentId;
      }

      const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

      const progress = await Progress.find(query)
        .populate('contentId', 'title category')
        .populate('quizId', 'title difficulty')
        .sort(sort)
        .limit(parseInt(limit));

      return { success: true, data: progress };
    } catch (error) {
      console.error('Get progress by user error:', error);
      return { success: false, error: error.message };
    }
  }

  async updateProgress(clerkUserId, contentId, progressType, updateData) {
    try {
      if (!mongoose.Types.ObjectId.isValid(contentId)) {
        return { success: false, error: 'Invalid content ID format' };
      }

      const progress = await Progress.findOneAndUpdate(
        { clerkUserId, contentId, progressType, isActive: true },
        { ...updateData, lastAccessed: new Date() },
        { 
          new: true, 
          upsert: true, 
          runValidators: true,
          setDefaultsOnInsert: true 
        }
      );
      
      return { success: true, data: progress };
    } catch (error) {
      console.error('Update progress error:', error);
      return { success: false, error: error.message };
    }
  }

  // Search operations
  async searchContent(query, clerkUserId, options = {}) {
    try {
      const {
        category,
        difficulty,
        limit = 10,
        page = 1
      } = options;

      const searchQuery = {
        $text: { $search: query },
        clerkUserId,
        isActive: true
      };

      if (category) searchQuery.category = category;
      if (difficulty) searchQuery['aiSummary.difficulty'] = difficulty;

      const skip = (page - 1) * limit;

      const [results, total] = await Promise.all([
        Content.find(searchQuery)
          .select('title fileName category aiSummary.summary aiSummary.difficulty createdAt')
          .sort({ score: { $meta: 'textScore' } })
          .skip(skip)
          .limit(parseInt(limit)),
        Content.countDocuments(searchQuery)
      ]);

      return {
        success: true,
        data: {
          results,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      };
    } catch (error) {
      console.error('Search content error:', error);
      return { success: false, error: error.message };
    }
  }

  // Analytics operations
  async getUserAnalytics(clerkUserId, options = {}) {
    try {
      const { days = 30 } = options;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get user's learning statistics
      const [
        totalContent,
        completedContent,
        totalQuizzes,
        passedQuizzes,
        recentProgress
      ] = await Promise.all([
        Content.countDocuments({ clerkUserId, isActive: true }),
        Progress.countDocuments({
          clerkUserId,
          progressType: 'content',
          'contentProgress.status': 'completed',
          isActive: true
        }),
        Quiz.countDocuments({ clerkUserId, isActive: true }),
        Progress.countDocuments({
          clerkUserId,
          progressType: 'quiz',
          'quizProgress.isPassed': true,
          isActive: true
        }),
        Progress.find({
          clerkUserId,
          lastAccessed: { $gte: startDate },
          isActive: true
        }).populate('contentId', 'title category')
      ]);

      // Calculate study streak
      const user = await User.findOne({ clerkUserId });
      const currentStreak = user?.profile?.streak?.current || 0;

      const analytics = {
        totalContent,
        completedContent,
        completionRate: totalContent > 0 ? (completedContent / totalContent) * 100 : 0,
        totalQuizzes,
        passedQuizzes,
        quizPassRate: totalQuizzes > 0 ? (passedQuizzes / totalQuizzes) * 100 : 0,
        currentStreak,
        recentActivity: recentProgress.length,
        totalStudyTime: recentProgress.reduce((total, progress) => {
          if (progress.progressType === 'content') {
            return total + (progress.contentProgress.timeSpent || 0);
          } else if (progress.progressType === 'quiz') {
            return total + (progress.quizProgress.totalTimeSpent || 0);
          }
          return total;
        }, 0)
      };

      return { success: true, data: analytics };
    } catch (error) {
      console.error('Get user analytics error:', error);
      return { success: false, error: error.message };
    }
  }

  // Utility methods
  async getStats() {
    try {
      const [totalUsers, totalContent, totalQuizzes, totalProgress] = await Promise.all([
        User.countDocuments({ isActive: true }),
        Content.countDocuments({ isActive: true }),
        Quiz.countDocuments({ isActive: true }),
        Progress.countDocuments({ isActive: true })
      ]);

      return {
        success: true,
        data: {
          totalUsers,
          totalContent,
          totalQuizzes,
          totalProgress,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('Get stats error:', error);
      return { success: false, error: error.message };
    }
  }

  async cleanupInactiveData(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const result = await Promise.all([
        // Remove old inactive content
        Content.deleteMany({
          isActive: false,
          updatedAt: { $lt: cutoffDate }
        }),
        // Remove old inactive quizzes
        Quiz.deleteMany({
          isActive: false,
          updatedAt: { $lt: cutoffDate }
        }),
        // Remove old inactive progress
        Progress.deleteMany({
          isActive: false,
          updatedAt: { $lt: cutoffDate }
        })
      ]);

      return {
        success: true,
        data: {
          contentDeleted: result[0].deletedCount,
          quizzesDeleted: result[1].deletedCount,
          progressDeleted: result[2].deletedCount
        }
      };
    } catch (error) {
      console.error('Cleanup inactive data error:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new DatabaseService();
