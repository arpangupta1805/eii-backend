const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth, getOrCreateUser } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const databaseService = require('../services/databaseService');
const geminiService = require('../services/geminiService');
const Content = require('../models/Content');

// Configure multer for file uploads with better error handling
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    fieldNameSize: 100,
    fieldSize: 1024 * 1024, // 1MB for other fields
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const allowedExtensions = ['.pdf', '.txt', '.md', '.docx'];
    
    const fileExtension = require('path').extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Only PDF, TXT, MD, and DOCX files are allowed. Received: ${file.mimetype}`), false);
    }
  }
});

// Validation schema for content upload
const contentUploadSchema = require('joi').object({
  title: require('joi').string().min(3).max(200).required().trim(),
  category: require('joi').string().valid('technology', 'science', 'business', 'education', 'health', 'arts', 'general').default('general'),
  tags: require('joi').array().items(require('joi').string().trim().max(50)).max(10).optional()
});

// Upload content with enhanced validation and error handling
router.post('/upload', requireAuth, getOrCreateUser, upload.single('file'), async (req, res, next) => {
  try {
    // Validate file upload
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
        error: 'FILE_REQUIRED'
      });
    }

    // Validate request body
    const { error, value } = contentUploadSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
        error: 'VALIDATION_ERROR'
      });
    }

    const { title, category = 'general', tags = [] } = value;
    const user = req.user;
    
    // Extract text from file buffer
    let extractedText;
    try {
      extractedText = req.file.buffer.toString('utf-8');
      
      // Basic text validation
      if (extractedText.trim().length < 50) {
        return res.status(400).json({
          success: false,
          message: 'File content is too short. Minimum 50 characters required.',
          error: 'CONTENT_TOO_SHORT'
        });
      }
    } catch (textError) {
      console.error('Error extracting text:', textError);
      return res.status(400).json({
        success: false,
        message: 'Failed to extract text from file',
        error: 'TEXT_EXTRACTION_FAILED'
      });
    }

    // Calculate metadata
    const wordCount = extractedText.split(/\s+/).length;
    const estimatedReadingTime = Math.ceil(wordCount / 200); // Average 200 words per minute

    // Create content document with enhanced fields
    const contentData = {
      userId: user._id,
      clerkUserId: user.clerkUserId,
      title,
      fileName: req.file.originalname,
      originalText: extractedText,
      fileType: req.file.mimetype,
      category,
      tags: tags.map(tag => tag.toLowerCase()),
      status: 'processing',
      metadata: {
        wordCount,
        fileSize: req.file.size,
        readingTime: estimatedReadingTime,
        language: 'en' // TODO: Add language detection
      }
    };

    // Save content to database first
    const result = await databaseService.createContent(contentData);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to save content',
        error: 'DATABASE_ERROR'
      });
    }

    const content = result.data;
    const contentId = content._id;

    // Process content with AI in background (don't wait for it)
    setImmediate(async () => {
      try {
        const aiSummary = await geminiService.generateContentSummary(extractedText, title);
        
        await Content.findByIdAndUpdate(contentId, {
          status: 'processed',
          aiSummary: {
            summary: aiSummary.summary,
            keyTopics: aiSummary.keyTopics?.map(topic => ({
              topic: topic,
              confidence: 0.8 // Default confidence
            })) || [],
            difficulty: aiSummary.difficulty || 'intermediate',
            estimatedStudyTime: parseInt(aiSummary.estimatedReadTime?.replace(/\D/g, '')) || estimatedReadingTime
          }
        });
        
        console.log(`Content ${contentId} processed successfully`);
      } catch (aiError) {
        console.error('AI processing error:', aiError);
        await Content.findByIdAndUpdate(contentId, {
          status: 'failed'
        });
      }
    });

    res.status(201).json({
      success: true,
      message: 'Content uploaded successfully. AI processing in progress.',
      data: {
        contentId: contentId,
        title,
        category,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        wordCount,
        estimatedReadingTime,
        status: 'processing'
      }
    });
  } catch (error) {
    console.error('Content upload error:', error);
    
    // Handle multer errors
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File size too large. Maximum 50MB allowed.',
          error: 'FILE_TOO_LARGE'
        });
      }
      return res.status(400).json({
        success: false,
        message: `Upload error: ${error.message}`,
        error: 'UPLOAD_ERROR'
      });
    }
    
    next(error);
  }
});

// Upload content from extracted text (for PDF processing)
router.post('/text', requireAuth, getOrCreateUser, validate(schemas.contentText), async (req, res, next) => {
  try {
    const { 
      title, 
      extractedText, 
      fileName, 
      pageCount, 
      fileSize, 
      fileType = 'pdf',
      category = 'general',
      tags = []
    } = req.body;

    const user = req.user;

    // Validate extracted text
    if (!extractedText || extractedText.trim().length < 50) {
      return res.status(400).json({
        success: false,
        message: 'Extracted text is too short. Minimum 50 characters required.',
        error: 'CONTENT_TOO_SHORT'
      });
    }

    // Calculate metadata
    const wordCount = extractedText.split(/\s+/).length;
    const estimatedReadingTime = Math.ceil(wordCount / 200); // Average 200 words per minute

    // Create content document
    const contentData = {
      userId: user._id,
      clerkUserId: user.clerkUserId,
      title: title || fileName?.replace(/\.[^/.]+$/, "") || 'Untitled Document',
      fileName: fileName || 'extracted-content.pdf',
      originalText: extractedText,
      fileType: fileType,
      category: category.toLowerCase(),
      tags: Array.isArray(tags) ? tags.map(tag => tag.toLowerCase()) : [],
      metadata: {
        wordCount,
        readingTime: estimatedReadingTime,
        pageCount: pageCount || 1,
        fileSize: fileSize || extractedText.length,
        extractedAt: new Date()
      },
      processingStatus: 'pending',
      progress: 0
    };

    // Save content to database
    const result = await databaseService.createContent(contentData);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to save content',
        error: result.error
      });
    }

    const contentId = result.data.insertedId || result.data._id;

    // Trigger AI processing asynchronously
    setImmediate(async () => {
      try {
        console.log(`Starting AI processing for content ${contentId}`);
        
        // Generate AI summary using the correct method name
        const summaryResult = await geminiService.generateContentSummary(extractedText, contentData.title);
        
        console.log('AI Summary Result:', summaryResult);
        
        // The geminiService returns the result directly, not wrapped in success/data
        if (summaryResult) {
          // Map AI difficulty values to database enum values
          const mapDifficulty = (aiDifficulty) => {
            const difficultyMap = {
              'easy': 'beginner',
              'medium': 'intermediate',
              'hard': 'advanced',
              'beginner': 'beginner',
              'intermediate': 'intermediate',
              'advanced': 'advanced'
            };
            return difficultyMap[aiDifficulty?.toLowerCase()] || 'intermediate';
          };

          // Transform the AI result to match the database schema
          const transformedSummary = {
            summary: summaryResult.summary,
            keyTopics: summaryResult.keyTopics?.map(topic => ({
              topic: topic,
              confidence: 0.8 // Default confidence score
            })) || [],
            difficulty: mapDifficulty(summaryResult.difficulty),
            learningObjectives: summaryResult.sections?.map(section => section.title) || [],
            prerequisites: [],
            sections: summaryResult.sections?.map(section => ({
              title: section.title,
              content: section.summary,
              keyPoints: section.keyPoints || []
            })) || [],
            generatedAt: new Date()
          };

          console.log('Transformed AI Summary:', transformedSummary);

          // Update content with AI summary - pass all required parameters
          const updateResult = await databaseService.updateContent(contentId, user.clerkUserId, {
            aiSummary: transformedSummary,
            processingStatus: 'completed',
            status: 'processed'
          });

          if (updateResult.success) {
            console.log(`AI processing completed for content ${contentId}`);
          } else {
            console.error(`Failed to update content ${contentId}:`, updateResult.error);
          }
        } else {
          console.error(`AI processing failed for content ${contentId}: No result returned`);
          await databaseService.updateContent(contentId, user.clerkUserId, {
            processingStatus: 'failed',
            processingError: 'No result returned from AI service'
          });
        }
      } catch (aiError) {
        console.error(`AI processing error for content ${contentId}:`, aiError);
        await databaseService.updateContent(contentId, user.clerkUserId, {
          processingStatus: 'failed',
          processingError: aiError.message
        });
      }
    });

    // Return success response immediately
    res.status(201).json({
      success: true,
      message: 'Content uploaded successfully from extracted text. AI processing in progress.',
      data: {
        content: {
          id: contentId,
          title: contentData.title,
          category: contentData.category,
          fileName: contentData.fileName,
          fileSize: contentData.metadata.fileSize,
          wordCount: contentData.metadata.wordCount,
          estimatedReadingTime: contentData.metadata.readingTime,
          pageCount: contentData.metadata.pageCount,
          status: 'processing',
          createdAt: new Date().toISOString(),
          originalText: contentData.originalText,
          metadata: contentData.metadata
        }
      }
    });

  } catch (error) {
    console.error('Text content upload error:', error);
    next(error);
  }
});

// Get user's content with pagination, filtering, and sorting
router.get('/', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const user = req.user;
    const {
      page = 1,
      limit = 10,
      category,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search
    } = req.query;

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit))); // Max 50 items per page

    const options = {
      page: pageNum,
      limit: limitNum,
      category,
      status,
      sortBy,
      sortOrder
    };

    let contents;
    
    if (search) {
      // Use search functionality
      const searchResult = await databaseService.searchContent(search, user.clerkUserId, options);
      if (!searchResult.success) {
        throw new Error(searchResult.error);
      }
      contents = searchResult.data;
    } else {
      // Get regular content list
      const result = await databaseService.getContentByUser(user.clerkUserId, options);
      if (!result.success) {
        throw new Error(result.error);
      }
      contents = result.data;
    }

    res.json({
      success: true,
      data: contents,
      meta: {
        pagination: contents.pagination,
        filters: {
          category,
          status,
          search
        },
        sort: {
          sortBy,
          sortOrder
        }
      }
    });
  } catch (error) {
    console.error('Get content error:', error);
    next(error);
  }
});

// Get specific content with full details
router.get('/:id', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;
    
    // Validate ObjectId
    if (!require('mongoose').Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content ID format',
        error: 'INVALID_ID_FORMAT'
      });
    }
    
    const result = await databaseService.getContentById(id);
    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Database error',
        error: 'DATABASE_ERROR'
      });
    }
    
    const content = result.data;
    
    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
        error: 'CONTENT_NOT_FOUND'
      });
    }
    
    // Check if user owns this content
    if (content.clerkUserId !== user.clerkUserId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        error: 'ACCESS_DENIED'
      });
    }

    // Update analytics (view count and last accessed)
    setImmediate(async () => {
      try {
        await Content.findByIdAndUpdate(id, {
          $inc: { 'analytics.views': 1 },
          'analytics.lastAccessed': new Date()
        });
      } catch (updateError) {
        console.error('Error updating content analytics:', updateError);
      }
    });

    res.json({
      success: true,
      data: content
    });
  } catch (error) {
    console.error('Get content error:', error);
    next(error);
  }
});

// Update content (title, category, tags)
router.put('/:id', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;
    
    if (!require('mongoose').Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content ID format',
        error: 'INVALID_ID_FORMAT'
      });
    }

    const allowedUpdates = ['title', 'category', 'tags'];
    const updates = {};
    
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update',
        error: 'NO_VALID_FIELDS'
      });
    }

    // Validate updates
    if (updates.title && (updates.title.trim().length < 3 || updates.title.length > 200)) {
      return res.status(400).json({
        success: false,
        message: 'Title must be between 3 and 200 characters',
        error: 'INVALID_TITLE'
      });
    }

    if (updates.category && !['technology', 'science', 'business', 'education', 'health', 'arts', 'general'].includes(updates.category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category',
        error: 'INVALID_CATEGORY'
      });
    }

    if (updates.tags) {
      if (!Array.isArray(updates.tags) || updates.tags.length > 10) {
        return res.status(400).json({
          success: false,
          message: 'Tags must be an array with maximum 10 items',
          error: 'INVALID_TAGS'
        });
      }
      updates.tags = updates.tags.map(tag => tag.toString().toLowerCase().trim());
    }

    const result = await databaseService.updateContent(id, user.clerkUserId, updates);
    
    if (!result.success) {
      if (result.error.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: 'Content not found or access denied',
          error: 'CONTENT_NOT_FOUND'
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Failed to update content',
        error: 'DATABASE_ERROR'
      });
    }

    res.json({
      success: true,
      message: 'Content updated successfully',
      data: result.data
    });
  } catch (error) {
    console.error('Update content error:', error);
    next(error);
  }
});

// Delete content (soft delete)
router.delete('/:id', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;
    
    if (!require('mongoose').Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content ID format',
        error: 'INVALID_ID_FORMAT'
      });
    }
    
    const result = await databaseService.deleteContent(id, user.clerkUserId);
    
    if (!result.success) {
      if (result.error.includes('not found')) {
        return res.status(404).json({
          success: false,
          message: 'Content not found or access denied',
          error: 'CONTENT_NOT_FOUND'
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Failed to delete content',
        error: 'DATABASE_ERROR'
      });
    }

    res.json({
      success: true,
      message: 'Content deleted successfully'
    });
  } catch (error) {
    console.error('Delete content error:', error);
    next(error);
  }
});

// Generate or regenerate AI summary for content
router.post('/:id/summary', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const { regenerate = false } = req.body;
    
    if (!require('mongoose').Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content ID format',
        error: 'INVALID_ID_FORMAT'
      });
    }
    
    const result = await databaseService.getContentById(id);
    
    if (!result.success || !result.data) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
        error: 'CONTENT_NOT_FOUND'
      });
    }
    
    const content = result.data;
    
    // Check ownership
    if (content.clerkUserId !== user.clerkUserId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        error: 'ACCESS_DENIED'
      });
    }

    // Check if summary already exists and regenerate is not requested
    if (content.aiSummary?.summary && !regenerate) {
      return res.json({
        success: true,
        message: 'Summary already exists',
        data: content.aiSummary
      });
    }

    // Generate AI summary
    try {
      const aiSummary = await geminiService.generateContentSummary(content.originalText, content.title);
      
      const updateData = {
        status: 'processed',
        aiSummary: {
          summary: aiSummary.summary,
          keyTopics: aiSummary.keyTopics?.map(topic => ({
            topic: typeof topic === 'string' ? topic : topic.topic || topic,
            confidence: typeof topic === 'object' ? topic.confidence || 0.8 : 0.8
          })) || [],
          difficulty: aiSummary.difficulty || 'intermediate',
          estimatedStudyTime: parseInt(aiSummary.estimatedReadTime?.toString().replace(/\D/g, '')) || content.metadata?.readingTime || 0
        }
      };

      const updateResult = await databaseService.updateContent(id, user.clerkUserId, updateData);
      
      if (!updateResult.success) {
        throw new Error('Failed to save summary');
      }

      res.json({
        success: true,
        message: regenerate ? 'Summary regenerated successfully' : 'Summary generated successfully',
        data: updateData.aiSummary
      });
      
    } catch (aiError) {
      console.error('AI summary generation error:', aiError);
      
      // Update status to failed
      await databaseService.updateContent(id, user.clerkUserId, { status: 'failed' });
      
      return res.status(500).json({
        success: false,
        message: 'Failed to generate summary. Please try again later.',
        error: 'AI_PROCESSING_FAILED'
      });
    }
  } catch (error) {
    console.error('Generate summary error:', error);
    next(error);
  }
});

// Search content
router.get('/search/:query', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { query } = req.params;
    const user = req.user;
    const {
      page = 1,
      limit = 10,
      category,
      difficulty
    } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters',
        error: 'INVALID_SEARCH_QUERY'
      });
    }

    const options = {
      page: Math.max(1, parseInt(page)),
      limit: Math.min(50, Math.max(1, parseInt(limit))),
      category,
      difficulty
    };

    const result = await databaseService.searchContent(query.trim(), user.clerkUserId, options);
    
    if (!result.success) {
      throw new Error(result.error);
    }

    res.json({
      success: true,
      data: result.data,
      meta: {
        query,
        filters: {
          category,
          difficulty
        }
      }
    });
  } catch (error) {
    console.error('Search content error:', error);
    next(error);
  }
});

// Update content progress
router.put('/:id/progress', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { progress } = req.body;
    const user = req.user;

    // Validate progress value
    if (typeof progress !== 'number' || progress < 0 || progress > 100) {
      return res.status(400).json({
        success: false,
        message: 'Progress must be a number between 0 and 100',
        error: 'INVALID_PROGRESS_VALUE'
      });
    }

    // Find and update the content
    const content = await Content.findOne({ 
      _id: id, 
      $or: [
        { userId: user._id },
        { clerkUserId: user.clerkUserId }
      ]
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
        error: 'CONTENT_NOT_FOUND'
      });
    }

    // Update progress
    content.progress = progress;
    content.lastAccessed = new Date();
    
    // Update completion status if progress is 100
    if (progress === 100) {
      content.completedAt = new Date();
    }

    await content.save();

    res.json({
      success: true,
      message: 'Progress updated successfully',
      data: {
        contentId: content._id,
        progress: content.progress,
        completedAt: content.completedAt,
        lastAccessed: content.lastAccessed
      }
    });
  } catch (error) {
    console.error('Update progress error:', error);
    next(error);
  }
});

// Get content progress
router.get('/:id/progress', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Find the content
    const content = await Content.findOne({ 
      _id: id, 
      $or: [
        { userId: user._id },
        { clerkUserId: user.clerkUserId }
      ]
    }).select('progress completedAt lastAccessed');

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
        error: 'CONTENT_NOT_FOUND'
      });
    }

    res.json({
      success: true,
      message: 'Progress retrieved successfully',
      data: {
        contentId: content._id,
        progress: content.progress || 0,
        completedAt: content.completedAt,
        lastAccessed: content.lastAccessed
      }
    });
  } catch (error) {
    console.error('Get progress error:', error);
    next(error);
  }
});

module.exports = router;
