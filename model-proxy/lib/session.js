import config from './config.js';

/**
 * Minimal TTL-based in-memory session cache.
 *
 * Stores decoded JWT payloads keyed by the raw token string so that
 * verification (crypto) only runs once per unique token within its TTL window.
 *
 * The cache is intentionally simple:
 *  - Entries expire after `session.ttlSeconds`.
 *  - When the cache grows beyond `session.maxEntries` the oldest 10 % of
 *    entries are evicted to bound memory usage.
 */

const { ttlSeconds, maxEntries } = config.session;

class SessionStore {
  constructor() {
    /** @type {Map<string, { payload: object, expiresAt: number }>} */
    this._store = new Map();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Retrieve a cached session payload for `token`.
   * Returns `null` if not found or expired.
   * @param {string} token
   * @returns {object|null}
   */
  get(token) {
    const entry = this._store.get(token);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this._store.delete(token);
      return null;
    }

    return entry.payload;
  }

  /**
   * Cache `payload` for `token`.
   * TTL is taken from the JWT `exp` claim when present; otherwise falls back
   * to the configured `SESSION_TTL_SECONDS`.
   * @param {string} token
   * @param {object} payload  Decoded JWT payload
   */
  set(token, payload) {
    if (ttlSeconds === 0) return; // cache disabled

    let expiresAt;
    if (payload.exp && typeof payload.exp === 'number') {
      // Honour JWT expiry but cap at configured TTL
      const jwtMs = payload.exp * 1000;
      const configMs = Date.now() + ttlSeconds * 1000;
      expiresAt = Math.min(jwtMs, configMs);
    } else {
      expiresAt = Date.now() + ttlSeconds * 1000;
    }

    this._store.set(token, { payload, expiresAt });
    this._evictIfNeeded();
  }

  /**
   * Explicitly invalidate a cached session (e.g. on logout).
   * @param {string} token
   */
  delete(token) {
    this._store.delete(token);
  }

  /** Remove all expired entries. */
  purgeExpired() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) this._store.delete(key);
    }
  }

  get size() {
    return this._store.size;
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  _evictIfNeeded() {
    if (this._store.size <= maxEntries) return;

    // Evict oldest 10 % to avoid evicting on every single write near the limit
    const evictCount = Math.max(1, Math.floor(maxEntries * 0.1));
    let removed = 0;
    for (const key of this._store.keys()) {
      this._store.delete(key);
      removed++;
      if (removed >= evictCount) break;
    }
  }
}

// Singleton – one store shared across the whole process
const store = new SessionStore();

// Periodic cleanup to free memory from naturally-expired sessions
if (ttlSeconds > 0) {
  const intervalMs = Math.max(60_000, ttlSeconds * 1000);
  setInterval(() => store.purgeExpired(), intervalMs).unref();
}

export default store;
