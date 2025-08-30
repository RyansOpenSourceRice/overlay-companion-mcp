/**
 * Security Middleware
 * Comprehensive security utilities for the Overlay Companion MCP server
 */

const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');

/**
 * Input validation middleware
 */
const validateInput = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

/**
 * Sanitize string input to prevent injection attacks
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;

  // Remove potentially dangerous characters
  return str
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
};

/**
 * Path traversal protection
 */
const validatePath = (req, res, next) => {
  const path = req.path || req.params.path || req.query.path;
  if (path && (path.includes('..') || path.includes('~') || path.includes('\0'))) {
    return res.status(400).json({
      error: 'Invalid path',
      message: 'Path traversal attempts are not allowed'
    });
  }
  next();
};

/**
 * Rate limiters for different endpoint types
 */
const rateLimiters = {
  // General API endpoints
  general: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: {
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // File system access (more restrictive)
  fileSystem: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per window
    message: {
      error: 'Too many file system requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // WebSocket connections (very restrictive)
  websocket: rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // 5 connection attempts per window
    message: {
      error: 'Too many WebSocket connection attempts from this IP, please try again later.',
      retryAfter: '5 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // Health checks (more permissive)
  health: rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    message: {
      error: 'Too many health check requests from this IP, please try again later.',
      retryAfter: '1 minute'
    },
    standardHeaders: true,
    legacyHeaders: false,
  })
};

/**
 * Input validation rules
 */
const validationRules = {
  // WebSocket message validation
  wsMessage: [
    body('type').isString().isLength({ min: 1, max: 50 }).matches(/^[a-zA-Z_-]+$/),
    body('data').optional().isObject(),
    body('timestamp').optional().isISO8601()
  ],

  // MCP configuration validation
  mcpConfig: [
    query('format').optional().isIn(['json', 'yaml']),
    query('version').optional().matches(/^\d+\.\d+$/)
  ],

  // Path parameters validation
  safePath: [
    param('path').optional().custom((value) => {
      if (value && (value.includes('..') || value.includes('~') || value.includes('\0'))) {
        throw new Error('Invalid path detected');
      }
      return true;
    })
  ]
};

module.exports = {
  validateInput,
  sanitizeString,
  validatePath,
  rateLimiters,
  validationRules
};
