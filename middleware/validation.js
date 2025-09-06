const Joi = require('joi');

// Enhanced validation middleware with more options
const validate = (schema, options = {}) => {
  const {
    source = 'body', // 'body', 'params', 'query', 'headers'
    allowUnknown = false,
    stripUnknown = true,
    abortEarly = false
  } = options;

  return (req, res, next) => {
    const dataToValidate = req[source];
    
    const validationOptions = {
      allowUnknown,
      stripUnknown,
      abortEarly,
      errors: {
        wrap: {
          label: false
        }
      }
    };

    const { error, value } = schema.validate(dataToValidate, validationOptions);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        error: 'VALIDATION_ERROR',
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        })),
        timestamp: new Date().toISOString()
      });
    }
    
    // Replace the original data with validated and sanitized data
    req[source] = value;
    next();
  };
};

// MongoDB ObjectId validation
const objectIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/, 'valid ObjectId');

// Common validation schemas
const schemas = {
  // MongoDB ObjectId parameter
  mongoId: Joi.object({
    id: objectIdSchema.required()
  }),

  // Pagination
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string().valid(
      'createdAt', 'updatedAt', 'title', 'category', 'difficulty', 
      'score', 'views', 'lastAccessed'
    ).default('createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc')
  }),

  // User profile updates
  userProfile: Joi.object({
    firstName: Joi.string().trim().min(1).max(50).optional(),
    lastName: Joi.string().trim().min(1).max(50).optional(),
    profile: Joi.object({
      preferences: Joi.object({
        difficulty: Joi.string().valid('easy', 'medium', 'hard').optional(),
        studyGoal: Joi.number().integer().min(5).max(480).optional(), // 5 min to 8 hours
        notifications: Joi.object({
          email: Joi.boolean().optional(),
          reminders: Joi.boolean().optional()
        }).optional(),
        theme: Joi.string().valid('light', 'dark', 'auto').optional()
      }).optional()
    }).optional()
  }).min(1), // At least one field required

  // Content upload validation
  contentUpload: Joi.object({
    title: Joi.string().trim().min(3).max(200).required(),
    category: Joi.string().valid(
      'technology', 'science', 'business', 'education', 
      'health', 'arts', 'general'
    ).default('general'),
    tags: Joi.array()
      .items(Joi.string().trim().min(1).max(50))
      .max(10)
      .unique()
      .optional(),
    isPublic: Joi.boolean().default(false)
  }),

  // Content text upload validation (for extracted PDF text)
  contentText: Joi.object({
    title: Joi.string().trim().min(3).max(200).required(),
    extractedText: Joi.string().trim().min(50).max(500000).required(), // Max ~500KB text
    fileName: Joi.string().trim().min(1).max(255).required(),
    pageCount: Joi.number().integer().min(1).max(1000).optional(),
    fileSize: Joi.number().integer().min(1).optional(),
    fileType: Joi.string().valid('pdf', 'txt', 'md', 'docx').default('pdf'),
    category: Joi.string().valid(
      'technology', 'science', 'business', 'education', 
      'health', 'arts', 'general'
    ).default('general'),
    tags: Joi.array()
      .items(Joi.string().trim().min(1).max(50))
      .max(10)
      .unique()
      .optional()
  }),

  // Content update validation
  contentUpdate: Joi.object({
    title: Joi.string().trim().min(3).max(200).optional(),
    category: Joi.string().valid(
      'technology', 'science', 'business', 'education', 
      'health', 'arts', 'general'
    ).optional(),
    tags: Joi.array()
      .items(Joi.string().trim().min(1).max(50))
      .max(10)
      .unique()
      .optional(),
    isPublic: Joi.boolean().optional()
  }).min(1), // At least one field required

  // Quiz generation
  quizGeneration: Joi.object({
    contentId: objectIdSchema.required(),
    difficulty: Joi.string().valid('beginner', 'intermediate', 'advanced').default('intermediate'),
    questionsCount: Joi.number().integer().min(1).max(20).default(5),
    questionTypes: Joi.array()
      .items(Joi.string().valid('multiple-choice', 'true-false', 'short-answer'))
      .min(1)
      .default(['multiple-choice', 'true-false']),
    timeLimit: Joi.number().integer().min(0).max(180).default(0), // 0 = unlimited, max 3 hours
    randomizeQuestions: Joi.boolean().default(true),
    randomizeOptions: Joi.boolean().default(true),
    passingScore: Joi.number().integer().min(0).max(100).default(70)
  }),

  // Quiz submission
  quizSubmission: Joi.object({
    answers: Joi.array().items(
      Joi.object({
        questionId: Joi.string().required(),
        answer: Joi.alternatives().try(
          Joi.string().allow(''),
          Joi.number(),
          Joi.boolean(),
          Joi.array().items(Joi.string())
        ).required(),
        timeSpent: Joi.number().min(0).default(0) // seconds spent on question
      })
    ).min(1).required(),
    totalTimeSpent: Joi.number().min(0).required(), // total minutes for quiz
    startedAt: Joi.date().max('now').required(),
    completedAt: Joi.date().min(Joi.ref('startedAt')).max('now').required()
  }),

  // Search queries
  search: Joi.object({
    query: Joi.string().trim().min(2).max(100).required(),
    category: Joi.string().valid(
      'technology', 'science', 'business', 'education', 
      'health', 'arts', 'general'
    ).optional(),
    difficulty: Joi.string().valid('beginner', 'intermediate', 'advanced').optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(10)
  }),

  // Analytics timeframe
  analyticsTimeframe: Joi.object({
    timeframe: Joi.string().valid('7d', '30d', '90d', '1y').default('30d'),
    category: Joi.string().valid(
      'technology', 'science', 'business', 'education', 
      'health', 'arts', 'general'
    ).optional(),
    type: Joi.string().valid('all', 'content', 'quiz').default('all')
  }),

  // Progress update
  progressUpdate: Joi.object({
    percentageRead: Joi.number().min(0).max(100).optional(),
    timeSpent: Joi.number().min(0).optional(), // minutes
    status: Joi.string().valid('not-started', 'reading', 'completed', 'bookmarked').optional(),
    bookmarks: Joi.array().items(
      Joi.object({
        position: Joi.number().required(),
        note: Joi.string().max(500).optional()
      })
    ).optional(),
    notes: Joi.array().items(
      Joi.object({
        content: Joi.string().max(1000).required(),
        position: Joi.number().required()
      })
    ).optional()
  }).min(1),

  // File upload validation (for multer)
  fileUpload: {
    allowedMimeTypes: [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ],
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedExtensions: ['.pdf', '.txt', '.md', '.docx']
  }
};

