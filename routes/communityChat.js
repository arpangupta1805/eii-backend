const express = require('express');
const router = express.Router();
const { requireAuth, getOrCreateUser, requireUsername } = require('../middleware/auth');
const CommunityMessage = require('../models/CommunityMessage');
const CommunityMember = require('../models/CommunityMember');

// Get community chat messages
router.get('/:communityId/messages', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId } = req.params;
    const { page = 1, limit = 50, type = 'general' } = req.query;
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
        message: 'You must be a member to view community messages'
      });
    }

    // Build query
    const query = { 
      communityId, 
      type,
      isDeleted: false,
      parentMessageId: null // Only get parent messages, not replies
    };

    const skip = (page - 1) * limit;
    const messages = await CommunityMessage.find(query)
      .populate('userId', 'firstName lastName username profileImage')
      .populate({
        path: 'replies',
        populate: {
          path: 'userId',
          select: 'firstName lastName username profileImage'
        },
        options: { 
          sort: { createdAt: 1 },
          limit: 5 // Limit replies shown initially
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CommunityMessage.countDocuments(query);

    res.json({
      success: true,
      data: {
        messages: messages.reverse(), // Reverse to show oldest first
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get community messages error:', error);
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

    // Check if user has attempted the quiz (requirement for quiz discussion)
    const userAttempt = await require('../models/CommunityQuizAttempt').findOne({
      userId,
      communityQuizId: quizId
    });

    if (!userAttempt) {
      return res.status(403).json({
        success: false,
        message: 'You must attempt the quiz to participate in discussions'
      });
    }

    // Build query for quiz discussion messages
    const query = { 
      communityId,
      communityQuizId: quizId,
      type: 'quiz-discussion',
      isDeleted: false,
      parentMessageId: null
    };

    const skip = (page - 1) * limit;
    const messages = await CommunityMessage.find(query)
      .populate('userId', 'firstName lastName username profileImage')
      .populate({
        path: 'replies',
        populate: {
          path: 'userId',
          select: 'firstName lastName username profileImage'
        },
        options: { 
          sort: { createdAt: 1 },
          limit: 5
        }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CommunityMessage.countDocuments(query);

    res.json({
      success: true,
      data: {
        messages: messages.reverse(),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get quiz discussion messages error:', error);
    next(error);
  }
});

// Send message to community chat
router.post('/:communityId/messages', requireAuth, getOrCreateUser, requireUsername, async (req, res, next) => {
  try {
    const { communityId } = req.params;
    const { content, type = 'general', parentMessageId } = req.body;
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
        message: 'You must be a member to send messages'
      });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    if (content.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Message content is too long (max 2000 characters)'
      });
    }

    // Create message
    const message = new CommunityMessage({
      userId,
      clerkUserId,
      communityId,
      content: content.trim(),
      type,
      parentMessageId: parentMessageId || null
    });

    await message.save();

    // Update parent message reply count if this is a reply
    if (parentMessageId) {
      await CommunityMessage.findByIdAndUpdate(parentMessageId, {
        $inc: { replyCount: 1 }
      });
    }

    // Update member message count
    await CommunityMember.findOneAndUpdate(
      { userId, communityId },
      { $inc: { 'stats.messagesCount': 1 } }
    );

    // Populate user info for response
    await message.populate('userId', 'firstName lastName username profileImage');

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: message
    });
  } catch (error) {
    console.error('Send community message error:', error);
    next(error);
  }
});

// Send message to quiz discussion
router.post('/:communityId/quiz/:quizId/discussion', requireAuth, getOrCreateUser, requireUsername, async (req, res, next) => {
  try {
    const { communityId, quizId } = req.params;
    const { content, parentMessageId } = req.body;
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
        message: 'You must be a member to participate in discussions'
      });
    }

    // Check if user has attempted the quiz
    const userAttempt = await require('../models/CommunityQuizAttempt').findOne({
      userId,
      communityQuizId: quizId
    });

    if (!userAttempt) {
      return res.status(403).json({
        success: false,
        message: 'You must attempt the quiz to participate in discussions'
      });
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    // Create quiz discussion message
    const message = new CommunityMessage({
      userId,
      clerkUserId,
      communityId,
      communityQuizId: quizId,
      content: content.trim(),
      type: 'quiz-discussion',
      parentMessageId: parentMessageId || null
    });

    await message.save();

    // Update parent message reply count if this is a reply
    if (parentMessageId) {
      await CommunityMessage.findByIdAndUpdate(parentMessageId, {
        $inc: { replyCount: 1 }
      });
    }

    // Update member message count
    await CommunityMember.findOneAndUpdate(
      { userId, communityId },
      { $inc: { 'stats.messagesCount': 1 } }
    );

    // Populate user info for response
    await message.populate('userId', 'firstName lastName username profileImage');

    res.json({
      success: true,
      message: 'Discussion message sent successfully',
      data: message
    });
  } catch (error) {
    console.error('Send quiz discussion message error:', error);
    next(error);
  }
});

// Edit message
router.put('/:communityId/messages/:messageId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, messageId } = req.params;
    const { content } = req.body;
    const { _id: userId } = req.user;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Message content is required'
      });
    }

    // Find the message
    const message = await CommunityMessage.findOne({
      _id: messageId,
      communityId,
      userId,
      isDeleted: false
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found or you do not have permission to edit it'
      });
    }

    // Update message
    message.content = content.trim();
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    res.json({
      success: true,
      message: 'Message updated successfully',
      data: message
    });
  } catch (error) {
    console.error('Edit message error:', error);
    next(error);
  }
});

// Delete message
router.delete('/:communityId/messages/:messageId', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, messageId } = req.params;
    const { _id: userId } = req.user;

    // Check membership and get role
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

    // Find the message
    const message = await CommunityMessage.findOne({
      _id: messageId,
      communityId,
      isDeleted: false
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user can delete (author or moderator/admin)
    const canDelete = message.userId.toString() === userId.toString() || 
                     ['moderator', 'admin'].includes(membership.role);

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this message'
      });
    }

    // Soft delete
    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });
  } catch (error) {
    console.error('Delete message error:', error);
    next(error);
  }
});

// Add reaction to message
router.post('/:communityId/messages/:messageId/react', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId, messageId } = req.params;
    const { emoji } = req.body;
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
        message: 'You must be a member to react to messages'
      });
    }

    const validEmojis = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡'];
    if (!validEmojis.includes(emoji)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid emoji'
      });
    }

    // Find the message
    const message = await CommunityMessage.findOne({
      _id: messageId,
      communityId,
      isDeleted: false
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user already reacted with this emoji
    const existingReaction = message.reactions.find(
      r => r.userId.toString() === userId.toString() && r.emoji === emoji
    );

    if (existingReaction) {
      // Remove reaction
      message.reactions = message.reactions.filter(
        r => !(r.userId.toString() === userId.toString() && r.emoji === emoji)
      );
    } else {
      // Remove any other reaction from this user
      message.reactions = message.reactions.filter(
        r => r.userId.toString() !== userId.toString()
      );
      // Add new reaction
      message.reactions.push({ userId, emoji });
    }

    await message.save();

    res.json({
      success: true,
      message: existingReaction ? 'Reaction removed' : 'Reaction added',
      data: message.reactions
    });
  } catch (error) {
    console.error('React to message error:', error);
    next(error);
  }
});

module.exports = router;