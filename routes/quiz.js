const express = require('express');
const router = express.Router();
const { requireAuth, getOrCreateUser } = require('../middleware/auth');
const geminiService = require('../services/geminiService');
const Content = require('../models/Content');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const User = require('../models/User');

// Get all quizzes for the authenticated user
router.get('/all', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { clerkUserId, _id: userId } = req.user;
    const { page = 1, limit = 10, status = 'all' } = req.query;

    // Build query
    const query = {
      $or: [
        { userId: userId },
        { clerkUserId: clerkUserId }
      ]
    };

    // Filter by status if specified
    if (status !== 'all') {
      query.status = status;
    }

    // Get total count
    const totalQuizzes = await Quiz.countDocuments(query);

    // Get quizzes with pagination
    const quizzes = await Quiz.find(query)
      .populate('contentId', 'title category fileName uploadDate')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    // Get quiz attempts for each quiz to show completion status
    const quizzesWithAttempts = await Promise.all(
      quizzes.map(async (quiz) => {
        const attempts = await QuizAttempt.find({
          quizId: quiz._id,
          userId: userId,
          status: 'completed'
        })
        .sort({ completedAt: -1 })
        .limit(5)
        .lean();

        const bestAttempt = attempts.length > 0 
          ? attempts.reduce((best, current) => current.score > best.score ? current : best)
          : null;

        const latestAttempt = attempts.length > 0 ? attempts[0] : null;

        return {
          ...quiz,
          totalAttempts: attempts.length,
          bestScore: bestAttempt?.score || 0,
          latestScore: latestAttempt?.score || null,
          latestAttemptDate: latestAttempt?.completedAt || null,
          hasAttempts: attempts.length > 0,
          isPassed: bestAttempt ? bestAttempt.passed : false,
          questionCount: quiz.questions?.length || 0
        };
      })
    );

    res.json({
      success: true,
      data: {
        quizzes: quizzesWithAttempts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalQuizzes / limit),
          totalQuizzes,
          hasNextPage: page * limit < totalQuizzes,
          hasPrevPage: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Get all quizzes error:', error);
    next(error);
  }
});

// Generate quiz from content
router.post('/generate', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { contentId, questionsPerSection = 3 } = req.body;
    const { clerkUserId, _id: userId } = req.user;

    // Get the content with AI summary
    const content = await Content.findOne({ 
      _id: contentId, 
      $or: [
        { userId: userId },
        { clerkUserId: clerkUserId }
      ]
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
        error: 'CONTENT_NOT_FOUND'
      });
    }

    // Check if content has been processed
    if (!content.aiSummary || !content.aiSummary.sections) {
      return res.status(400).json({
        success: false,
        message: 'Content must be fully processed before quiz generation',
        error: 'CONTENT_NOT_PROCESSED'
      });
    }

    // Check if quiz already exists for this content and user
    let existingQuiz = await Quiz.findOne({ 
      contentId: contentId, 
      userId: userId,
      isActive: true 
    });

    if (existingQuiz) {
      return res.json({
        success: true,
        message: 'Quiz already exists for this content',
        data: existingQuiz,
        isExisting: true
      });
    }

    // Generate quiz using AI
    const quizData = await geminiService.generateQuiz(
      content, 
      content.aiSummary.sections,
      { questionsPerSection }
    );

    // Transform questions to match our schema
    const transformedQuestions = quizData.questions.map(q => ({
      question: q.question,
      type: q.type,
      sectionTitle: q.sectionTitle,
      options: q.type === 'multiple-choice' ? 
        q.options.map((opt, idx) => ({
          text: opt,
          isCorrect: opt === q.correctAnswer
        })) : [],
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      points: q.points || 1,
      difficulty: q.difficulty || 'medium'
    }));

    // Create quiz document
    const quiz = new Quiz({
      contentId: content._id,
      userId: userId,
      clerkUserId: clerkUserId,
      title: quizData.title,
      description: quizData.description,
      difficulty: content.aiSummary.difficulty || 'intermediate',
      category: content.category,
      questions: transformedQuestions,
      settings: {
        timeLimit: parseInt(quizData.estimatedTime) || 30,
        randomizeQuestions: true,
        randomizeOptions: true,
        showCorrectAnswer: true,
        allowRetakes: true,
        maxAttempts: 3,
        passingScore: 70
      },
      status: 'published'
    });

    await quiz.save();

    // Update content to mark it has a quiz
    content.quizHistory.hasQuiz = true;
    content.quizHistory.quizId = quiz._id;
    await content.save();

    res.json({
      success: true,
      message: 'Quiz generated successfully',
      data: quiz,
      isExisting: false
    });
  } catch (error) {
    console.error('Generate quiz error:', error);
    next(error);
  }
});

