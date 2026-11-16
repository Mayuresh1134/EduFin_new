// Talks to the Flask API and keeps the login token.

const KEY = 'edufin_token';

// "Remember me" keeps the token after the browser closes; otherwise it lasts for this tab only.
export const tokenStore = {
  get: () => localStorage.getItem(KEY) || sessionStorage.getItem(KEY),
  remembered: () => Boolean(localStorage.getItem(KEY)),
  set(token, remember) {
    this.clear();
    (remember ? localStorage : sessionStorage).setItem(KEY, token);
  },
  clear() {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  },
};

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and that the backend is running.", 0);
  }
  const data = await res.json().catch(() => null);

  if (res.status === 401 && token && !path.startsWith('/auth/')) {
    tokenStore.clear();
    window.dispatchEvent(new Event('edufin:signed-out'));
  }
  if (!res.ok) {
    const fallback = res.status >= 500
      ? "The server isn't responding. Is the backend running on port 5050?"
      : `Request failed (${res.status})`;
    throw new ApiError(data?.error || fallback, res.status);
  }
  return data;
}

const pad = (n) => String(n).padStart(2, '0');

// The user's own calendar date, which is what "today" means for coins and budgets.
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
