const express = require('express');
const router = express.Router();
const { requireAuth, getOrCreateUser } = require('../middleware/auth');
const databaseService = require('../services/databaseService');
const Content = require('../models/Content');
const Quiz = require('../models/Quiz');
const Progress = require('../models/Progress');
const User = require('../models/User');

// Helper function to get date range
const getDateRange = (timeframe) => {
  const now = new Date();
  let startDate;
  
  switch (timeframe) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case '90d':
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case '1y':
      startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  
  return { startDate, endDate: now };
};

// Get comprehensive user analytics dashboard
router.get('/dashboard', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const user = req.user;
    const { timeframe = '30d' } = req.query;
    
    const { startDate, endDate } = getDateRange(timeframe);
    
    // Get all analytics data in parallel
    const [
      contentStats,
      quizStats,
      progressData,
      recentActivity,
      studyTimeData
    ] = await Promise.all([
      // Content statistics
      Content.aggregate([
        { 
          $match: { 
            clerkUserId: user.clerkUserId, 
            isActive: true 
          } 
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            categories: { 
              $push: '$category' 
            },
            totalViews: { 
              $sum: '$analytics.views' 
            },
            avgReadingTime: { 
              $avg: '$metadata.readingTime' 
            }
          }
        }
      ]),
      
      // Quiz statistics
      Quiz.aggregate([
        { 
          $match: { 
            clerkUserId: user.clerkUserId, 
            isActive: true 
          } 
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            totalQuestions: { $sum: { $size: '$questions' } },
            avgAttempts: { $avg: '$analytics.totalAttempts' },
            avgScore: { $avg: '$analytics.averageScore' }
          }
        }
      ]),
      
      // Progress data
      Progress.find({
        clerkUserId: user.clerkUserId,
        isActive: true,
        lastAccessed: { $gte: startDate, $lte: endDate }
      }).populate('contentId', 'title category')
        .populate('quizId', 'title difficulty'),
      
      // Recent activity
      Progress.find({
        clerkUserId: user.clerkUserId,
        isActive: true
      }).sort({ lastAccessed: -1 })
        .limit(10)
        .populate('contentId', 'title category')
        .populate('quizId', 'title difficulty'),
      
      // Study time trends
      Progress.aggregate([
        {
          $match: {
            clerkUserId: user.clerkUserId,
            isActive: true,
            lastAccessed: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$lastAccessed' } }
            },
            totalTime: {
              $sum: {
                $cond: {
                  if: { $eq: ['$progressType', 'content'] },
                  then: '$contentProgress.timeSpent',
                  else: '$quizProgress.totalTimeSpent'
                }
              }
            },
            sessionsCount: { $sum: 1 }
          }
        },
        { $sort: { '_id.date': 1 } }
      ])
    ]);

    // Process content stats
    const contentAnalytics = contentStats[0] || {
      total: 0,
      categories: [],
      totalViews: 0,
      avgReadingTime: 0
    };
    
    // Process quiz stats
    const quizAnalytics = quizStats[0] || {
      total: 0,
      totalQuestions: 0,
      avgAttempts: 0,
      avgScore: 0
    };

    // Process progress data
    const contentProgress = progressData.filter(p => p.progressType === 'content');
    const quizProgress = progressData.filter(p => p.progressType === 'quiz');
    
    const completedContent = contentProgress.filter(p => 
      p.contentProgress.status === 'completed'
    ).length;
    
    const passedQuizzes = quizProgress.filter(p => 
      p.quizProgress.isPassed
    ).length;

    // Calculate total study time
    const totalStudyTime = progressData.reduce((total, p) => {
      if (p.progressType === 'content') {
        return total + (p.contentProgress.timeSpent || 0);
      } else if (p.progressType === 'quiz') {
        return total + (p.quizProgress.totalTimeSpent || 0);
      }
      return total;
    }, 0);

    // Process categories
    const categoryStats = contentAnalytics.categories.reduce((acc, category) => {
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});

    // Calculate streaks and achievements
    const currentStreak = calculateStreak(recentActivity);
    
    const dashboard = {
      overview: {
        totalContent: contentAnalytics.total,
        completedContent,
        contentCompletionRate: contentAnalytics.total > 0 ? 
          Math.round((completedContent / contentAnalytics.total) * 100) : 0,
        totalQuizzes: quizAnalytics.total,
        passedQuizzes,
        quizPassRate: quizAnalytics.total > 0 ? 
          Math.round((passedQuizzes / quizAnalytics.total) * 100) : 0,
        totalStudyTime, // in minutes
        avgStudySession: progressData.length > 0 ? 
          Math.round(totalStudyTime / progressData.length) : 0
      },
      
      activity: {
        currentStreak,
        recentSessions: recentActivity.slice(0, 5).map(activity => ({
          type: activity.progressType,
          title: activity.contentId?.title || activity.quizId?.title,
          category: activity.contentId?.category,
          difficulty: activity.quizId?.difficulty,
          lastAccessed: activity.lastAccessed,
          progress: activity.progressType === 'content' ? 
            activity.contentProgress.percentageRead : 
            (activity.quizProgress.isPassed ? 100 : 0)
        })),
        studyTimeByDay: studyTimeData
      },
      
      performance: {
        averageQuizScore: Math.round(quizAnalytics.avgScore || 0),
        strongestCategories: Object.entries(categoryStats)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3)
          .map(([category, count]) => ({ category, count })),
        improvementAreas: getImprovementAreas(quizProgress)
      },
      
      insights: generateInsights(user, {
        contentAnalytics,
        quizAnalytics,
        totalStudyTime,
        currentStreak,
        completedContent,
        passedQuizzes
      })
    };

    res.json({
      success: true,
      data: dashboard,
      meta: {
        timeframe,
        generatedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Get dashboard analytics error:', error);
    next(error);
  }
});

