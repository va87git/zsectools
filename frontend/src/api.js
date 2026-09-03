// Dynamic API Base URL resolution:
// Uses VITE_API_BASE if provided (mandatory for Docker).
// Otherwise, dynamically fallbacks to current hostname on port 3000 (Windows Native: Local or Remote LAN).
export const API_BASE = import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:3000`;

export async function fetchJson(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return body;
}
