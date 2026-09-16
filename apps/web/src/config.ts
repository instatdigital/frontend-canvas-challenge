const DEFAULT_API_URL = 'http://127.0.0.1:4001';

const rawBaseUrl = import.meta.env?.VITE_API_URL?.trim() || DEFAULT_API_URL;

export const API_BASE_URL = rawBaseUrl.replace(/\/+$/, '');
