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

module.exports = router;
