import jwt from 'jsonwebtoken';
import config from './config.js';
import session from './session.js';

/**
 * Extract the raw Bearer token from the Authorization header.
 * Returns null if the header is absent or malformed.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractToken(req) {
  const header = req.headers['authorization'] || req.headers['Authorization'];
  if (!header) return null;
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1];
}

/**
 * Verify a JWT and return the decoded payload.
 * Uses the session cache to avoid repeated crypto operations.
 *
 * Throws a descriptive Error on failure (expired, invalid sig, etc.).
 * @param {string} token
 * @returns {object} Decoded JWT payload
 */
function verifyToken(token) {
  // Check cache first
  const cached = session.get(token);
  if (cached) return cached;

  // Verify signature / expiry
  const payload = jwt.verify(token, config.auth.secret, {
    algorithms: config.auth.algorithms,
  });

  // Cache the decoded payload
  session.set(token, payload);
  return payload;
}

/**
 * Check whether the decoded payload has access to `modelName`.
 *
 * A user is authorised when:
 *  1. They have a role equal to the model name (case-insensitive), OR
 *  2. They have the 'admin' role.
 *
 * Roles are read from `payload.roles` (array of strings) or
 * `payload.role` (single string) – whichever is present.
 *
 * @param {object} payload  Decoded JWT payload
 * @param {string} modelName
 * @returns {boolean}
 */
function hasModelAccess(payload, modelName) {
  const roles = extractRoles(payload);
  const model = modelName.toLowerCase();
  return roles.some(r => r.toLowerCase() === 'admin' || r.toLowerCase() === model);
}

/**
 * Normalise the roles claim to an array of strings.
 * Supports: `roles: string[]`, `role: string`, or no roles claim.
 * @param {object} payload
 * @returns {string[]}
 */
function extractRoles(payload) {
  if (Array.isArray(payload.roles)) return payload.roles.map(String);
  if (typeof payload.roles === 'string') return payload.roles.split(',').map(r => r.trim());
  if (typeof payload.role === 'string') return [payload.role];
  return [];
}

// ─── Express middleware ───────────────────────────────────────────────────────

/**
 * Auth middleware factory.
 *
 * When `AUTH_ENABLED=false` this middleware is a no-op pass-through.
 *
 * On success it attaches `req.user` (decoded payload) and
 * `req.userRoles` (string[]) to the request for downstream use.
 *
 * @returns {import('express').RequestHandler}
 */
function authMiddleware() {
  if (!config.auth.enabled) {
    // Auth is off – pass through immediately
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
      });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      const message =
        err.name === 'TokenExpiredError'
          ? 'Token has expired'
          : err.name === 'JsonWebTokenError'
          ? `Invalid token: ${err.message}`
          : `Token verification failed: ${err.message}`;

      return res.status(401).json({ error: 'Unauthorized', message });
    }

    // Attach decoded identity for use in later middleware
    req.user = payload;
    req.userRoles = extractRoles(payload);
    next();
  };
}

/**
 * Model-access guard middleware.
 *
 * Must be placed AFTER body parsing so that `req.body` is available.
 * Reads `req.ollamaModel` (set by the router middleware) or falls back
 * to `req.body.model`.
 *
 * Skipped entirely when `AUTH_ENABLED=false`.
 *
 * @returns {import('express').RequestHandler}
 */
function modelAccessMiddleware() {
  if (!config.auth.enabled) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const modelName = req.ollamaModel || (req.body && req.body.model);

    // Routes that don't reference a model (e.g. /api/version) are open
    if (!modelName) return next();

    if (!hasModelAccess(req.user, modelName)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Your token does not grant access to model "${modelName}". Required role: "${modelName}" or "admin".`,
      });
    }

    next();
  };
}

export {
  authMiddleware,
  modelAccessMiddleware,
  verifyToken,
  hasModelAccess,
  extractRoles,
  extractToken,
};
