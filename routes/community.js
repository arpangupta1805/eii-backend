const express = require('express');
const router = express.Router();
const { validate, schemas } = require('../middleware/validation');
const { requireAuth, getOrCreateUser, requireUsername } = require('../middleware/auth');
const Community = require('../models/Community');
const CommunityMember = require('../models/CommunityMember');
const CommunityContent = require('../models/CommunityContent');
const CommunityQuiz = require('../models/CommunityQuiz');
const CommunityQuizAttempt = require('../models/CommunityQuizAttempt');
const CommunityMessage = require('../models/CommunityMessage');

// Get all available communities
router.get('/', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const communities = await Community.find({ isActive: true })
      .select('name description category icon color memberCount settings')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: communities
    });
  } catch (error) {
    console.error('Get communities error:', error);
    next(error);
  }
});

// Get user's joined communities
router.get('/my-communities', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { _id: userId } = req.user;

    const memberData = await CommunityMember.find({ 
      userId, 
      isActive: true 
    })
    .populate('communityId', 'name description category icon color memberCount')
    .sort({ joinedAt: -1 });

    const communities = memberData.map(member => ({
      ...member.communityId.toObject(),
      memberRole: member.role,
      joinedAt: member.joinedAt,
      stats: member.stats
    }));

    res.json({
      success: true,
      data: communities
    });
  } catch (error) {
    console.error('Get user communities error:', error);
    next(error);
  }
});

// Join a community
router.post('/:communityId/join', requireAuth, getOrCreateUser, requireUsername, async (req, res, next) => {
  try {
    const { communityId } = req.params;
    const { _id: userId, clerkUserId } = req.user;

    // Check if community exists
    const community = await Community.findById(communityId);
    if (!community) {
      return res.status(404).json({
        success: false,
        message: 'Community not found'
      });
    }

    // Check if user is already a member
    const existingMember = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (existingMember) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this community'
      });
    }

    // Create new membership
    const membership = new CommunityMember({
      userId,
      clerkUserId,
      communityId,
      role: 'member'
    });

    await membership.save();

    // Update community member count
    await Community.findByIdAndUpdate(communityId, {
      $inc: { memberCount: 1 }
    });

    res.json({
      success: true,
      message: 'Successfully joined the community',
      data: membership
    });
  } catch (error) {
    console.error('Join community error:', error);
    next(error);
  }
});

// Leave a community
router.post('/:communityId/leave', requireAuth, getOrCreateUser, requireUsername, async (req, res, next) => {
  try {
    const { communityId } = req.params;
    const { _id: userId } = req.user;

    // Find and deactivate membership
    const membership = await CommunityMember.findOneAndUpdate(
      { userId, communityId, isActive: true },
      { isActive: false },
      { new: true }
    );

    if (!membership) {
      return res.status(404).json({
        success: false,
        message: 'You are not a member of this community'
      });
    }

    // Update community member count
    await Community.findByIdAndUpdate(communityId, {
      $inc: { memberCount: -1 }
    });

    res.json({
      success: true,
      message: 'Successfully left the community'
    });
  } catch (error) {
    console.error('Leave community error:', error);
    next(error);
  }
});

// Get community members
router.get('/:communityId/members', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { communityId } = req.params;
    const { page = 1, limit = 20, role } = req.query;
    const { _id: userId } = req.user;

    // Check if user is a member of this community
    const userMembership = await CommunityMember.findOne({ 
      userId, 
      communityId, 
      isActive: true 
    });

    if (!userMembership) {
      return res.status(403).json({
        success: false,
        message: 'You must be a member to view community members'
      });
    }

    // Build query
    const query = { communityId, isActive: true };
    if (role) query.role = role;

    const skip = (page - 1) * limit;
    const members = await CommunityMember.find(query)
      .populate('userId', 'firstName lastName username profileImage')
      .sort({ joinedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await CommunityMember.countDocuments(query);

    res.json({
      success: true,
      data: {
        members,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get community members error:', error);
    next(error);
  }
});

module.exports = router;