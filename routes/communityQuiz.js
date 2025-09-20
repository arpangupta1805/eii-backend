const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { validate, schemas } = require('../middleware/validation');
const { requireAuth, getOrCreateUser, requireUsername } = require('../middleware/auth');
const CommunityQuiz = require('../models/CommunityQuiz');
const CommunityQuizAttempt = require('../models/CommunityQuizAttempt');
const CommunityMember = require('../models/CommunityMember');
const CommunityContent = require('../models/CommunityContent');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

console.log('🔧 Community Quiz routes loaded');

// Debug middleware to log all requests
router.use((req, res, next) => {
  console.log(`📡 Community Quiz Route: ${req.method} ${req.path}`);
  console.log(`📊 Params:`, req.params);
  next();
});

// Get community quizzes
router.get('/:communityId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId } = req.params;
    const { page = 1, limit = 10, type = 'public', difficulty, category } = req.query;
    const { _id: userId } = req.user;

    // Check if user is a member of this community
    const membership = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to view community quizzes'
      });
    }

    // Build query
    const query = { 
      communityId, 
      status: 'published', 
      isActive: true 
    };
    
    if (type === 'public') {
      query.type = 'public';
    } else if (type === 'private') {
      query.type = 'private';
      // Only show private quizzes user has access to
      query.$or = [
        { userId }, // Created by user
        { allowedUsers: userId } // User is in allowed list
      ];
    }
    
    if (difficulty) query.difficulty = difficulty;
    if (category) query.category = category;

    const skip = (page - 1) * limit;
    const quizzes = await CommunityQuiz.find(query)
      .populate('userId', 'firstName lastName username profileImage')
      .populate('communityContentId', 'title category')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CommunityQuiz.countDocuments(query);

    res.json({
      success: true,
      data: {
        quizzes,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get community quizzes error:', error);
    next(error);
  }
});

// TEST ROUTE - Simple route to verify registration
router.post('/:communityId/test-route', (req, res) => {
  console.log('🧪 TEST ROUTE HIT!');
  res.json({ message: 'Test route working', params: req.params });
});