// Generate quiz from topic (custom quiz)
router.post('/generate-from-topic', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { topic, description, difficulty = 'medium', numQuestions = 5 } = req.body;
    const { clerkUserId, _id: userId } = req.user;

    if (!topic || !topic.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Topic is required',
        error: 'TOPIC_REQUIRED'
      });
    }

    // Generate quiz using AI based on topic
    const quizData = await geminiService.generateQuizFromTopic({
      topic: topic.trim(),
      description: description || '',
      difficulty,
      numQuestions
    });

    // Transform questions to match our schema
    const transformedQuestions = quizData.questions.map(q => ({
      question: q.question,
      type: q.type,
      sectionTitle: q.sectionTitle || topic,
      options: q.type === 'multiple-choice' ? 
        q.options.map((opt, idx) => ({
          text: opt,
          isCorrect: opt === q.correctAnswer
        })) : [],
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      points: q.points || 1,
      difficulty: q.difficulty || difficulty
    }));

    // Create quiz document
    const quiz = new Quiz({
      userId: userId,
      clerkUserId: clerkUserId,
      title: quizData.title || `${topic} Quiz`,
      description: quizData.description || `A custom quiz on ${topic}`,
      difficulty: difficulty,
      category: 'custom',
      questions: transformedQuestions,
      settings: {
        timeLimit: parseInt(quizData.estimatedTime) || 20,
        randomizeQuestions: true,
        randomizeOptions: true,
        showCorrectAnswer: true,
        allowRetakes: true,
        maxAttempts: 5,
        passingScore: 70
      },
      status: 'published',
      isCustom: true,
      customTopic: topic
    });

    await quiz.save();

    res.json({
      success: true,
      message: 'Custom quiz generated successfully',
      data: quiz
    });
  } catch (error) {
    console.error('Generate custom quiz error:', error);
    next(error);
  }
});

// Get quiz by content ID
router.get('/content/:contentId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { contentId } = req.params;
    const { clerkUserId, _id: userId } = req.user;

    const quiz = await Quiz.findOne({ 
      contentId: contentId, 
      userId: userId,
      isActive: true 
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'No quiz found for this content',
        error: 'QUIZ_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Quiz retrieved successfully',
      data: quiz
    });
  } catch (error) {
    console.error('Get quiz error:', error);
    next(error);
  }
});

// Get quiz by quiz ID (for custom quizzes)
router.get('/:quizId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { quizId } = req.params;
    const { clerkUserId, _id: userId } = req.user;

    const quiz = await Quiz.findOne({ 
      _id: quizId, 
      userId: userId,
      isActive: true 
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
        error: 'QUIZ_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Quiz retrieved successfully',
      data: quiz
    });
  } catch (error) {
    console.error('Get quiz by ID error:', error);
    next(error);
  }
});

// Get quiz attempts by quiz ID
router.get('/:quizId/attempts', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { quizId } = req.params;
    const { clerkUserId, _id: userId } = req.user;

    // Verify quiz exists and user has access
    const quiz = await Quiz.findOne({
      _id: quizId,
      $or: [
        { userId: userId },
        { clerkUserId: clerkUserId }
      ]
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
        error: 'QUIZ_NOT_FOUND'
      });
    }

    // Get all completed attempts for this quiz
    const attempts = await QuizAttempt.find({
      quizId: quizId,
      userId: userId,
      status: 'completed'
    })
    .sort({ completedAt: -1 })
    .lean();

    res.json({
      success: true,
      data: attempts
    });
  } catch (error) {
    console.error('Get quiz attempts error:', error);
    next(error);
  }
});