// Get detailed learning progress
router.get('/progress', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const user = req.user;
    const { timeframe = '30d', type = 'all' } = req.query;
    
    const { startDate, endDate } = getDateRange(timeframe);
    
    const query = {
      clerkUserId: user.clerkUserId,
      isActive: true,
      lastAccessed: { $gte: startDate, $lte: endDate }
    };
    
    if (type !== 'all') {
      query.progressType = type;
    }
    
    const progressData = await Progress.find(query)
      .populate('contentId', 'title category difficulty')
      .populate('quizId', 'title category difficulty')
      .sort({ lastAccessed: -1 });
    
    const progressSummary = {
      totalSessions: progressData.length,
      contentSessions: progressData.filter(p => p.progressType === 'content').length,
      quizSessions: progressData.filter(p => p.progressType === 'quiz').length,
      totalTime: progressData.reduce((total, p) => {
        return total + (p.progressType === 'content' ? 
          p.contentProgress.timeSpent : p.quizProgress.totalTimeSpent);
      }, 0),
      dailyProgress: generateDailyProgress(progressData, startDate, endDate),
      sessions: progressData.map(p => ({
        id: p._id,
        type: p.progressType,
        title: p.contentId?.title || p.quizId?.title,
        category: p.contentId?.category || p.quizId?.category,
        progress: p.progressType === 'content' ? 
          p.contentProgress.percentageRead : 
          (p.quizProgress.isPassed ? 100 : 0),
        timeSpent: p.progressType === 'content' ? 
          p.contentProgress.timeSpent : p.quizProgress.totalTimeSpent,
        lastAccessed: p.lastAccessed,
        status: p.progressType === 'content' ? 
          p.contentProgress.status : 
          (p.quizProgress.isPassed ? 'passed' : 'attempted')
      }))
    };

    res.json({
      success: true,
      data: progressSummary
    });
    
  } catch (error) {
    console.error('Get learning progress error:', error);
    next(error);
  }
});

// Get quiz performance breakdown
router.get('/quiz-performance', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const user = req.user;
    const { category, timeframe = '30d', difficulty } = req.query;
    
    const { startDate, endDate } = getDateRange(timeframe);
    
    const matchQuery = {
      clerkUserId: user.clerkUserId,
      progressType: 'quiz',
      isActive: true,
      lastAccessed: { $gte: startDate, $lte: endDate }
    };
    
    const performance = await Progress.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: 'quizzes',
          localField: 'quizId',
          foreignField: '_id',
          as: 'quiz'
        }
      },
      { $unwind: '$quiz' },
      {
        $match: {
          ...(category && { 'quiz.category': category }),
          ...(difficulty && { 'quiz.difficulty': difficulty })
        }
      },
      {
        $group: {
          _id: '$quiz.category',
          totalAttempts: { $sum: '$quizProgress.totalAttempts' },
          averageScore: { $avg: '$quizProgress.averageScore' },
          bestScore: { $max: '$quizProgress.bestScore' },
          passedQuizzes: {
            $sum: { $cond: ['$quizProgress.isPassed', 1, 0] }
          },
          totalQuizzes: { $sum: 1 },
          totalTime: { $sum: '$quizProgress.totalTimeSpent' }
        }
      },
      {
        $project: {
          category: '$_id',
          totalAttempts: 1,
          averageScore: { $round: ['$averageScore', 1] },
          bestScore: { $round: ['$bestScore', 1] },
          passRate: {
            $round: [
              { $multiply: [{ $divide: ['$passedQuizzes', '$totalQuizzes'] }, 100] },
              1
            ]
          },
          avgTimePerQuiz: { $round: [{ $divide: ['$totalTime', '$totalQuizzes'] }, 1] }
        }
      },
      { $sort: { averageScore: -1 } }
    ]);

    res.json({
      success: true,
      data: performance
    });
    
  } catch (error) {
    console.error('Get quiz performance error:', error);
    next(error);
  }
});