// Create quiz from community content
router.post('/:communityId/create-from-content/:contentId', requireAuth, getOrCreateUser, requireUsername, async (req, res, next) => {
  try {
    const { communityId, contentId } = req.params;
    const { 
      title, 
      description, 
      difficulty = 'intermediate', 
      questionCount = 10,
      type = 'public',
      timeLimit = 30 
    } = req.body;
    const { _id: userId, clerkUserId } = req.user;

    console.log('🚀 Creating quiz from content with params:', {
      communityId,
      contentId,
      title,
      difficulty,
      questionCount,
      type,
      timeLimit,
      userId
    });

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(communityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid community ID format'
      });
    }
    
    if (!mongoose.Types.ObjectId.isValid(contentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content ID format'
      });
    }

    // Check if user is a member of this community
    const membership = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to create quizzes'
      });
    }

    // Get the community content
    const content = await CommunityContent.findOne({
      _id: contentId,
      communityId,
      status: 'approved',
      isActive: true
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Community content not found'
      });
    }

    // Generate questions using Gemini AI
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Generate ${questionCount} multiple choice questions based on the following content. 
    Make them ${difficulty} level difficulty.
    
    Content:
    ${content.originalText}
    
    Return the response in the following JSON format:
    {
      "questions": [
        {
          "question": "Question text here",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": 0,
          "explanation": "Explanation for the correct answer",
          "difficulty": "easy|medium|hard",
          "points": 1
        }
      ]
    }`;

    console.log('Generating quiz with prompt for content:', content._id);
    console.log('Content text length:', content.originalText.length);
    
    let questionsData;
    try {
      const result = await model.generateContent(prompt);
      const response = result.response;
      const responseText = response.text();
      console.log('AI Response received:', responseText.substring(0, 500) + '...');
      
      const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
      questionsData = JSON.parse(cleanedText);
      console.log('Questions parsed successfully, count:', questionsData.questions?.length);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      console.error('Raw AI response:', response?.text?.());
      return res.status(500).json({
        success: false,
        message: 'Failed to generate questions from AI response',
        error: parseError.message
      });
    }

    // Create the quiz with proper access control for private quizzes
    const quizData = {
      userId,
      clerkUserId,
      communityId,
      communityContentId: contentId,
      title,
      description,
      difficulty,
      category: content.category,
      type,
      questions: questionsData.questions,
      timeLimit,
      maxAttempts: 3,
      status: 'published',
      isActive: true
    };

    // For private quizzes, generate an access code and allow all community members initially
    if (type === 'private') {
      quizData.accessCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      // For community private quizzes, allow all active community members
      const communityMembers = await CommunityMember.find({ 
        communityId, 
        isActive: true 
      }).select('userId');
      quizData.allowedUsers = communityMembers.map(member => member.userId);
    }

    const quiz = new CommunityQuiz(quizData);
    await quiz.save();

    // Update member stats
    await CommunityMember.findOneAndUpdate(
      { userId, communityId },
      { $inc: { 'stats.quizzesCreated': 1 } }
    );

    console.log('✅ Quiz created successfully:', quiz._id, 'Type:', quiz.type);

    res.json({
      success: true,
      message: 'Quiz created successfully',
      data: {
        quiz,
        accessCode: quiz.accessCode // Include access code for private quizzes
      }
    });
  } catch (error) {
    console.error('Create community quiz error:', error);
    next(error);
  }
});

// Create custom quiz
router.post('/:communityId/create-custom', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId } = req.params;
    const { 
      title, 
      description, 
      customTopic,
      difficulty = 'intermediate', 
      questionCount = 10,
      type = 'public',
      timeLimit = 30 
    } = req.body;
    const { _id: userId, clerkUserId } = req.user;

    // Check if user is a member of this community
    const membership = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to create quizzes'
      });
    }

    // Generate questions using Gemini AI
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Generate ${questionCount} multiple choice questions about: ${customTopic}
    Make them ${difficulty} level difficulty.
    
    Return the response in the following JSON format:
    {
      "questions": [
        {
          "question": "Question text here",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": 0,
          "explanation": "Explanation for the correct answer",
          "difficulty": "easy|medium|hard",
          "points": 1
        }
      ]
    }`;

    console.log('Generating custom quiz for topic:', customTopic);
    
    let questionsData;
    try {
      const result = await model.generateContent(prompt);
      const response = result.response;
      const responseText = response.text();
      console.log('AI Response received for custom quiz:', responseText.substring(0, 500) + '...');
      
      const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
      questionsData = JSON.parse(cleanedText);
      console.log('Custom quiz questions parsed successfully, count:', questionsData.questions?.length);
    } catch (parseError) {
      console.error('Failed to parse AI response for custom quiz:', parseError);
      console.error('Raw AI response:', response?.text?.());
      return res.status(500).json({
        success: false,
        message: 'Failed to generate custom quiz questions from AI response',
        error: parseError.message
      });
    }

    // Create the quiz with proper access control for private quizzes
    const quizData = {
      userId,
      clerkUserId,
      communityId,
      title,
      description,
      difficulty,
      category: 'custom',
      isCustom: true,
      customTopic,
      type,
      questions: questionsData.questions,
      timeLimit,
      maxAttempts: 3,
      status: 'published',
      isActive: true
    };

    // For private quizzes, generate an access code and allow all community members initially
    if (type === 'private') {
      quizData.accessCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      // For community private quizzes, allow all active community members
      const communityMembers = await CommunityMember.find({ 
        communityId, 
        isActive: true 
      }).select('userId');
      quizData.allowedUsers = communityMembers.map(member => member.userId);
    }

    const quiz = new CommunityQuiz(quizData);
    await quiz.save();

    // Update member stats
    await CommunityMember.findOneAndUpdate(
      { userId, communityId },
      { $inc: { 'stats.quizzesCreated': 1 } }
    );

    console.log('✅ Custom quiz created successfully:', quiz._id, 'Type:', quiz.type);

    res.json({
      success: true,
      message: 'Custom quiz created successfully',
      data: {
        quiz,
        accessCode: quiz.accessCode // Include access code for private quizzes
      }
    });
  } catch (error) {
    console.error('Create custom community quiz error:', error);
    next(error);
  }
});

