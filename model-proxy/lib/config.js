import 'dotenv/config';
import { readFileSync } from 'fs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bool(envKey, defaultValue = false) {
  const val = process.env[envKey];
  if (val === undefined) return defaultValue;
  return val.toLowerCase() === 'true' || val === '1';
}

function int(envKey, defaultValue) {
  const val = parseInt(process.env[envKey], 10);
  return isNaN(val) ? defaultValue : val;
}

function required(envKey) {
  const val = process.env[envKey];
  if (!val) throw new Error(`Missing required environment variable: ${envKey}`);
  return val;
}

// ─── JWT public key / secret ──────────────────────────────────────────────────

function resolveJwtSecret() {
  if (process.env.JWT_PUBLIC_KEY_FILE) {
    try {
      return readFileSync(process.env.JWT_PUBLIC_KEY_FILE, 'utf8');
    } catch (err) {
      throw new Error(`Could not read JWT_PUBLIC_KEY_FILE: ${err.message}`);
    }
  }
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (bool('AUTH_ENABLED')) {
    throw new Error(
      'AUTH_ENABLED is true but neither JWT_SECRET nor JWT_PUBLIC_KEY_FILE is set.'
    );
  }
  return null;
}

// ─── Model routing ────────────────────────────────────────────────────────────
// Reads all MODEL_ROUTE_* env vars and builds a Map<modelAlias, url>.
// Keys starting with "DEFAULT" are treated as the fallback.

function buildRouteMap() {
  const map = new Map();
  let defaultUrl = null;

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('MODEL_ROUTE_')) continue;

    const names = key.slice('MODEL_ROUTE_'.length).split(':');

    for (const name of names) {
      if (name === 'DEFAULT') {
        defaultUrl = value;
      } else {
        map.set(name.toUpperCase(), value);
      }
    }
  }

  return { routeMap: map, defaultUrl };
}

// ─── Exported config ──────────────────────────────────────────────────────────

const { routeMap, defaultUrl } = buildRouteMap();

const config = {
  port: int('PORT', 11434),

  logger : {
    level : process.env.LOG_LEVEL || 'info',
    name : process.env.LOGGER_NAME || 'model-proxy',
  },

  auth: {
    enabled: bool('AUTH_ENABLED', false),
    secret: resolveJwtSecret(),
    algorithms: (process.env.JWT_ALGORITHMS || 'HS256')
      .split(',')
      .map(a => a.trim()),
  },

  session: {
    ttlSeconds: int('SESSION_TTL_SECONDS', 300),
    maxEntries: int('SESSION_MAX_ENTRIES', 1000),
  },

  routing: {
    hosts : process.env.OLLAMA_HOSTS.split(',').map(h => h.trim()),
    authKeys : process.env.API_KEYS ? Object.fromEntries(
      process.env.API_KEYS.split(',').map(pair => {
        const [host, key] = pair.split(':').map(s => s.trim());
        return [host, key];
      })
    ) : {},
    routeMap,   // Map<UPPERCASE_MODEL_NAME, ollamaBaseUrl>
    defaultUrl: defaultUrl || process.env.MODEL_ROUTE_DEFAULT || null,
    header: process.env.MODEL_HEADER || 'x-requested-model',
  },

  proxy: {
    bodyLimit: process.env.BODY_LIMIT || '50mb',
    preserveHost: bool('PROXY_PRESERVE_HOST', false),
  },
};

export default config;
