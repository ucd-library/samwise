import { PassThrough, Readable } from 'stream';
import config from './config.js';
import logger from './logger.js';
import { extractToken, hasModelAccess, verifyToken, extractRoles } from './auth.js';
import { resolveTarget } from './router.js';

const MODEL_REGEX = /"model"\s*:\s*"([^"]+)"/;
const MODEL_FREE_ROUTES = new Set([
  '/api/version',
  '/api/tags',
  '/api/ps',
]);
const DEFAULT_INSPECTION_LIMIT = 64 * 1024;

function copyRequestHeaders(req) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
      continue;
    }
    headers.set(key, String(value));
  }

  return headers;
}

function writeJson(res, status, payload) {
  if (res.headersSent) return;
  res.status(status).json(payload);
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) return value.map(v => String(v));
  return String(value);
}

function applyResponseHeaders(res, upstreamHeaders, extraHeaders) {
  for (const [key, value] of upstreamHeaders.entries()) {
    res.setHeader(key, value);
  }

  if (!extraHeaders) return;

  if (extraHeaders instanceof Headers) {
    for (const [key, value] of extraHeaders.entries()) {
      res.setHeader(key, value);
    }
    return;
  }

  for (const [key, value] of Object.entries(extraHeaders)) {
    if (value === undefined) continue;
    res.setHeader(key, normalizeHeaderValue(value));
  }
}

async function authorizeRequest(req) {
  if (!config.auth.enabled) return;

  const token = extractToken(req);
  if (!token) {
    const err = new Error('Missing or malformed Authorization header. Expected: Bearer <token>');
    err.status = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
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

    const authErr = new Error(message);
    authErr.status = 401;
    authErr.code = 'UNAUTHORIZED';
    throw authErr;
  }

  req.user = payload;
  req.userRoles = extractRoles(payload);
}

function createCombinedBodyStream(initialChunks, req, forwardStream) {
  for (const chunk of initialChunks) {
    forwardStream.write(chunk);
  }

  req.on('data', (chunk) => {
    forwardStream.write(chunk);
  });

  req.on('end', () => {
    forwardStream.end();
  });

  req.on('error', (err) => {
    forwardStream.destroy(err);
  });

  req.on('aborted', () => {
    forwardStream.destroy(new Error('Client request aborted'));
  });
}

