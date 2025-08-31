/**
 * Security Middleware
 * Comprehensive security utilities for the Overlay Companion MCP server
 */

const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const validator = require('validator');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

// Create DOMPurify instance for server-side use
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

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
 * Sanitize string input using DOMPurify and validator.js
 * Addresses CodeQL: Incomplete multi-character sanitization
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;

  // Use DOMPurify for comprehensive HTML sanitization
  const sanitized = DOMPurify.sanitize(str, {
    ALLOWED_TAGS: [], // Strip all HTML tags
    ALLOWED_ATTR: [] // Strip all attributes
  });

  // Additional URL scheme filtering using validator.js
  let result = sanitized;

  // Remove dangerous URL schemes (addresses CodeQL incomplete URL scheme check)
  const dangerousSchemes = [
    /javascript:/gi,
    /data:/gi,
    /vbscript:/gi,
    /file:/gi,
    /about:/gi,
    /chrome:/gi,
    /chrome-extension:/gi,
    /moz-extension:/gi
  ];

  dangerousSchemes.forEach(scheme => {
    result = result.replace(scheme, '');
  });

  // Remove event handlers and dangerous attributes
  result = result.replace(/on\w+\s*=/gi, '');

  return validator.escape(result.trim());
};

/**
 * Path traversal protection with proper type checking
 * Addresses CodeQL: Type confusion through parameter tampering
 */
const validatePath = (req, res, next) => {
  const pathSources = [req.path, req.params.path, req.query.path];

  for (const path of pathSources) {
    if (path !== undefined && path !== null) {
      // Critical: Check type before string operations (fixes CodeQL type confusion)
      if (typeof path !== 'string') {
        return res.status(400).json({
          error: 'Invalid path type',
          message: 'Path must be a string'
        });
      }

      // Only proceed with string checks if path is confirmed to be a string
      if (path.includes('..') || path.includes('~') || path.includes('\0')) {
        return res.status(400).json({
          error: 'Invalid path',
          message: 'Path traversal attempts are not allowed'
        });
      }

      // Additional path validation using validator.js
      if (!validator.isLength(path, { min: 0, max: 1000 })) {
        return res.status(400).json({
          error: 'Invalid path length',
          message: 'Path length exceeds maximum allowed'
        });
      }
    }
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
 * Enhanced input validation rules using validator.js
 */
const validationRules = {
  // WebSocket message validation with enhanced security
  wsMessage: [
    body('type')
      .isString()
      .isLength({ min: 1, max: 50 })
      .matches(/^[a-zA-Z_-]+$/)
      .custom((value) => {
        // Additional sanitization using our secure function
        const sanitized = sanitizeString(value);
        if (sanitized !== value) {
          throw new Error('Message type contains invalid characters');
        }
        return true;
      }),
    body('data').optional().isObject(),
    body('timestamp').optional().isISO8601()
  ],

  // MCP configuration validation with type checking
  mcpConfig: [
    query('format')
      .optional()
      .custom((value) => {
        if (value !== undefined && typeof value !== 'string') {
          throw new Error('Format must be a string');
        }
        return validator.isIn(value || '', ['json', 'yaml']);
      }),
    query('version')
      .optional()
      .custom((value) => {
        if (value !== undefined && typeof value !== 'string') {
          throw new Error('Version must be a string');
        }
        return validator.matches(value || '', /^\d+\.\d+$/);
      })
  ],

  // Enhanced path parameters validation with type safety
  safePath: [
    param('path').optional().custom((value) => {
      // Type check first (addresses CodeQL type confusion)
      if (value !== undefined && typeof value !== 'string') {
        throw new Error('Path must be a string');
      }

      if (value) {
        // Use validator.js for length validation
        if (!validator.isLength(value, { min: 0, max: 1000 })) {
          throw new Error('Path length exceeds maximum allowed');
        }

        // Path traversal checks
        if (value.includes('..') || value.includes('~') || value.includes('\0')) {
          throw new Error('Invalid path detected');
        }

        // Additional security: check for encoded path traversal attempts
        const decoded = decodeURIComponent(value);
        if (decoded.includes('..') || decoded.includes('~')) {
          throw new Error('Encoded path traversal detected');
        }
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
