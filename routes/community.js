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
    const { _id: userId } = req.user;
    
    const communities = await Community.find({ isActive: true })
      .select('name description category icon color memberCount settings createdBy')
      .populate('createdBy', 'firstName lastName username')
      .sort({ memberCount: -1, name: 1 });

    // Add isCreatedByUser flag for frontend
    const communitiesWithCreatorInfo = communities.map(community => ({
      ...community.toObject(),
      isCreatedByUser: community.createdBy && community.createdBy._id.toString() === userId.toString()
    }));

    res.json({
      success: true,
      data: communitiesWithCreatorInfo
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

// Create a new community
router.post('/create', requireAuth, getOrCreateUser, requireUsername, async (req, res, next) => {
  try {
    const { name, description, category, isPrivate } = req.body;
    const { _id: userId, clerkUserId } = req.user;

    // Validate required fields
    if (!name || !description) {
      return res.status(400).json({
        success: false,
        message: 'Name and description are required'
      });
    }

    // Check if community name already exists
    const existingCommunity = await Community.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') } 
    });

    if (existingCommunity) {
      return res.status(400).json({
        success: false,
        message: 'A community with this name already exists'
      });
    }

    // Create the community
    const community = new Community({
      name: name.trim(),
      description: description.trim(),
      category: category || 'Study Group',
      createdBy: userId,
      icon: getCommunityIcon(name),
      color: getCommunityColor(category),
      memberCount: 1,
      settings: {
        isPrivate: isPrivate || false,
        allowMemberInvites: true,
        requireApproval: false
      }
    });

    await community.save();

    // Automatically add the creator as an admin member
    const memberData = new CommunityMember({
      userId,
      clerkUserId,
      communityId: community._id,
      role: 'admin',
      isActive: true,
      joinedAt: new Date(),
      stats: {
        messagesCount: 0,
        contentShared: 0,
        quizzesCreated: 0,
        quizzesTaken: 0
      }
    });

    await memberData.save();

    console.log('✅ Community created successfully:', community._id, 'by user:', userId);

    res.json({
      success: true,
      message: 'Community created successfully',
      data: community
    });
  } catch (error) {
    console.error('Create community error:', error);
    next(error);
  }
});

// Helper functions for community creation
function getCommunityIcon(name) {
  const lowerName = name.toLowerCase();
  if (lowerName.includes('jee') || lowerName.includes('physics') || lowerName.includes('math')) return '🎯';
  if (lowerName.includes('neet') || lowerName.includes('biology') || lowerName.includes('medical')) return '🩺';
  if (lowerName.includes('chemistry')) return '🧪';
  if (lowerName.includes('english') || lowerName.includes('literature')) return '📚';
  if (lowerName.includes('doubt') || lowerName.includes('help')) return '❓';
  if (lowerName.includes('motivation') || lowerName.includes('support')) return '💪';
  if (lowerName.includes('test') || lowerName.includes('quiz')) return '📝';
  return '📖'; // Default icon
}

function getCommunityColor(category) {
  const colors = {
    'Study Group': 'from-blue-400 to-indigo-500',
    'JEE Preparation': 'from-purple-400 to-indigo-500',
    'NEET Preparation': 'from-green-400 to-teal-500',
    'Subject Specific': 'from-yellow-400 to-orange-500',
    'Doubt Solving': 'from-red-400 to-pink-500',
    'Mock Tests': 'from-indigo-400 to-purple-500',
    'Motivation': 'from-pink-400 to-rose-500',
    'Other': 'from-gray-400 to-slate-500'
  };
  return colors[category] || colors['Study Group'];
}

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