import { createProxyMiddleware } from 'http-proxy-middleware';
import config from './config.js';

/**
 * Build the `http-proxy-middleware` instance used to forward requests to the
 * correct Ollama backend.
 *
 * Design notes:
 *  - `target` is a required option but is overridden per-request by the
 *    `router` function which reads `req.ollamaTarget` (set by modelRouterMiddleware).
 *  - Because Express has already parsed the body (so we can read `req.body`),
 *    the raw stream is consumed.  The `on.proxyReq` hook re-serialises the
 *    body and writes it to the upstream request with correct Content-Length.
 *  - Ollama streams NDJSON for generate/chat.  `http-proxy-middleware` pipes
 *    the response stream transparently, so no special handling is needed here.
 *
 * @returns {import('http-proxy-middleware').RequestHandler}
 */
function buildProxy() {
  return createProxyMiddleware({
    // Placeholder – overridden dynamically by `router` below.
    target: 'http://localhost:11434',

    // app.use('/api', ...) strips the mount path from req.url before it reaches
    // this middleware. Use originalUrl so upstream still receives /api/... paths.
    pathRewrite: (_path, req) => req.originalUrl,

    /**
     * Dynamic router: return the Ollama base URL stored on the request by
     * modelRouterMiddleware.  Falls back to the placeholder target so the
     * proxy library does not throw when the field is absent (e.g. health checks).
     */
    router: (req) => req.ollamaTarget || 'http://localhost:11434',

    changeOrigin: true,
    preserveHeaderKeyCase: true,

    // Do NOT follow redirects from upstream
    followRedirects: false,

    on: {
      /**
       * Re-write the proxied request body.
       *
       * express.json() drains the original socket stream, so we must manually
       * push the buffered body into the outgoing proxy request.
       */
      proxyReq: (proxyReq, req) => {
        // Only re-write when we have a parsed body
        if (!req.body || Object.keys(req.body).length === 0) return;

        // Strip content-encoding so we don't accidentally send pre-encoded data
        proxyReq.removeHeader('content-encoding');

        const bodyData = JSON.stringify(req.body);
        proxyReq.setHeader('Content-Type', 'application/json');
        proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
        proxyReq.write(bodyData);
        proxyReq.end();
      },

      /**
       * Log upstream errors and return a clean JSON 502 to the client.
       */
      error: (err, req, res) => {
        console.error(
          `[proxy] upstream error for model="${req.ollamaModel}" target="${req.ollamaTarget}":`,
          err.message
        );

        // Guard against headers already sent (streaming response was started)
        if (res.headersSent) {
          res.end();
          return;
        }

        res.status(502).json({
          error: 'Bad Gateway',
          message: `Upstream Ollama instance error: ${err.message}`,
          target: req.ollamaTarget,
          model: req.ollamaModel,
        });
      },

      /**
       * Attach a log line when the proxy response begins.
       */
      proxyRes: (proxyRes, req) => {
        const level = proxyRes.statusCode >= 400 ? 'warn' : 'debug';
        if (process.env.LOG_LEVEL === 'debug' || level === 'warn') {
          console.log(
            `[proxy] ${req.method} ${req.path} → ${req.ollamaTarget}` +
              ` model=${req.ollamaModel || 'n/a'} status=${proxyRes.statusCode}`
          );
        }
      },
    },

    // Preserve the host header when configured
    ...(config.proxy.preserveHost ? { headers: { host: undefined } } : {}),
  });
}

export { buildProxy };
