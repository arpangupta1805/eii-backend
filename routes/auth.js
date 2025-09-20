const express = require('express');
const router = express.Router();
const { validate, schemas } = require('../middleware/validation');
const { requireAuth, getOrCreateUser } = require('../middleware/auth');
const databaseService = require('../services/databaseService');

// Get user profile (automatically created via middleware)
router.get('/profile', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    console.error('Get profile error:', error);
    next(error);
  }
});

// Update user profile
router.put('/profile', requireAuth, getOrCreateUser, validate(schemas.profileUpdate), async (req, res, next) => {
  try {
    const { clerkUserId } = req.user;
    const updates = req.body;

    const result = await databaseService.updateUser(clerkUserId, updates);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to update profile',
        error: result.error
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: result.data
    });
  } catch (error) {
    console.error('Update profile error:', error);
    next(error);
  }
});

// Delete user account
router.delete('/profile', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { clerkUserId } = req.user;

    const result = await databaseService.deleteUser(clerkUserId);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to delete account',
        error: result.error
      });
    }

    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    next(error);
  }
});

// Verify authentication status
router.get('/verify', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    res.json({
      success: true,
      authenticated: true,
      user: {
        id: req.user._id,
        clerkUserId: req.user.clerkUserId,
        email: req.user.email,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
        profilePicture: req.user.profilePicture
      }
    });
  } catch (error) {
    console.error('Verify auth error:', error);
    next(error);
  }
});

// Check username availability
router.get('/check-username/:username', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { username } = req.params;
    
    // Validate username format
    if (!username || username.length < 3 || username.length > 20) {
      return res.status(400).json({
        success: false,
        message: 'Username must be between 3 and 20 characters'
      });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({
        success: false,
        message: 'Username can only contain letters, numbers, and underscores'
      });
    }

    const User = require('../models/User');
    const existingUser = await User.findOne({ 
      username: username.toLowerCase(),
      _id: { $ne: req.user._id } // Exclude current user
    });

    res.json({
      success: true,
      data: {
        available: !existingUser,
        username: username.toLowerCase()
      }
    });
  } catch (error) {
    console.error('Check username error:', error);
    next(error);
  }
});

// Set username for user
router.post('/set-username', requireAuth, getOrCreateUser, async (req, res, next) => {
  try {
    const { username } = req.body;
    const User = require('../models/User');
    
    // Validate username
    if (!username || typeof username !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Username is required'
      });
    }

    const cleanUsername = username.trim().toLowerCase();

    if (cleanUsername.length < 3 || cleanUsername.length > 20) {
      return res.status(400).json({
        success: false,
        message: 'Username must be between 3 and 20 characters'
      });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
      return res.status(400).json({
        success: false,
        message: 'Username can only contain letters, numbers, and underscores'
      });
    }

    // Check if username is already taken
    const existingUser = await User.findOne({ 
      username: cleanUsername,
      _id: { $ne: req.user._id }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Username is already taken'
      });
    }

    // Update user with username
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { username: cleanUsername },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Username set successfully',
      data: {
        username: updatedUser.username,
        user: {
          id: updatedUser._id,
          clerkUserId: updatedUser.clerkUserId,
          email: updatedUser.email,
          username: updatedUser.username,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          profileImage: updatedUser.profileImage
        }
      }
    });
  } catch (error) {
    console.error('Set username error:', error);
    if (error.code === 11000) {
      // Duplicate key error
      return res.status(400).json({
        success: false,
        message: 'Username is already taken'
      });
    }
    next(error);
  }
});

module.exports = router;