// Join private quiz with access code
router.post('/join-private', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { accessCode } = req.body;
    const { _id: userId } = req.user;

    if (!accessCode) {
      return res.status(400).json({
        success: false,
        message: 'Access code is required'
      });
    }

    // Find quiz by access code
    const quiz = await CommunityQuiz.findOne({
      accessCode: accessCode.toUpperCase(),
      type: 'private',
      status: 'published',
      isActive: true
    }).populate('userId', 'firstName lastName username');

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Invalid access code'
      });
    }

    // Check if user is a member of the community
    const membership = await CommunityMember.findOne({ 
      userId, 
      communityId: quiz.communityId, 
      isActive: true 
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member of the community to join this quiz'
      });
    }

    // Add user to allowed users if not already present
    if (!quiz.allowedUsers.includes(userId)) {
      await CommunityQuiz.findByIdAndUpdate(quiz._id, {
        $addToSet: { allowedUsers: userId }
      });
    }

    res.json({
      success: true,
      message: 'Successfully joined private quiz',
      data: {
        quizId: quiz._id,
        title: quiz.title,
        description: quiz.description,
        author: quiz.userId
      }
    });
  } catch (error) {
    console.error('Join private quiz error:', error);
    next(error);
  }
});

// Get specific quiz details
router.get('/:communityId/quiz/:quizId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, quizId } = req.params;
    const { _id: userId } = req.user;

    // Check if user is a member of this community
    const membership = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to view community quizzes'
      });
    }

    const quiz = await CommunityQuiz.findOne({
      _id: quizId,
      communityId,
      status: 'published',
      isActive: true
    })
    .populate('userId', 'firstName lastName username profileImage')
    .populate('communityContentId', 'title category');

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Check access for private quizzes
    if (quiz.type === 'private') {
      const hasAccess = quiz.userId.toString() === userId.toString() || 
                       quiz.allowedUsers.includes(userId);
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this private quiz'
        });
      }
    }

    // Get user's previous attempts
    const userAttempts = await CommunityQuizAttempt.find({
      userId,
      communityQuizId: quizId
    }).select('attemptNumber score percentage isPassed createdAt');

    res.json({
      success: true,
      data: {
        quiz,
        userAttempts,
        canAttempt: userAttempts.length < quiz.maxAttempts
      }
    });
  } catch (error) {
    console.error('Get community quiz error:', error);
    next(error);
  }
});

// Get quiz leaderboard
router.get('/:communityId/quiz/:quizId/leaderboard', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, quizId } = req.params;
    const { _id: userId } = req.user;

    // Check if user is a member of this community
    const membership = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to view quiz leaderboards'
      });
    }

    // Get quiz attempts and create leaderboard
    const leaderboard = await CommunityQuizAttempt.aggregate([
      {
        $match: {
          communityQuizId: new mongoose.Types.ObjectId(quizId),
          communityId: new mongoose.Types.ObjectId(communityId)
        }
      },
      {
        $group: {
          _id: '$userId',
          bestScore: { $max: '$score' },
          bestTime: { $min: '$totalTimeTaken' },
          totalAttempts: { $sum: 1 },
          lastAttempt: { $max: '$createdAt' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $project: {
          userId: '$_id',
          username: { $concat: ['$user.firstName', ' ', '$user.lastName'] },
          firstName: '$user.firstName',
          lastName: '$user.lastName',
          score: '$bestScore',
          timeTaken: '$bestTime',
          attempts: '$totalAttempts',
          lastAttempt: '$lastAttempt'
        }
      },
      {
        $sort: { score: -1, timeTaken: 1 }
      },
      {
        $limit: 50
      }
    ]);

    // Add rank to each entry
    const leaderboardWithRank = leaderboard.map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));

    res.json({
      success: true,
      data: leaderboardWithRank
    });
  } catch (error) {
    console.error('Get quiz leaderboard error:', error);
    next(error);
  }
});

