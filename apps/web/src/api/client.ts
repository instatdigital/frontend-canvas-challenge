import { API_BASE_URL } from '../config';
import { ApiError, httpFallbackMessage, parseError, toApiError } from './errors';

export type ApiMethod = 'GET' | 'POST' | 'PUT';

export type ApiRequestOptions = {
  method?: ApiMethod;
  headers?: Record<string, string>;
  body?: unknown;
  expect?: readonly number[];
  signal?: AbortSignal;
};

export type ApiResponse<T> = {
  data: T;
  status: number;
  headers: Headers;
};

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', headers = {}, body, expect = [200], signal } = options;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...headers,
        ...(body === undefined ? null : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? null : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw toApiError(error);
  }
  if (!expect.includes(response.status)) throw await readHttpError(response);
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw toApiError(error);
  }
  return { data: parseBody(text) as T, status: response.status, headers: response.headers };
}

async function readHttpError(response: Response): Promise<ApiError> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const parsed = JSON.parse(await response.text()) as {
      error?: { code?: unknown; message?: unknown };
    };
    if (typeof parsed.error?.code === 'string') code = parsed.error.code;
    if (typeof parsed.error?.message === 'string') message = parsed.error.message;
  } catch {}
  return new ApiError({
    kind: 'http',
    status: response.status,
    code,
    requestId: response.headers.get('x-request-id') ?? undefined,
    message: message ?? httpFallbackMessage(response.status),
  });
}

function parseBody(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    throw parseError();
  }
}
