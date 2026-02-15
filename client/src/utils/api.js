import axios from 'axios';
import { auth } from '../firebase';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

/**
 * Get the current user's Firebase ID token for API authentication
 */
export async function getAuthToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

/**
 * Axios instance that automatically attaches the Firebase ID token to requests
 */
const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to every request
api.interceptors.request.use(
  async (config) => {
    const token = await getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Handle 401 responses (e.g. token expired)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token might be expired - could trigger re-auth flow
      console.warn('API request unauthorized - token may have expired');
    }
    return Promise.reject(error);
  }
);

/**
 * Stream a query response - calls onChunk for each text chunk, onDone with sources
 */
export async function streamQuery(question, chatId, { onChunk, onDone, onError }) {
  const token = await getAuthToken();
  const url = `${API_URL}/query-stream`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ question, chatId }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || response.statusText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'chunk' && data.content) onChunk?.(data.content);
          if (data.type === 'done') onDone?.(data.sources || []);
          if (data.type === 'error') onError?.(new Error(data.error));
        } catch (_) {}
      }
    }
  }
  if (buffer.startsWith('data: ')) {
    try {
      const data = JSON.parse(buffer.slice(6));
      if (data.type === 'done') onDone?.(data.sources || []);
    } catch (_) {}
  }
}

export default api;
export { API_URL };
