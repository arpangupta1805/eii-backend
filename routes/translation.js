const express = require('express');
const router = express.Router();
const translationService = require('../services/translationService');
const databaseService = require('../services/databaseService');
const { authMiddleware } = require('../middleware/auth');
const { body, param, query, validationResult } = require('express-validator');

// Get supported languages
router.get('/languages', (req, res) => {
  try {
    const languages = translationService.getSupportedLanguages();
    res.json({
      success: true,
      data: { languages }
    });
  } catch (error) {
    console.error('Error getting supported languages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get supported languages',
      error: error.message
    });
  }
});

// Translate content
router.get('/content/:contentId',
  authMiddleware,
  [
    param('contentId').notEmpty().withMessage('Content ID is required'),
    query('lang').isIn(['en', 'hi', 'gu', 'mr', 'bn', 'ru', 'zh']).withMessage('Invalid language code')
  ],
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors.array()
        });
      }

      const { contentId } = req.params;
      const { lang } = req.query;
      const user = req.user;

      // Get original content
      const content = await databaseService.getContentById(contentId, user.clerkUserId);
      if (!content) {
        return res.status(404).json({
          success: false,
          message: 'Content not found'
        });
      }

      // If requesting English or content doesn't have AI summary yet, return original
      if (lang === 'en' || !content.aiSummary) {
        return res.json({
          success: true,
          data: { content }
        });
      }

      // Translate content
      const translatedContent = await translationService.translateContent(content, lang);

      res.json({
        success: true,
        data: { content: translatedContent }
      });
    } catch (error) {
      console.error('Translation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to translate content',
        error: error.message
      });
    }
  }
);

// Translate quiz
router.get('/quiz/:contentId',
  authMiddleware,
  [
    param('contentId').notEmpty().withMessage('Content ID is required'),
    query('lang').isIn(['en', 'hi', 'gu', 'mr', 'bn', 'ru', 'zh']).withMessage('Invalid language code')
  ],
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors.array()
        });
      }

      const { contentId } = req.params;
      const { lang } = req.query;
      const user = req.user;

      // Get content with quiz
      const content = await databaseService.getContentById(contentId, user.clerkUserId);
      if (!content) {
        return res.status(404).json({
          success: false,
          message: 'Content not found'
        });
      }

      if (!content.aiSummary || !content.aiSummary.quiz) {
        return res.status(404).json({
          success: false,
          message: 'Quiz not found for this content'
        });
      }

      // If requesting English, return original quiz
      if (lang === 'en') {
        return res.json({
          success: true,
          data: { quiz: content.aiSummary.quiz }
        });
      }

      // Translate quiz
      const translatedQuiz = await translationService.translateQuiz(content.aiSummary.quiz, lang);

      res.json({
        success: true,
        data: { quiz: translatedQuiz }
      });
    } catch (error) {
      console.error('Quiz translation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to translate quiz',
        error: error.message
      });
    }
  }
);

// Translate text (utility endpoint)
router.post('/text',
  authMiddleware,
  [
    body('text').notEmpty().withMessage('Text is required'),
    body('targetLanguage').isIn(['en', 'hi', 'gu', 'mr', 'bn', 'ru', 'zh']).withMessage('Invalid target language code'),
    body('sourceLanguage').optional().isIn(['en', 'hi', 'gu', 'mr', 'bn', 'ru', 'zh']).withMessage('Invalid source language code')
  ],
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: errors.array()
        });
      }

      const { text, targetLanguage, sourceLanguage = 'en' } = req.body;

      const translatedText = await translationService.translateText(text, targetLanguage, sourceLanguage);

      res.json({
        success: true,
        data: {
          originalText: text,
          translatedText,
          sourceLanguage,
          targetLanguage
        }
      });
    } catch (error) {
      console.error('Text translation error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to translate text',
        error: error.message
      });
    }
  }
);

module.exports = router;
