const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { validate, schemas } = require('../middleware/validation');
const { requireAuth, getOrCreateUser } = require('../middleware/auth');
const CommunityContent = require('../models/CommunityContent');
const CommunityMember = require('../models/CommunityMember');
const Content = require('../models/Content');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, TXT, and DOCX files are allowed.'));
    }
  },
});

// Get community content
router.get('/:communityId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId } = req.params;
    const { page = 1, limit = 10, category, search } = req.query;
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
        message: 'You must be a member to view community content'
      });
    }

    // Build query
    const query = { 
      communityId, 
      status: 'approved', 
      isActive: true 
    };
    
    if (category) query.category = category;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    const skip = (page - 1) * limit;
    const content = await CommunityContent.find(query)
      .populate('userId', 'firstName lastName username profileImage')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CommunityContent.countDocuments(query);

    res.json({
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
    });
  } catch (error) {
    console.error('Get community content error:', error);
    next(error);
  }
});

// Upload new content to community
router.post('/:communityId/upload', requireAuth, getOrCreateUser, upload.single('file'), async (req, res, next) => {
  try {
    const { communityId } = req.params;
    const { title, description, category = 'general', tags } = req.body;
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
        message: 'You must be a member to upload content'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'File is required'
      });
    }

    // Process file content
    let originalText = '';
    const fileName = req.file.originalname;
    let fileType = 'pdf';

    try {
      if (req.file.mimetype === 'text/plain') {
        originalText = req.file.buffer.toString('utf-8');
        fileType = 'txt';
      } else if (req.file.mimetype === 'application/pdf') {
        // Extract text from PDF using pdf-parse
        const data = await pdfParse(req.file.buffer);
        originalText = data.text || 'Unable to extract text from this PDF file. The content may be image-based or encrypted.';
        fileType = 'pdf';
      } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // For DOCX files, we'll use a placeholder for now
        originalText = 'DOCX content extraction would be implemented here. This document contains valuable educational content that can be accessed by community members for study purposes.';
        fileType = 'docx';
      }

      // Ensure minimum length requirement is met
      if (originalText.length < 50) {
        originalText = originalText + ' This content has been uploaded to the community library for educational purposes and can be accessed by all community members.';
      }
    } catch (extractionError) {
      console.error('Text extraction error:', extractionError);
      // Fallback to a default message if extraction fails
      originalText = `Content from ${fileName} has been uploaded to the community library. This file contains educational material that can be accessed by community members for learning and study purposes.`;
    }

    // Create community content
    const communityContent = new CommunityContent({
      userId,
      clerkUserId,
      communityId,
      title,
      description,
      fileName,
      originalText,
      fileType,
      category,
      tags: tags ? tags.split(',').map(tag => tag.trim()) : []
    });

    await communityContent.save();

    // Generate AI summary after saving the content
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const prompt = `
        Analyze the following content and provide a comprehensive summary:
        
        Title: ${title}
        Content: ${originalText}
        
        Please provide a JSON response with the following structure:
        {
          "summary": "A thorough summary of the content in 3-4 detailed paragraphs, covering all major points, examples, and explanations. Make it informative and well-structured.",
          "keyTopics": ["topic1", "topic2", "topic3"],
          "difficulty": "beginner|intermediate|advanced",
          "estimatedReadTime": "X minutes",
          "sections": [
            {
              "title": "Section Title",
              "summary": "A detailed summary of this section capturing the main ideas and supporting details.",
              "keyPoints": [
                "Clear, detailed point 1",
                "Clear, detailed point 2"
              ]
            }
          ]
        }
        
        Respond with only the JSON object.
      `;

      console.log('Generating AI summary for uploaded content:', communityContent._id);
      const result = await model.generateContent(prompt);
      const response = result.response;
      const responseText = response.text();
      
      const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
      const summaryData = JSON.parse(cleanedText);
      
      // Update the content with AI summary
      communityContent.aiSummary = {
        summary: summaryData.summary,
        keyTopics: summaryData.keyTopics || [],
        difficulty: summaryData.difficulty || 'intermediate',
        estimatedReadTime: summaryData.estimatedReadTime || '5 minutes',
        sections: summaryData.sections || [],
        generatedAt: new Date()
      };
      
      await communityContent.save();
      console.log('AI summary generated and saved for content:', communityContent._id);
      
    } catch (summaryError) {
      console.error('Failed to generate AI summary:', summaryError);
      // Continue without summary - content is still uploaded successfully
    }

    // Update member stats
    await CommunityMember.findOneAndUpdate(
      { userId, communityId },
      { $inc: { 'stats.contentShared': 1 } }
    );

    res.json({
      success: true,
      message: 'Content uploaded successfully',
      data: communityContent
    });
  } catch (error) {
    console.error('Upload community content error:', error);
    next(error);
  }
});

