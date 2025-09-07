const express = require('express');
const router = express.Router();
const { requireAuth, getOrCreateUser } = require('../middleware/auth');
const geminiService = require('../services/geminiService');
const Content = require('../models/Content');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');

// Chat with content-based context
router.post('/chat/content/:contentId', requireAuth, getOrCreateUser, async (req, res) => {
  try {
    const { contentId } = req.params;
    const { message } = req.body;
    const user = req.user;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Get the content
    const content = await Content.findOne({
      _id: contentId,
      clerkUserId: user.clerkUserId
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Generate response using content context
    const response = await geminiService.generateContextualResponse(
      message,
      content.originalText,
      content.title,
      content.aiSummary
    );

    res.json({
      success: true,
      data: {
        response,
        contentTitle: content.title,
        contentId: content._id
      }
    });

  } catch (error) {
    console.error('Content chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate response',
      error: error.message
    });
  }
});

// Chat with quiz attempt context
router.post('/chat/quiz/:quizId', requireAuth, getOrCreateUser, async (req, res) => {
  try {
    const { quizId } = req.params;
    const { message } = req.body;
    const user = req.user;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Get the quiz with populated content
    const quiz = await Quiz.findById(quizId).populate('contentId');
    
    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: 'Quiz not found'
      });
    }

    // Get user's latest attempt for this quiz
    const attempt = await QuizAttempt.findOne({
      quizId: quiz._id,
      userId: user._id
    }).sort({ createdAt: -1 });

    let contextData = {
      quizTitle: quiz.title,
      questions: quiz.questions,
      contentTitle: quiz.contentId?.title || 'Unknown Content',
      contentText: quiz.contentId?.originalText || '',
      contentSummary: quiz.contentId?.aiSummary || null
    };

    if (attempt) {
      contextData.userAnswers = attempt.answers;
      contextData.score = attempt.score;
      contextData.totalQuestions = attempt.totalQuestions;
    }

    // Generate response using quiz context
    const response = await geminiService.generateQuizContextualResponse(
      message,
      contextData
    );

    res.json({
      success: true,
      data: {
        response,
        quizTitle: quiz.title,
        quizId: quiz._id,
        hasAttempt: !!attempt
      }
    });

  } catch (error) {
    console.error('Quiz chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate response',
      error: error.message
    });
  }
});

// General chat without specific context
router.post('/chat/general', requireAuth, getOrCreateUser, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Generate general response
    const response = await geminiService.generateGeneralResponse(message);

    res.json({
      success: true,
      data: {
        response
      }
    });

  } catch (error) {
    console.error('General chat error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate response',
      error: error.message
    });
  }
});

module.exports = router;