// Get subject-wise analytics
router.get('/subjects', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const user = req.user;
    
    const subjectAnalytics = await Content.aggregate([
      {
        $match: {
          clerkUserId: user.clerkUserId,
          isActive: true
        }
      },
      {
        $group: {
          _id: '$category',
          contentCount: { $sum: 1 },
          totalViews: { $sum: '$analytics.views' },
          totalStudyTime: { $sum: '$analytics.totalStudyTime' },
          avgReadingTime: { $avg: '$metadata.readingTime' }
        }
      },
      {
        $lookup: {
          from: 'quizzes',
          let: { category: '$_id', userId: user.clerkUserId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$category', '$$category'] },
                    { $eq: ['$clerkUserId', '$$userId'] },
                    { $eq: ['$isActive', true] }
                  ]
                }
              }
            }
          ],
          as: 'quizzes'
        }
      },
      {
        $lookup: {
          from: 'progresses',
          let: { category: '$_id', userId: user.clerkUserId },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$clerkUserId', '$$userId'] },
                    { $eq: ['$progressType', 'quiz'] },
                    { $eq: ['$isActive', true] }
                  ]
                }
              }
            },
            {
              $lookup: {
                from: 'quizzes',
                localField: 'quizId',
                foreignField: '_id',
                as: 'quiz'
              }
            },
            { $unwind: '$quiz' },
            {
              $match: {
                'quiz.category': '$$category'
              }
            }
          ],
          as: 'quizProgress'
        }
      },
      {
        $project: {
          category: '$_id',
          content: {
            count: '$contentCount',
            totalViews: '$totalViews',
            totalStudyTime: '$totalStudyTime',
            avgReadingTime: { $round: ['$avgReadingTime', 1] }
          },
          quizzes: {
            count: { $size: '$quizzes' },
            totalAttempts: {
              $sum: '$quizProgress.quizProgress.totalAttempts'
            },
            averageScore: {
              $avg: '$quizProgress.quizProgress.averageScore'
            },
            passedCount: {
              $size: {
                $filter: {
                  input: '$quizProgress',
                  cond: '$$this.quizProgress.isPassed'
                }
              }
            }
          }
        }
      },
      {
        $addFields: {
          'quizzes.passRate': {
            $cond: {
              if: { $gt: ['$quizzes.count', 0] },
              then: {
                $round: [
                  { $multiply: [{ $divide: ['$quizzes.passedCount', '$quizzes.count'] }, 100] },
                  1
                ]
              },
              else: 0
            }
          }
        }
      },
      { $sort: { 'content.count': -1 } }
    ]);

    res.json({
      success: true,
      data: subjectAnalytics
    });
    
  } catch (error) {
    console.error('Get subject analytics error:', error);
    next(error);
  }
});