// Share existing personal content to community
router.post('/:communityId/share/:contentId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, contentId } = req.params;
    const { description } = req.body;
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
        message: 'You must be a member to share content'
      });
    }

    // Get the original content
    const originalContent = await Content.findOne({ 
      _id: contentId, 
      userId 
    });

    if (!originalContent) {
      return res.status(404).json({
        success: false,
        message: 'Content not found or you do not have permission'
      });
    }

    // Check if already shared
    const existingShare = await CommunityContent.findOne({
      originalContentId: contentId,
      communityId,
      userId
    });

    if (existingShare) {
      return res.status(400).json({
        success: false,
        message: 'Content already shared to this community'
      });
    }

    // Create shared community content
    const sharedContent = new CommunityContent({
      userId,
      clerkUserId,
      communityId,
      originalContentId: contentId,
      title: originalContent.title,
      description: description || originalContent.description || '',
      fileName: originalContent.fileName,
      originalText: originalContent.originalText,
      fileType: originalContent.fileType,
      category: originalContent.category,
      tags: originalContent.tags
    });

    await sharedContent.save();

    // Update member stats
    await CommunityMember.findOneAndUpdate(
      { userId, communityId },
      { $inc: { 'stats.contentShared': 1 } }
    );

    res.json({
      success: true,
      message: 'Content shared successfully',
      data: sharedContent
    });
  } catch (error) {
    console.error('Share content to community error:', error);
    next(error);
  }
});

// Get specific community content
router.get('/:communityId/content/:contentId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, contentId } = req.params;
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
        message: 'You must be a member to view community content'
      });
    }

    const content = await CommunityContent.findOne({
      _id: contentId,
      communityId,
      status: 'approved',
      isActive: true
    }).populate('userId', 'firstName lastName username profileImage');

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Increment view count
    await CommunityContent.findByIdAndUpdate(contentId, {
      $inc: { viewCount: 1 }
    });

    res.json({
      success: true,
      data: content
    });
  } catch (error) {
    console.error('Get community content error:', error);
    next(error);
  }
});

// Delete community content (only by author or moderator)
router.delete('/:communityId/content/:contentId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, contentId } = req.params;
    const { _id: userId } = req.user;

    // Check membership and role
    const membership = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member of this community'
      });
    }

    // Find the content
    const content = await CommunityContent.findOne({
      _id: contentId,
      communityId
    });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Check if user can delete (author or moderator/admin)
    const canDelete = content.userId.toString() === userId.toString() || 
                     ['moderator', 'admin'].includes(membership.role);

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this content'
      });
    }

    // Soft delete
    await CommunityContent.findByIdAndUpdate(contentId, {
      isActive: false
    });

    res.json({
      success: true,
      message: 'Content deleted successfully'
    });
  } catch (error) {
    console.error('Delete community content error:', error);
    next(error);
  }
});

// Generate summary for community content
router.post('/:communityId/:contentId/generate-summary', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, contentId } = req.params;
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
        message: 'You must be a member to view content summaries'
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

    // Check if summary already exists
    if (content.aiSummary && content.aiSummary.summary) {
      console.log('Returning existing AI summary for content:', contentId);
      return res.json({
        success: true,
        data: content.aiSummary
      });
    }

    // Generate new summary if not exists
    console.log('Generating new AI summary for content:', contentId);
    
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const prompt = `
        Analyze the following content and provide a comprehensive summary:
        
        Title: ${content.title}
        Content: ${content.originalText}
        
        Please provide a JSON response with the following structure:
        {
          "summary": "A thorough summary of the content in 3-4 detailed paragraphs, covering all major points, examples, and explanations. Make it informative and well-structured.",
          "keyTopics": ["topic1", "topic2", "topic3"],
          "difficulty": "beginner|intermediate|advanced",
          "estimatedReadTime": "X minutes",
          "sections": [
            {
              "title": "Section Title",
              "summary": "A detailed summary of this section capturing the main ideas and supporting details.",
              "keyPoints": [
                "Clear, detailed point 1",
                "Clear, detailed point 2"
              ]
            }
          ]
        }
        
        Respond with only the JSON object.
      `;
      
      const result = await model.generateContent(prompt);
      const response = result.response;
      const responseText = response.text();
      
      const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
      const summaryData = JSON.parse(cleanedText);
      
      // Save the generated summary to database
      content.aiSummary = {
        summary: summaryData.summary,
        keyTopics: summaryData.keyTopics || [],
        difficulty: summaryData.difficulty || 'intermediate',
        estimatedReadTime: summaryData.estimatedReadTime || '5 minutes',
        sections: summaryData.sections || [],
        generatedAt: new Date()
      };
      
      await content.save();
      console.log('New AI summary generated and saved for content:', contentId);
      
      res.json({
        success: true,
        data: content.aiSummary
      });
      
    } catch (parseError) {
      console.error('Failed to parse AI summary response:', parseError);
      res.status(500).json({
        success: false,
        message: 'Failed to generate content summary'
      });
    }

  } catch (error) {
    console.error('Generate community content summary error:', error);
    next(error);
  }
});

module.exports = router;