// Start quiz attempt
router.post('/:quizId/attempt', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { quizId } = req.params;
    const { clerkUserId, _id: userId } = req.user;

    console.log('Starting quiz attempt:', {
      quizId,
      userId: userId?.toString(),
      clerkUserId
    });

    // Get the quiz - for custom quizzes, we need to be more flexible
    let quiz = await Quiz.findOne({ 
      _id: quizId, 
      userId: userId,
      isActive: true 
    });

    // If not found with userId, try with clerkUserId for custom quizzes
    if (!quiz) {
      quiz = await Quiz.findOne({ 
        _id: quizId, 
        clerkUserId: clerkUserId,
        isActive: true 
      });
    }

    // If still not found, try without user restriction (for custom quizzes that might be shareable)
    if (!quiz) {
      quiz = await Quiz.findOne({ 
        _id: quizId, 
        isActive: true 
      });
      
      console.log('Quiz found without user restriction:', quiz ? 'yes' : 'no');
      if (quiz) {
        console.log('Quiz userId:', quiz.userId?.toString());
        console.log('Current userId:', userId?.toString());
      }
    }

    if (!quiz) {
      console.log('Quiz not found for quizId:', quizId);
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
        error: 'QUIZ_NOT_FOUND'
      });
    }

    console.log('Quiz found:', {
      quizId: quiz._id,
      quizUserId: quiz.userId?.toString(),
      isCustom: quiz.isCustom
    });

    // Check for existing in-progress attempt first
    let existingInProgressAttempt = await QuizAttempt.findOne({
      quizId: quizId,
      userId: userId,
      status: 'in-progress'
    });

    if (existingInProgressAttempt) {
      console.log('Found existing in-progress attempt:', existingInProgressAttempt._id);
      // Return the existing attempt instead of creating a new one
      return res.json({
        success: true,
        message: 'Quiz attempt resumed',
        data: {
          attemptId: existingInProgressAttempt._id,
          quiz: quiz,
          attemptNumber: existingInProgressAttempt.attemptNumber,
          maxAttempts: quiz.settings.maxAttempts,
          timeLimit: quiz.settings.timeLimit,
          isResumed: true
        }
      });
    }

    // Check if user can take the quiz (attempt limits for completed attempts)
    const completedAttempts = await QuizAttempt.countDocuments({
      quizId: quizId,
      userId: userId,
      status: 'completed'
    });

    if (completedAttempts >= quiz.settings.maxAttempts) {
      return res.status(400).json({
        success: false,
        message: `Maximum attempts (${quiz.settings.maxAttempts}) reached`,
        error: 'MAX_ATTEMPTS_REACHED'
      });
    }

    // Get total attempts count for attempt numbering
    const totalAttempts = await QuizAttempt.countDocuments({
      quizId: quizId,
      userId: userId
    });

    // Create new attempt using findOneAndUpdate with upsert to handle race conditions
    const attemptData = {
      quizId: quiz._id,
      contentId: quiz.contentId || null, // Handle custom quizzes without contentId
      userId: userId,
      clerkUserId: clerkUserId,
      attemptNumber: totalAttempts + 1,
      maxPoints: quiz.totalPoints,
      startedAt: new Date(),
      status: 'in-progress'
    };

    try {
      // Use findOneAndUpdate with upsert to prevent duplicate key errors
      const attempt = await QuizAttempt.findOneAndUpdate(
        {
          quizId: quiz._id,
          userId: userId,
          status: 'in-progress'
        },
        attemptData,
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );

      console.log('Created/found attempt:', attempt._id);

      res.json({
        success: true,
        message: 'Quiz attempt started',
        data: {
          attemptId: attempt._id,
          quiz: quiz,
          attemptNumber: attempt.attemptNumber,
          maxAttempts: quiz.settings.maxAttempts,
          timeLimit: quiz.settings.timeLimit
        }
      });
    } catch (duplicateError) {
      console.error('Duplicate key error, trying to find existing attempt:', duplicateError);
      
      // If we still get a duplicate error, find the existing attempt
      const existingAttempt = await QuizAttempt.findOne({
        quizId: quizId,
        userId: userId,
        status: 'in-progress'
      });

      if (existingAttempt) {
        return res.json({
          success: true,
          message: 'Quiz attempt resumed',
          data: {
            attemptId: existingAttempt._id,
            quiz: quiz,
            attemptNumber: existingAttempt.attemptNumber,
            maxAttempts: quiz.settings.maxAttempts,
            timeLimit: quiz.settings.timeLimit,
            isResumed: true
          }
        });
      }

      throw duplicateError; // Re-throw if we can't handle it
    }
  } catch (error) {
    console.error('Start quiz attempt error:', error);
    next(error);
  }
});