// Get learning streaks and achievements
router.get('/achievements', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const user = req.user;
    
    // Get recent activity for streak calculation
    const recentActivity = await Progress.find({
      clerkUserId: user.clerkUserId,
      isActive: true
    }).sort({ lastAccessed: -1 }).limit(30);
    
    // Calculate streaks
    const currentStreak = calculateStreak(recentActivity);
    const longestStreak = calculateLongestStreak(recentActivity);
    
    // Get totals for achievements
    const [totalContent, totalQuizzes, totalProgress] = await Promise.all([
      Content.countDocuments({ clerkUserId: user.clerkUserId, isActive: true }),
      Quiz.countDocuments({ clerkUserId: user.clerkUserId, isActive: true }),
      Progress.find({ clerkUserId: user.clerkUserId, isActive: true })
    ]);
    
    const completedContent = totalProgress.filter(p => 
      p.progressType === 'content' && p.contentProgress.status === 'completed'
    ).length;
    
    const passedQuizzes = totalProgress.filter(p => 
      p.progressType === 'quiz' && p.quizProgress.isPassed
    ).length;
    
    const totalStudyTime = totalProgress.reduce((total, p) => {
      return total + (p.progressType === 'content' ? 
        p.contentProgress.timeSpent : p.quizProgress.totalTimeSpent);
    }, 0);
    
    // Define achievements
    const achievements = [
      {
        id: 'first_content',
        title: 'First Steps',
        description: 'Uploaded your first learning content',
        earned: totalContent > 0,
        earnedAt: totalContent > 0 ? user.createdAt : null,
        icon: '📚'
      },
      {
        id: 'content_master',
        title: 'Content Master',
        description: 'Uploaded 10 learning contents',
        earned: totalContent >= 10,
        earnedAt: totalContent >= 10 ? user.updatedAt : null,
        icon: '🎓'
      },
      {
        id: 'quiz_creator',
        title: 'Quiz Creator',
        description: 'Generated your first quiz',
        earned: totalQuizzes > 0,
        earnedAt: totalQuizzes > 0 ? user.updatedAt : null,
        icon: '❓'
      },
      {
        id: 'dedicated_learner',
        title: 'Dedicated Learner',
        description: 'Study for 100 hours total',
        earned: totalStudyTime >= 6000, // 100 hours in minutes
        progress: Math.min(100, Math.round((totalStudyTime / 6000) * 100)),
        icon: '⏰'
      },
      {
        id: 'streak_master',
        title: 'Streak Master',
        description: 'Maintain a 7-day learning streak',
        earned: currentStreak >= 7,
        progress: Math.min(100, Math.round((currentStreak / 7) * 100)),
        icon: '🔥'
      },
      {
        id: 'perfectionist',
        title: 'Perfectionist',
        description: 'Score 100% on a quiz',
        earned: totalProgress.some(p => 
          p.progressType === 'quiz' && p.quizProgress.bestScore === 100
        ),
        icon: '💯'
      },
      {
        id: 'completionist',
        title: 'Completionist',
        description: 'Complete 50 pieces of content',
        earned: completedContent >= 50,
        progress: Math.min(100, Math.round((completedContent / 50) * 100)),
        icon: '✅'
      }
    ];
    
    const earnedAchievements = achievements.filter(a => a.earned);
    const nextAchievements = achievements
      .filter(a => !a.earned && a.progress !== undefined)
      .sort((a, b) => (b.progress || 0) - (a.progress || 0))
      .slice(0, 3);
    
    const streakData = {
      current: currentStreak,
      longest: longestStreak,
      daysActive: getDaysActive(recentActivity),
      weeklyGoal: 5, // Study 5 days per week
      weeklyProgress: Math.min(100, Math.round((getDaysActiveThisWeek(recentActivity) / 5) * 100))
    };
    
    res.json({
      success: true,
      data: {
        streaks: streakData,
        achievements: {
          earned: earnedAchievements,
          next: nextAchievements,
          total: achievements.length,
          earnedCount: earnedAchievements.length
        },
        milestones: {
          contentUploaded: totalContent,
          contentCompleted: completedContent,
          quizzesCreated: totalQuizzes,
          quizzesPassed: passedQuizzes,
          totalStudyHours: Math.round(totalStudyTime / 60)
        }
      }
    });
    
  } catch (error) {
    console.error('Get achievements error:', error);
    next(error);
  }
});

// Helper functions
function calculateStreak(activities) {
  if (!activities || activities.length === 0) return 0;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let streak = 0;
  let currentDate = new Date(today);
  
  for (let i = 0; i < 365; i++) { // Check up to a year
    const hasActivity = activities.some(activity => {
      const activityDate = new Date(activity.lastAccessed);
      activityDate.setHours(0, 0, 0, 0);
      return activityDate.getTime() === currentDate.getTime();
    });
    
    if (hasActivity) {
      streak++;
    } else {
      break;
    }
    
    currentDate.setDate(currentDate.getDate() - 1);
  }
  
  return streak;
}

function calculateLongestStreak(activities) {
  if (!activities || activities.length === 0) return 0;
  
  // Group activities by date
  const activeDates = [...new Set(activities.map(a => {
    const date = new Date(a.lastAccessed);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }))].sort((a, b) => b - a);
  
  let longestStreak = 0;
  let currentStreak = 0;
  
  for (let i = 0; i < activeDates.length; i++) {
    if (i === 0) {
      currentStreak = 1;
    } else {
      const dayDiff = (activeDates[i - 1] - activeDates[i]) / (1000 * 60 * 60 * 24);
      if (dayDiff === 1) {
        currentStreak++;
      } else {
        longestStreak = Math.max(longestStreak, currentStreak);
        currentStreak = 1;
      }
    }
  }
  
  return Math.max(longestStreak, currentStreak);
}

