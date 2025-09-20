const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');
const User = require('../models/User');

// Middleware to verify Clerk authentication
const requireAuth = ClerkExpressRequireAuth({
  // This will automatically verify the session token
  onError: (error) => {
    console.error('Clerk authentication error:', error);
    return {
      status: 401,
      message: 'Authentication required'
    };
  }
});

// Middleware to get or create user in MongoDB
const getOrCreateUser = async (req, res, next) => {
  try {
    const { userId: clerkUserId } = req.auth;
    
    if (!clerkUserId) {
      return res.status(401).json({ 
        success: false, 
        message: 'User ID not found in authentication' 
      });
    }
    
    // Try to find existing user
    let user = await User.findOne({ clerkUserId });
    
    if (!user) {
      // Get user details from Clerk
      const { clerkClient } = require('@clerk/clerk-sdk-node');
      const clerkUser = await clerkClient.users.getUser(clerkUserId);
      
      console.log('Creating new user without username for:', clerkUserId);
      
      // Create new user in MongoDB without username initially
      const userData = {
        clerkUserId,
        email: clerkUser.emailAddresses[0]?.emailAddress || `${clerkUserId}@clerk.local`,
        username: null, // No username initially
        firstName: clerkUser.firstName || 'User',
        lastName: clerkUser.lastName || '',
        profileImage: clerkUser.imageUrl || null,
        profile: {
          fullName: `${clerkUser.firstName || 'User'} ${clerkUser.lastName || ''}`.trim(),
          dateOfBirth: null,
          location: {
            country: null,
            city: null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
          },
          bio: null,
          interests: [],
          occupation: null,
          educationLevel: 'not-specified'
        },
        preferences: {
          language: 'en',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          notifications: {
            email: true,
            push: true,
            studyReminders: true,
            achievementUpdates: true,
            weeklyProgress: true
          },
          privacy: {
            profileVisibility: 'private',
            progressVisibility: 'private',
            allowDataCollection: true
          },
          learningPreferences: {
            dailyGoalMinutes: 30,
            reminderTime: '19:00',
            preferredDifficulty: 'intermediate',
            autoGenerateQuizzes: true
          }
        }
      };
      
      // Validate required fields before creating user
      console.log('Creating user with data:', {
        clerkUserId: userData.clerkUserId,
        email: userData.email,
        username: userData.username,
        firstName: userData.firstName
      });
      
      user = new User(userData);
      
      try {
        await user.save();
        console.log('New user created successfully:', clerkUserId);
      } catch (saveError) {
        console.error('Error saving new user:', saveError);
        
        if (saveError.name === 'ValidationError') {
          console.log('Validation error details:', saveError.errors);
          
          // Handle specific validation errors
          if (saveError.errors.username) {
            console.log('Username validation failed, generating new fallback...');
            const fallbackUsername = `user_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            user.username = fallbackUsername;
            console.log('Trying with fallback username:', fallbackUsername);
            
            try {
              await user.save();
              console.log('User saved successfully with fallback username:', fallbackUsername);
            } catch (secondError) {
              console.error('Failed to save even with fallback username:', secondError);
              throw new Error(`Failed to create user: ${secondError.message}`);
            }
          } else {
            throw saveError;
          }
        } else if (saveError.code === 11000) {
          // Handle duplicate key error
          console.log('Duplicate key error, generating new username...');
          const uniqueUsername = `user_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
          user.username = uniqueUsername;
          await user.save();
          console.log('User saved with unique username:', uniqueUsername);
        } else {
          throw saveError;
        }
      }
    } else {
      // Update last seen
      user.lastSeen = new Date();
      await user.save();
    }
    
    // Add user to request object
    req.user = user;
    next();
    
  } catch (error) {
    console.error('Error in getOrCreateUser middleware:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error processing user authentication',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Middleware to check if user has required permissions
const checkPermissions = (requiredPermissions = []) => {
  return (req, res, next) => {
    try {
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      // Check if user account is active
      if (!user.isActive) {
        return res.status(403).json({ 
          success: false, 
          message: 'Account is deactivated' 
        });
      }
      
      // If no specific permissions required, just check if user is active
      if (requiredPermissions.length === 0) {
        return next();
      }
      
      // Check specific permissions (can be extended based on user roles)
      const userPermissions = user.role === 'admin' ? ['read', 'write', 'delete', 'admin'] : ['read', 'write'];
      
      const hasPermission = requiredPermissions.every(permission => 
        userPermissions.includes(permission)
      );
      
      if (!hasPermission) {
        return res.status(403).json({ 
          success: false, 
          message: 'Insufficient permissions' 
        });
      }
      
      next();
    } catch (error) {
      console.error('Error in checkPermissions middleware:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Error checking permissions' 
      });
    }
  };
};

// Optional auth middleware (doesn't require authentication but adds user if available)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    
    // Try to authenticate but don't fail if it doesn't work
    const { clerkClient } = require('@clerk/clerk-sdk-node');
    const sessionToken = authHeader.split(' ')[1];
    
    try {
      const session = await clerkClient.sessions.verifySession(sessionToken, {
        secretKey: process.env.CLERK_SECRET_KEY
      });
      
      if (session && session.userId) {
        const user = await User.findOne({ clerkUserId: session.userId });
        if (user) {
          req.user = user;
        }
      }
    } catch (authError) {
      // Silently fail for optional auth
      console.log('Optional auth failed:', authError.message);
    }
    
    next();
  } catch (error) {
    console.error('Error in optionalAuth middleware:', error);
    next(); // Continue without auth for optional middleware
  }
};

// Middleware to check if user has a username (required for community features)
const requireUsername = async (req, res, next) => {
  try {
    // Ensure user is authenticated and loaded
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Check if user has a username
    if (!req.user.username || req.user.username.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Username required',
        code: 'USERNAME_REQUIRED',
        data: {
          requiresUsername: true,
          userId: req.user._id
        }
      });
    }

    next();
  } catch (error) {
    console.error('Error in requireUsername middleware:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while checking username'
    });
  }
};

module.exports = {
  requireAuth,
  getOrCreateUser,
  checkPermissions,
  optionalAuth,
  requireUsername
};