// Submit quiz attempt
router.post('/attempt/:attemptId/submit', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const { answers } = req.body; // Array of { questionId, userAnswer }
    const { clerkUserId, _id: userId } = req.user;

    // Get the attempt
    const attempt = await QuizAttempt.findOne({ 
      _id: attemptId, 
      userId: userId,
      status: 'in-progress'
    });

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'Quiz attempt not found or already completed',
        error: 'ATTEMPT_NOT_FOUND'
      });
    }

    // Get the quiz to validate answers
    const quiz = await Quiz.findById(attempt.quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found',
        error: 'QUIZ_NOT_FOUND'
      });
    }

    // Process answers
    const processedAnswers = answers.map(answer => {
      const question = quiz.questions.id(answer.questionId);
      if (!question) {
        throw new Error(`Question not found: ${answer.questionId}`);
      }

      let isCorrect = false;
      let points = 0;

      if (question.type === 'multiple-choice') {
        const correctOption = question.options.find(opt => opt.isCorrect);
        isCorrect = correctOption && correctOption.text === answer.userAnswer;
      } else if (question.type === 'true-false') {
        isCorrect = question.correctAnswer.toLowerCase() === answer.userAnswer.toLowerCase();
      }

      if (isCorrect) {
        points = question.points;
      }

      return {
        questionId: answer.questionId,
        sectionTitle: question.sectionTitle,
        userAnswer: answer.userAnswer,
        isCorrect: isCorrect,
        points: points,
        timeSpent: answer.timeSpent || 0
      };
    });

    // Update attempt with answers
    attempt.answers = processedAnswers;
    attempt.status = 'completed';
    attempt.completedAt = new Date();
    attempt.timeSpent = Math.round((attempt.completedAt - attempt.startedAt) / (1000 * 60));
    
    // Calculate total score
    const totalPoints = processedAnswers.reduce((sum, answer) => sum + answer.points, 0);
    const maxPoints = quiz.questions.reduce((sum, q) => sum + q.points, 0);
    attempt.score = Math.round((totalPoints / maxPoints) * 100);
    
    console.log('Quiz scoring:', {
      totalPoints,
      maxPoints,
      score: attempt.score,
      answers: processedAnswers.length
    });
    
    // Calculate section scores
    const sectionScores = {};
    processedAnswers.forEach(answer => {
      if (!sectionScores[answer.sectionTitle]) {
        sectionScores[answer.sectionTitle] = {
          total: 0,
          correct: 0
        };
      }
      sectionScores[answer.sectionTitle].total++;
      if (answer.isCorrect) {
        sectionScores[answer.sectionTitle].correct++;
      }
    });

    attempt.sectionScores = Object.keys(sectionScores).map(sectionTitle => ({
      sectionTitle,
      score: Math.round((sectionScores[sectionTitle].correct / sectionScores[sectionTitle].total) * 100),
      totalQuestions: sectionScores[sectionTitle].total,
      correctAnswers: sectionScores[sectionTitle].correct
    }));

    // Determine if passed
    attempt.passed = attempt.score >= quiz.settings.passingScore;

    await attempt.save();

    // Update quiz analytics
    quiz.analytics.totalAttempts = (quiz.analytics.totalAttempts || 0) + 1;
    quiz.analytics.lastTaken = new Date();

    // Update average score
    const allCompletedAttempts = await QuizAttempt.find({
      quizId: quiz._id,
      status: 'completed'
    }).select('score');
    
    if (allCompletedAttempts.length > 0) {
      quiz.analytics.averageScore = Math.round(
        allCompletedAttempts.reduce((sum, att) => sum + att.score, 0) / allCompletedAttempts.length
      );
      quiz.analytics.bestScore = Math.max(...allCompletedAttempts.map(att => att.score));
      quiz.analytics.passRate = Math.round(
        (allCompletedAttempts.filter(att => att.passed).length / allCompletedAttempts.length) * 100
      );
    }

    await quiz.save();

    // Update user streak for quiz completion
    try {
      await updateUserStreak(userId);
    } catch (error) {
      console.error('Failed to update user streak:', error);
      // Don't fail the submission if streak update fails
    }

    // Generate AI-powered quiz performance summary
    let quizSummary = null;
    try {
      quizSummary = await geminiService.generateQuizSummary(quiz, attempt);
      
      // Save summary to the attempt
      attempt.aiSummary = quizSummary;
      await attempt.save();
      
      console.log('Generated quiz performance summary:', quizSummary);
    } catch (error) {
      console.error('Failed to generate quiz summary:', error);
      // Don't fail the submission if summary generation fails
    }

    // Update content quiz history
    const content = await Content.findById(quiz.contentId);
    if (content) {
      // Update quiz history
      content.quizHistory.totalAttempts += 1;
      content.quizHistory.lastAttempt = new Date();
      
      // Update best score
      if (attempt.score > content.quizHistory.bestScore) {
        content.quizHistory.bestScore = attempt.score;
      }
      
      // Update passed status
      if (attempt.passed && !content.quizHistory.isPassed) {
        content.quizHistory.isPassed = true;
      }

      // Add attempt to history
      content.quizHistory.attempts.push({
        attemptId: attempt._id,
        score: attempt.score,
        passed: attempt.passed,
        completedAt: attempt.completedAt
      });

      // Keep only last 10 attempts to avoid too much data
      if (content.quizHistory.attempts.length > 10) {
        content.quizHistory.attempts = content.quizHistory.attempts.slice(-10);
      }

      await content.save();
    }

    // Debug logging for correct answers
    console.log('=== QUIZ SUBMISSION DEBUG ===');
    console.log('Attempt answers:', attempt.answers.length);
    console.log('Correct answers (calculated):', attempt.answers.filter(a => a.isCorrect).length);
    console.log('Correct answers (virtual):', attempt.correctAnswers);
    console.log('Score:', attempt.score);
    console.log('============================');

    res.json({
      success: true,
      message: 'Quiz submitted successfully',
      data: {
        attempt: attempt,
        passed: attempt.passed,
        score: attempt.score,
        correctAnswers: attempt.correctAnswers, // Add this explicitly
        totalQuestions: attempt.totalQuestions, // Add this too for consistency
        sectionScores: attempt.sectionScores,
        aiSummary: quizSummary,
        canRetake: quiz.settings.allowRetakes && attempt.attemptNumber < quiz.settings.maxAttempts
      }
    });
  } catch (error) {
    console.error('Submit quiz attempt error:', error);
    next(error);
  }
});