// Get quiz discussion messages
router.get('/:communityId/quiz/:quizId/discussion', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, quizId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const { _id: userId } = req.user;

    // Check if user is a member of this community
    const membership = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to view quiz discussions'
      });
    }

    // Get quiz discussion messages
    const discussions = await require('../models/CommunityMessage').find({
      communityId,
      communityQuizId: quizId,
      type: 'quiz-discussion'
    })
    .populate('userId', 'firstName lastName username')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

    res.json({
      success: true,
      data: discussions
    });
  } catch (error) {
    console.error('Get quiz discussion error:', error);
    next(error);
  }
});

// Send quiz discussion message
router.post('/:communityId/quiz/:quizId/discussion', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, quizId } = req.params;
    const { content } = req.body;
    const { _id: userId, clerkUserId } = req.user;

    // Check if user is a member of this community
    const membership = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to participate in quiz discussions'
      });
    }

    const CommunityMessage = require('../models/CommunityMessage');
    
    const message = new CommunityMessage({
      userId,
      clerkUserId,
      communityId,
      communityQuizId: quizId,
      content,
      type: 'quiz-discussion'
    });

    await message.save();
    await message.populate('userId', 'firstName lastName username');

    res.json({
      success: true,
      data: message
    });
  } catch (error) {
    console.error('Send quiz discussion message error:', error);
    next(error);
  }
});

// Start community quiz attempt
router.post('/:communityId/quiz/:quizId/attempt', requireAuth, getOrCreateUser, requireUsername, async (req, res, next) => {
  try {
    const { communityId, quizId } = req.params;
    const { _id: userId, clerkUserId } = req.user;

    // Check if user is a member of this community
    const membership = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to take community quizzes'
      });
    }

    // Get the quiz
    const quiz = await CommunityQuiz.findOne({
      _id: quizId,
      communityId,
      status: 'published',
      isActive: true
    });

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Check if user can take more attempts
    const existingAttempts = await CommunityQuizAttempt.countDocuments({
      userId,
      communityQuizId: quizId
    });

    if (existingAttempts >= quiz.maxAttempts) {
      return res.status(403).json({
        success: false,
        message: `Maximum attempts (${quiz.maxAttempts}) reached`
      });
    }

    // Create new attempt
    const attempt = new CommunityQuizAttempt({
      userId,
      clerkUserId,
      communityId,
      communityQuizId: quizId,
      attemptNumber: existingAttempts + 1,
      answers: quiz.questions.map((q, index) => ({
        questionIndex: index,
        questionId: q._id || `q_${index}`,
        selectedAnswer: null,
        isCorrect: false,
        timeSpent: 0
      }))
    });

    await attempt.save();

    res.json({
      success: true,
      data: attempt
    });
  } catch (error) {
    console.error('Start community quiz attempt error:', error);
    next(error);
  }
});

