const validKey = process.env.OPENAI_API_KEY ?? 'dev-local';

/**
 * Local-dev token plugin. Validates the Bearer token against OPENAI_API_KEY.
 * Allows Open-WebUI's unauthenticated model-listing requests to pass through.
 *
 * @param {string} token
 * @returns {{ identity: string, email: string|null }}
 */
export function authenticate(token) {
  if (token !== validKey) throw new Error('invalid token');
  return { identity: 'open-webui', email: null };
}