// Validation middleware for specific use cases
const validateMongoId = validate(schemas.mongoId, { source: 'params' });
const validatePagination = validate(schemas.pagination, { source: 'query' });
const validateUserProfile = validate(schemas.userProfile);
const validateContentUpload = validate(schemas.contentUpload);
const validateContentUpdate = validate(schemas.contentUpdate);
const validateQuizGeneration = validate(schemas.quizGeneration);
const validateQuizSubmission = validate(schemas.quizSubmission);
const validateSearch = validate(schemas.search, { source: 'query' });
const validateAnalyticsTimeframe = validate(schemas.analyticsTimeframe, { source: 'query' });
const validateProgressUpdate = validate(schemas.progressUpdate);

// Custom validation for file uploads
const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded',
      error: 'FILE_REQUIRED'
    });
  }

  const { allowedMimeTypes, maxFileSize, allowedExtensions } = schemas.fileUpload;
  const fileExtension = require('path').extname(req.file.originalname).toLowerCase();

  // Check file type
  if (!allowedMimeTypes.includes(req.file.mimetype) && !allowedExtensions.includes(fileExtension)) {
    return res.status(400).json({
      success: false,
      message: `Invalid file type. Allowed types: ${allowedExtensions.join(', ')}`,
      error: 'INVALID_FILE_TYPE'
    });
  }

  // Check file size
  if (req.file.size > maxFileSize) {
    return res.status(400).json({
      success: false,
      message: `File size too large. Maximum size: ${maxFileSize / (1024 * 1024)}MB`,
      error: 'FILE_TOO_LARGE'
    });
  }

  // Validate file name
  if (!req.file.originalname || req.file.originalname.length > 255) {
    return res.status(400).json({
      success: false,
      message: 'Invalid file name',
      error: 'INVALID_FILE_NAME'
    });
  }

  next();
};

// Sanitization helpers
const sanitizeHtml = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

const sanitizeInput = (obj) => {
  if (typeof obj === 'string') {
    return sanitizeHtml(obj.trim());
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  return obj;
};

// Middleware to sanitize request data
const sanitize = (sources = ['body', 'query', 'params']) => {
  return (req, res, next) => {
    sources.forEach(source => {
      if (req[source]) {
        req[source] = sanitizeInput(req[source]);
      }
    });
    next();
  };
};

module.exports = {
  validate,
  schemas,
  validateMongoId,
  validatePagination,
  validateUserProfile,
  validateContentUpload,
  validateContentUpdate,
  validateQuizGeneration,
  validateQuizSubmission,
  validateSearch,
  validateAnalyticsTimeframe,
  validateProgressUpdate,
  validateFileUpload,
  sanitize,
  sanitizeHtml,
  sanitizeInput
};
