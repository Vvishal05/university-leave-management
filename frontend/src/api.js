const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export async function api(path, { token, method = 'GET', body, formData } = {}) {
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
}