function buildStreamingProxy({
  inspectLimit = DEFAULT_INSPECTION_LIMIT,
  injectResponseHeaders = () => undefined,
} = {}) {
  return async function streamingProxy(req, res) {
    const bodylessMethod = req.method === 'GET' || req.method === 'HEAD';
    const routeRequiresModel = !MODEL_FREE_ROUTES.has(req.originalUrl);
    const bufferedChunks = [];
    let bufferedBytes = 0;
    let inspectedText = '';
    let modelName = null;
    let resolved = false;

    const abortController = new AbortController();

    const abortUpstream = () => abortController.abort();
    req.on('aborted', abortUpstream);
    res.on('close', abortUpstream);

    try {
      if (bodylessMethod) {
        await authorizeRequest(req);
        req.ollamaModel = null;
        req.ollamaTarget = config.routing.defaultUrl;
      } else {
        while (!resolved) {
          const chunk = await new Promise((resolve, reject) => {
            req.once('data', resolve);
            req.once('end', () => resolve(null));
            req.once('error', reject);
            req.once('aborted', () => reject(new Error('Client request aborted')));
          });

          if (chunk === null) break;

          bufferedChunks.push(chunk);
          bufferedBytes += chunk.length;

          if (inspectedText.length < inspectLimit) {
            const remaining = inspectLimit - inspectedText.length;
            inspectedText += chunk.toString('utf8', 0, remaining);
            modelName ||= inspectedText.match(MODEL_REGEX)?.[1] || null;
          }

          if (modelName || bufferedBytes >= inspectLimit) {
            await authorizeRequest(req);

            if (modelName && config.auth.enabled && !hasModelAccess(req.user, modelName)) {
              const err = new Error(
                `Your token does not grant access to model "${modelName}". Required role: "${modelName}" or "admin".`
              );
              err.status = 403;
              err.code = 'FORBIDDEN';
              throw err;
            }

            if (!modelName && routeRequiresModel) {
              const err = new Error(
                `Could not resolve "model" from the first ${inspectLimit} bytes of the request body.`
              );
              err.status = 400;
              err.code = 'MODEL_NOT_FOUND';
              throw err;
            }

            const target = resolveTarget(modelName);

            if (!target) {
              const err = new Error(
                modelName
                  ? `No Ollama instance configured for model "${modelName}" and no default route is set.`
                  : 'No default Ollama instance is configured.'
              );
              err.status = 502;
              err.code = 'TARGET_NOT_FOUND';
              throw err;
            }

            logger.info(`proxying model=${modelName} to target=${target} from request body`);

            req.ollamaModel = modelName;
            req.ollamaTarget = target;
            resolved = true;
          }
        }

        if (!resolved) {
          await authorizeRequest(req);

          if (!modelName && routeRequiresModel) {
            const err = new Error('Request body ended before a "model" field could be read.');
            err.status = 400;
            err.code = 'MODEL_NOT_FOUND';
            throw err;
          }

          if (modelName && config.auth.enabled && !hasModelAccess(req.user, modelName)) {
            const err = new Error(
              `Your token does not grant access to model "${modelName}". Required role: "${modelName}" or "admin".`
            );
            err.status = 403;
            err.code = 'FORBIDDEN';
            throw err;
          }

          const target = resolveTarget(modelName);
          logger.info(`proxying model=${modelName} to target=${target} from request body`);
          if (!target) {
            const err = new Error(
              modelName
                ? `No Ollama instance configured for model "${modelName}" and no default route is set.`
                : 'No default Ollama instance is configured.'
            );
            err.status = 502;
            err.code = 'TARGET_NOT_FOUND';
            throw err;
          }

          req.ollamaModel = modelName;
          req.ollamaTarget = target;
        }
      }

      const targetUrl = new URL(req.originalUrl, req.ollamaTarget).toString();
      const headers = copyRequestHeaders(req);

      let requestBody;
      if (!bodylessMethod) {
        const forwardStream = new PassThrough();
        createCombinedBodyStream(bufferedChunks, req, forwardStream);
        requestBody = forwardStream;
      }

      const upstreamResponse = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: requestBody,
        duplex: requestBody ? 'half' : undefined,
        redirect: 'manual',
        signal: abortController.signal,
      });

      const extraHeaders = await injectResponseHeaders({
        req,
        res,
        upstreamResponse,
        model: req.ollamaModel,
        target: req.ollamaTarget,
      });

      res.status(upstreamResponse.status);
      applyResponseHeaders(res, upstreamResponse.headers, extraHeaders);

      if (!upstreamResponse.body || req.method === 'HEAD') {
        res.end();
        return;
      }

      Readable.fromWeb(upstreamResponse.body).on('error', (err) => {
        if (!res.headersSent) {
          writeJson(res, 502, {
            error: 'Bad Gateway',
            message: `Upstream response stream error: ${err.message}`,
            target: req.ollamaTarget,
            model: req.ollamaModel,
          });
          return;
        }
        res.destroy(err);
      }).pipe(res);
    } catch (err) {
      abortUpstream();

      const status = err.status || (err.name === 'AbortError' ? 499 : 502);
      const message =
        err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN' || err.code === 'MODEL_NOT_FOUND'
          ? err.message
          : `Upstream request failed: ${err.message}`;

      writeJson(res, status, {
        error:
          status === 401
            ? 'Unauthorized'
            : status === 403
            ? 'Forbidden'
            : status === 400
            ? 'Bad Request'
            : status === 499
            ? 'Client Closed Request'
            : 'Bad Gateway',
        message,
        target: req.ollamaTarget || null,
        model: req.ollamaModel || modelName,
      });
    } finally {
      req.off('aborted', abortUpstream);
      res.off('close', abortUpstream);
    }
  };
}

export { buildStreamingProxy };