// Submit community quiz attempt
router.post('/:communityId/quiz/:quizId/attempt/:attemptId/submit', requireAuth, getOrCreateUser, requireUsername, async (req, res, next) => {
  try {
    const { communityId, quizId, attemptId } = req.params;
    const { answers, timeSpent } = req.body;
    const { _id: userId } = req.user;

    // Get the attempt
    const attempt = await CommunityQuizAttempt.findOne({
      _id: attemptId,
      userId,
      communityQuizId: quizId,
      status: 'in-progress'
    });

    if (!attempt) {
      return res.status(404).json({
        success: false,
        message: 'Quiz attempt not found or already completed'
      });
    }

    // Get the quiz for scoring
    const quiz = await CommunityQuiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Calculate score
    let correctAnswers = 0;
    console.log('Starting score calculation for quiz:', quizId);
    console.log('Number of questions:', quiz.questions.length);
    console.log('Number of answers received:', answers.length);
    
    const scoredAnswers = answers.map((answer, index) => {
      const question = quiz.questions[index];
      console.log(`Question ${index}:`, {
        questionText: question?.question,
        correctAnswer: question?.correctAnswer,
        userAnswer: answer.selectedAnswer,
        userAnswerType: typeof answer.selectedAnswer
      });
      
      const isCorrect = question && question.correctAnswer === answer.selectedAnswer;
      if (isCorrect) {
        correctAnswers++;
        console.log(`Question ${index}: CORRECT`);
      } else {
        console.log(`Question ${index}: INCORRECT - Expected ${question?.correctAnswer}, got ${answer.selectedAnswer}`);
      }
      
      return {
        questionIndex: index,
        questionId: question?._id || `q_${index}`,
        selectedAnswer: answer.selectedAnswer,
        isCorrect,
        timeSpent: answer.timeSpent || 0
      };
    });

    const score = correctAnswers;
    const percentage = Math.round((correctAnswers / quiz.questions.length) * 100);
    const totalTimeTaken = timeSpent || scoredAnswers.reduce((total, answer) => total + (answer.timeSpent || 0), 0);
    const isPassed = percentage >= (quiz.passingScore || 70);

    console.log('Final score calculation:', {
      correctAnswers,
      totalQuestions: quiz.questions.length,
      score,
      percentage,
      isPassed
    });

    // Update attempt
    attempt.answers = scoredAnswers;
    attempt.score = score;
    attempt.percentage = percentage;
    attempt.totalTimeTaken = totalTimeTaken;
    attempt.isPassed = isPassed;
    attempt.status = 'completed';
    attempt.completedAt = new Date();

    await attempt.save();

    res.json({
      success: true,
      data: {
        attempt,
        score,
        percentage,
        isPassed,
        correctAnswers,
        totalQuestions: quiz.questions.length,
        totalTimeTaken
      }
    });
  } catch (error) {
    console.error('Submit community quiz attempt error:', error);
    next(error);
  }
});

// Get user's community quiz attempts (for past quizzes)
router.get('/user/attempts', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { _id: userId } = req.user;
    const { page = 1, limit = 10 } = req.query;
    
    const skip = (page - 1) * limit;
    
    // Get user's community quiz attempts
    const attempts = await CommunityQuizAttempt.find({
      userId,
      status: 'completed'
    })
    .populate({
      path: 'communityQuizId',
      populate: {
        path: 'communityId',
        select: 'name'
      }
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

    const total = await CommunityQuizAttempt.countDocuments({
      userId,
      status: 'completed'
    });

    // Format the response to match regular quiz format
    const formattedAttempts = attempts.map(attempt => ({
      _id: attempt._id,
      title: attempt.communityQuizId?.title || 'Community Quiz',
      community: attempt.communityQuizId?.communityId?.name || 'Unknown Community',
      score: attempt.score,
      percentage: attempt.percentage,
      totalQuestions: attempt.communityQuizId?.questions?.length || 0,
      correctAnswers: attempt.score,
      totalTimeTaken: attempt.totalTimeTaken,
      isPassed: attempt.isPassed,
      createdAt: attempt.createdAt,
      completedAt: attempt.completedAt,
      type: 'community',
      communityId: attempt.communityId,
      quizId: attempt.communityQuizId?._id
    }));

    res.json({
      success: true,
      data: {
        quizzes: formattedAttempts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get user community quiz attempts error:', error);
    next(error);
  }
});

module.exports = router;