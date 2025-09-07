require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = [
  'MONGODB_URI',
  'GEMINI_API_KEY',
  'CLERK_SECRET_KEY'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars);
  console.error('Please check your .env file');
  process.exit(1);
}

console.log('Environment check passed');
console.log('MongoDB URI configured:', process.env.MONGODB_URI ? 'Yes' : 'No');
console.log('Gemini API Key configured:', process.env.GEMINI_API_KEY ? 'Yes' : 'No');
console.log('Clerk Secret Key configured:', process.env.CLERK_SECRET_KEY ? 'Yes' : 'No');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');

// Import database connection
const connectDB = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth');
const contentRoutes = require('./routes/content');
const quizRoutes = require('./routes/quiz');
const analyticsRoutes = require('./routes/analytics');
const chatbotRoutes = require('./routes/chatbot');

// Import middleware
const errorHandler = require('./middleware/errorHandler');
const { sanitize } = require('./middleware/validation');

const app = express();
const PORT = process.env.PORT || 5001;

// Connect to MongoDB
connectDB();

// Trust proxy for proper IP addresses behind reverse proxy
app.set('trust proxy', 1);

// Compression middleware
app.use(compression());

// Security middleware
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Normalize frontend URL (remove trailing slash if present)
    const normalizedFrontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '');
    
    const allowedOrigins = [
      normalizedFrontendUrl,
      'https://eii-sigma-7.vercel.app',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:8080',
      'https://eii-backend.onrender.com'
    ].filter(Boolean);
    
    console.log('CORS Check - Origin:', origin);
    console.log('Allowed Origins:', allowedOrigins);
    
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('No origin - allowing request');
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log('Origin allowed');
      callback(null, true);
    } else if (process.env.NODE_ENV === 'development') {
      console.log('Development mode - allowing all origins');
      callback(null, true);
    } else {
      console.log('Origin not allowed:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Handle preflight OPTIONS requests explicitly
app.options('*', cors(corsOptions));

// Additional CORS headers for all responses
app.use((req, res, next) => {
  const normalizedFrontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '');
  const origin = req.headers.origin;
  
  if (origin === normalizedFrontendUrl || origin === 'https://eii-sigma-7.vercel.app') {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With,Accept,Origin');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Rate limiting with different limits for different routes
const createRateLimiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: {
    success: false,
    message,
    error: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

// General API rate limiting
app.use('/api/', createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  100, // 100 requests per window
  'Too many requests from this IP, please try again later.'
));

// Stricter rate limiting for upload endpoints
app.use('/api/content/upload', createRateLimiter(
  60 * 60 * 1000, // 1 hour
  10, // 10 uploads per hour
  'Too many file uploads, please try again later.'
));

// Quiz generation rate limiting
app.use('/api/quiz/generate', createRateLimiter(
  60 * 60 * 1000, // 1 hour
  20, // 20 quiz generations per hour
  'Too many quiz generation requests, please try again later.'
));

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Additional CORS and request logging
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const method = req.method;
  const url = req.url;
  
  if (process.env.NODE_ENV === 'production') {
    console.log(`${method} ${url} - Origin: ${origin || 'None'}`);
    
    // Log CORS headers being sent
    if (method === 'OPTIONS') {
      console.log('CORS Preflight Request detected');
    }
  }
  
  next();
});

// Body parsing middleware with size limits
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Sanitize input data
app.use(sanitize(['body', 'query', 'params']));

// Health check endpoint with detailed status
app.get('/health', async (req, res) => {
  const healthcheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    database: 'unknown',
    memory: process.memoryUsage()
  };

  try {
    // Check database connection
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState === 1) {
      healthcheck.database = 'connected';
    } else {
      healthcheck.database = 'disconnected';
      healthcheck.status = 'unhealthy';
    }
  } catch (error) {
    healthcheck.database = 'error';
    healthcheck.status = 'unhealthy';
    healthcheck.error = error.message;
  }

  const status = healthcheck.status === 'healthy' ? 200 : 503;
  res.status(status).json(healthcheck);
});

// API status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    version: process.env.npm_package_version || '1.0.0',
    endpoints: {
      auth: '/api/auth',
      content: '/api/content',
      quiz: '/api/quiz',
      analytics: '/api/analytics'
    },
    documentation: process.env.API_DOCS_URL || null
  });
});

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
  res.json({
    success: true,
    message: 'CORS is working correctly',
    origin: req.headers.origin,
    timestamp: new Date().toISOString(),
    headers: {
      'access-control-allow-origin': res.getHeader('access-control-allow-origin'),
      'access-control-allow-credentials': res.getHeader('access-control-allow-credentials'),
      'access-control-allow-methods': res.getHeader('access-control-allow-methods'),
    }
  });
});

// Handle preflight for CORS test
app.options('/api/cors-test', (req, res) => {
  res.status(200).end();
});

// API routes with versioning
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/content', contentRoutes);
app.use('/api/v1/quiz', quizRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/chatbot', chatbotRoutes);

// Backward compatibility (without versioning)
app.use('/api/auth', authRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/chatbot', chatbotRoutes);

// Root route for health check and basic info
app.get('/', (req, res) => {
  res.json({
    message: 'YATI-Discipline Learning Platform API',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      status: '/api/status',
      auth: '/api/auth',
      content: '/api/content',
      quiz: '/api/quiz',
      analytics: '/api/analytics'
    }
  });
});

// Catch unhandled routes
app.use('*', (req, res, next) => {
  const error = new Error(`Route ${req.originalUrl} not found`);
  error.status = 404;
  error.error = 'ROUTE_NOT_FOUND';
  next(error);
});

// Global error handler (must be last)
app.use(errorHandler);

// Graceful shutdown handlers
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  const server = app.listen(PORT);
  
  server.close(() => {
    console.log('HTTP server closed.');
    
    // Close database connections
    const mongoose = require('mongoose');
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed.');
      process.exit(0);
    });
  });

  // Force close server after 30 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

const server = app.listen(PORT, () => {
  console.log(`
🚀 Server running on port ${PORT}
📱 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
📊 Health check: http://localhost:${PORT}/health
📚 API Status: http://localhost:${PORT}/api/status
  `);
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
  }
});

module.exports = app;
