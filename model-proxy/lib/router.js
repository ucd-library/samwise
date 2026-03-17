import config from './config.js';

/**
 * Resolve the target Ollama base URL for a given model name.
 *
 * Lookup order:
 *  1. Exact (case-insensitive) match in the MODEL_ROUTE_* env map.
 *  2. Prefix match – useful for versioned model names like "llama3.2:8b"
 *     where the env key is "LLAMA3.2" or just "LLAMA3".
 *  3. `MODEL_ROUTE_DEFAULT` fallback.
 *
 * Returns `null` when no route (including no default) is configured.
 *
 * @param {string} modelName  Raw model name from the request body (e.g. "llama3.2:8b").
 * @returns {string|null}  Base URL of the target Ollama instance.
 */
function resolveTarget(modelName) {
  if (!modelName) return defaultUrl;

  modelName = modelName.toUpperCase();

  const { routeMap, defaultUrl } = config.routing;

  // Normalise: strip tag/version suffix for map lookup (keep for logging)
  // const [baseName] = modelName.split(':');
  // const key = baseName.toUpperCase();


  // 1. Exact match
  if (routeMap.has(modelName)) return routeMap.get(modelName);

  // // 2. Prefix match (longest wins)
  // let bestMatch = null;
  // let bestLen = 0;
  // for (const [routeKey, url] of routeMap) {
  //   if (modelName.startsWith(routeKey) && routeKey.length > bestLen) {
  //     bestMatch = url;
  //     bestLen = routeKey.length;
  //     console.log(`Prefix match: ${modelName} starts with ${routeKey}, route to ${url}`);
  //   }
  // }
  // if (bestMatch) return bestMatch;

  // 3. Default
  return defaultUrl;
}

/**
 * @function extractModel
 * @description
 * Extract the model name from an incoming Ollama API request.
 *
 * The model is present in `x-requested-model` for most endpoints.
 * We also handle the unlikely edge case where it is absent (e.g. /api/version).
 *
 * @param {import('express').Request} req  Express request object.
 * @returns {string|null}
 */
function extractModel(req) {

  return new Promise((resolve) => {
    req.body.once('data', chunk => {
      chunk = chunk.toString();
      resolve(chunk.match(/"model"\s*:\s*"([^"]+)"/)?.[1] || null);
    });
  });
}

/**
 * Express middleware that:
 *  - Reads the model from the request body.
 *  - Resolves the target Ollama instance URL.
 *  - Attaches `req.ollamaModel` and `req.ollamaTarget` for downstream use.
 *  - Returns 400 when the model is required but missing.
 *  - Returns 502 when no target can be resolved.
 *
 * Body-parser middleware must run before this.
 *
 * @returns {import('express').RequestHandler}
 */
function modelRouterMiddleware() {
  // Paths where a model body field is not expected
  const modelFreeRoutes = new Set([
    '/api/version',
    '/api/tags',
    '/api/ps',
  ]);

  return (req, res, next) => {
    const modelFree = modelFreeRoutes.has(req.originalUrl);
    const model = extractModel(req);


    if (!modelFree && !model) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Request headers must include a "${config.routing.header}".`,
      });
    }

    const target = resolveTarget(model);

    if (!target) {
      return res.status(502).json({
        error: 'Bad Gateway',
        message: model
          ? `No Ollama instance configured for model "${model}" and no default route is set.`
          : 'No default Ollama instance is configured.',
      });
    }

    req.ollamaModel = model;
    req.ollamaTarget = target;

    next();
  };
}

export {
  resolveTarget,
  extractModel,
  modelRouterMiddleware,
};
