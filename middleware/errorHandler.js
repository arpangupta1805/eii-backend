const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  console.error('Error Details:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    body: req.body,
    user: req.user?.clerkUserId || 'anonymous',
    timestamp: new Date().toISOString()
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { 
      status: 404,
      message,
      error: 'RESOURCE_NOT_FOUND'
    };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `Duplicate value entered for ${field} field`;
    error = { 
      status: 400,
      message,
      error: 'DUPLICATE_FIELD_VALUE'
    };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { 
      status: 400,
      message: 'Validation Error',
      errors: Object.values(err.errors).map(val => val.message),
      error: 'VALIDATION_ERROR'
    };
  }

  // Joi validation error
  if (err.isJoi) {
    error = {
      status: 400,
      message: 'Validation Error',
      errors: err.details.map(detail => detail.message),
      error: 'VALIDATION_ERROR'
    };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = {
      status: 401,
      message: 'Invalid token',
      error: 'INVALID_TOKEN'
    };
  }

  if (err.name === 'TokenExpiredError') {
    error = {
      status: 401,
      message: 'Token expired',
      error: 'TOKEN_EXPIRED'
    };
  }

  // Clerk errors
  if (err.status === 401 && err.message?.includes('clerk')) {
    error = {
      status: 401,
      message: 'Authentication required',
      error: 'AUTHENTICATION_REQUIRED'
    };
  }

  // Rate limiting errors
  if (err.status === 429) {
    error = {
      status: 429,
      message: 'Too many requests, please try again later',
      error: 'RATE_LIMIT_EXCEEDED'
    };
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = {
      status: 400,
      message: 'File size too large',
      error: 'FILE_TOO_LARGE'
    };
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    error = {
      status: 400,
      message: 'Unexpected field name for file upload',
      error: 'UNEXPECTED_FILE_FIELD'
    };
  }

  // Default to 500 server error
  const status = error.status || 500;
  const message = error.message || 'Internal Server Error';
  const errorCode = error.error || 'INTERNAL_SERVER_ERROR';

  const response = {
    success: false,
    message,
    error: errorCode,
    ...(error.errors && { errors: error.errors }),
    ...(process.env.NODE_ENV === 'development' && { 
      stack: err.stack,
      originalError: err.message
    }),
    timestamp: new Date().toISOString(),
    path: req.originalUrl
  };

  // Log error to external service in production
  if (process.env.NODE_ENV === 'production' && status === 500) {
    // TODO: Implement external logging service (e.g., Sentry, LogRocket)
    console.error('CRITICAL ERROR:', {
      message: err.message,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      user: req.user?.clerkUserId,
      timestamp: new Date().toISOString()
    });
  }

  res.status(status).json(response);
};

module.exports = errorHandler;