// Get user's quiz attempts for a content
router.get('/content/:contentId/attempts', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { contentId } = req.params;
    const { clerkUserId, _id: userId } = req.user;

    const attempts = await QuizAttempt.find({
      contentId: contentId,
      userId: userId,
      status: 'completed'
    }).sort({ attemptNumber: -1 });

    res.json({
      success: true,
      message: 'Quiz attempts retrieved successfully',
      data: attempts
    });
  } catch (error) {
    console.error('Get quiz attempts error:', error);
    next(error);
  }
});

// Get specific quiz attempt details
router.get('/attempt/:attemptId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { attemptId } = req.params;
    const { clerkUserId, _id: userId } = req.user;

    const attempt = await QuizAttempt.findOne({
      _id: attemptId,
      userId: userId
    }).populate('quizId', 'title questions');

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'Quiz attempt not found',
        error: 'ATTEMPT_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Quiz attempt retrieved successfully',
      data: attempt
    });
  } catch (error) {
    console.error('Get quiz attempt error:', error);
    next(error);
  }
});

// Get quiz results for dashboard
router.get('/results/:contentId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { contentId } = req.params;
    const { clerkUserId, _id: userId } = req.user;

    // Get content with quiz history
    const content = await Content.findOne({
      _id: contentId,
      $or: [
        { userId: userId },
        { clerkUserId: clerkUserId }
      ]
    }).populate('quizHistory.quizId', 'title description difficulty settings')
      .populate('quizHistory.attempts.attemptId', 'score passed completedAt sectionScores');

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
        error: 'CONTENT_NOT_FOUND'
      });
    }

    if (!content.quizHistory.hasQuiz) {
      return res.status(404).json({
        success: false,
        message: 'No quiz found for this content',
        error: 'QUIZ_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Quiz results retrieved successfully',
      data: {
        contentId: content._id,
        contentTitle: content.title,
        quizHistory: content.quizHistory,
        canTakeQuiz: content.quizHistory.totalAttempts < (content.quizHistory.quizId?.settings?.maxAttempts || 3)
      }
    });
  } catch (error) {
    console.error('Get quiz results error:', error);
    next(error);
  }
});

// Helper function to update user streak
async function updateUserStreak(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const lastActivity = user.profile.streak.lastActivity;
    let currentStreak = user.profile.streak.current || 0;
    let longestStreak = user.profile.streak.longest || 0;

    if (!lastActivity) {
      // First activity ever
      currentStreak = 1;
    } else {
      const lastActivityDate = new Date(lastActivity);
      lastActivityDate.setHours(0, 0, 0, 0);
      
      const daysDifference = Math.floor((today - lastActivityDate) / (1000 * 60 * 60 * 24));
      
      if (daysDifference === 0) {
        // Same day, don't increment streak
        return;
      } else if (daysDifference === 1) {
        // Consecutive day, increment streak
        currentStreak += 1;
      } else {
        // Streak broken, start over
        currentStreak = 1;
      }
    }

    // Update longest streak if current is longer
    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
    }

    // Update user streak data
    await User.findByIdAndUpdate(userId, {
      'profile.streak.current': currentStreak,
      'profile.streak.longest': longestStreak,
      'profile.streak.lastActivity': new Date()
    });

    console.log(`Updated user streak: current=${currentStreak}, longest=${longestStreak}`);
  } catch (error) {
    console.error('Error updating user streak:', error);
    throw error;
  }
}

module.exports = router;