function getDaysActive(activities) {
  if (!activities || activities.length === 0) return 0;
  
  const uniqueDates = new Set(activities.map(a => {
    const date = new Date(a.lastAccessed);
    return date.toDateString();
  }));
  
  return uniqueDates.size;
}

function getDaysActiveThisWeek(activities) {
  const now = new Date();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  
  const thisWeekActivities = activities.filter(a => 
    new Date(a.lastAccessed) >= startOfWeek
  );
  
  return getDaysActive(thisWeekActivities);
}

function generateDailyProgress(progressData, startDate, endDate) {
  const dailyData = {};
  
  // Initialize all dates with 0
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    dailyData[dateStr] = { time: 0, sessions: 0 };
  }
  
  // Populate with actual data
  progressData.forEach(p => {
    const dateStr = p.lastAccessed.toISOString().split('T')[0];
    if (dailyData[dateStr]) {
      dailyData[dateStr].sessions++;
      dailyData[dateStr].time += p.progressType === 'content' ? 
        p.contentProgress.timeSpent : p.quizProgress.totalTimeSpent;
    }
  });
  
  return Object.entries(dailyData).map(([date, data]) => ({
    date,
    ...data
  }));
}

function getImprovementAreas(quizProgress) {
  // Analyze quiz performance to suggest improvement areas
  const categoryPerformance = {};
  
  quizProgress.forEach(p => {
    if (p.quizId?.category) {
      if (!categoryPerformance[p.quizId.category]) {
        categoryPerformance[p.quizId.category] = { 
          scores: [], 
          attempts: 0 
        };
      }
      categoryPerformance[p.quizId.category].scores.push(p.quizProgress.bestScore);
      categoryPerformance[p.quizId.category].attempts += p.quizProgress.totalAttempts;
    }
  });
  
  return Object.entries(categoryPerformance)
    .map(([category, data]) => ({
      category,
      avgScore: data.scores.reduce((a, b) => a + b, 0) / data.scores.length,
      totalAttempts: data.attempts
    }))
    .filter(item => item.avgScore < 70) // Below passing grade
    .sort((a, b) => a.avgScore - b.avgScore)
    .slice(0, 3);
}

function generateInsights(user, analytics) {
  const insights = [];
  
  // Study time insight
  if (analytics.totalStudyTime > 0) {
    const dailyAvg = analytics.totalStudyTime / 30;
    if (dailyAvg < 15) {
      insights.push({
        type: 'suggestion',
        title: 'Increase Study Time',
        message: `You're averaging ${Math.round(dailyAvg)} minutes per day. Try to reach 30 minutes daily for better retention.`,
        actionable: true
      });
    } else if (dailyAvg > 60) {
      insights.push({
        type: 'achievement',
        title: 'Dedicated Learner',
        message: `Great job! You're studying ${Math.round(dailyAvg)} minutes daily on average.`,
        actionable: false
      });
    }
  }
  
  // Quiz performance insight
  if (analytics.quizAnalytics.avgScore > 0) {
    if (analytics.quizAnalytics.avgScore < 70) {
      insights.push({
        type: 'warning',
        title: 'Quiz Performance',
        message: 'Your quiz scores are below 70%. Consider reviewing content more thoroughly before taking quizzes.',
        actionable: true
      });
    } else if (analytics.quizAnalytics.avgScore > 90) {
      insights.push({
        type: 'achievement',
        title: 'Quiz Master',
        message: `Excellent! Your average quiz score is ${Math.round(analytics.quizAnalytics.avgScore)}%.`,
        actionable: false
      });
    }
  }
  
  // Content completion insight
  if (analytics.contentAnalytics.total > 0) {
    const completionRate = (analytics.completedContent / analytics.contentAnalytics.total) * 100;
    if (completionRate < 50) {
      insights.push({
        type: 'suggestion',
        title: 'Content Completion',
        message: `You've completed ${Math.round(completionRate)}% of your content. Set a goal to finish more materials.`,
        actionable: true
      });
    }
  }
  
  // Streak insight
  if (analytics.currentStreak === 0) {
    insights.push({
      type: 'motivation',
      title: 'Start Your Streak',
      message: 'Begin a learning streak today! Consistent daily practice leads to better results.',
      actionable: true
    });
  } else if (analytics.currentStreak >= 7) {
    insights.push({
      type: 'achievement',
      title: 'Streak Master',
      message: `Amazing! You've maintained a ${analytics.currentStreak}-day learning streak.`,
      actionable: false
    });
  }
  
  return insights.slice(0, 4); // Return top 4 insights
}

module.exports = router;
