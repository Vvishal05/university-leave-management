const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function api(path, { token, method = 'GET', body, formData } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(!formData && body ? { 'Content-Type': 'application/json' } : {})
        },
        body: formData || (body ? JSON.stringify(body) : undefined)
      });
      if (response.status === 204) return null;
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'The request could not be completed.');
      return payload;
    } catch (err) {
      lastError = err;
      // Only retry on network errors (Failed to fetch / CORS / timeout), not on
      // application-level errors that already have a parsed message from the server.
      const isNetworkError = err.message === 'Failed to fetch' || err.message === 'NetworkError when attempting to fetch resource.' || err.name === 'TypeError';
      if (isNetworkError && attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      break;
    }
  }
  // Provide a friendlier message for network / CORS failures
  if (lastError && (lastError.message === 'Failed to fetch' || lastError.message === 'NetworkError when attempting to fetch resource.' || lastError.name === 'TypeError')) {
    throw new Error('Unable to reach the server. It may be starting up — please wait a moment and try again.');
  }
  throw lastError;
}
