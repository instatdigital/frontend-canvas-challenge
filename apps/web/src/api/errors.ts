export type ApiErrorKind = 'network' | 'http' | 'parse' | 'aborted';

type ApiErrorFields = {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  code?: string;
  requestId?: string;
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(fields: ApiErrorFields) {
    super(fields.message);
    this.name = 'ApiError';
    this.kind = fields.kind;
    this.status = fields.status;
    this.code = fields.code;
    this.requestId = fields.requestId;
  }
}

export function abortError(): ApiError {
  return new ApiError({ kind: 'aborted', message: 'Запрос отменён.' });
}

export function networkError(): ApiError {
  return new ApiError({
    kind: 'network',
    message: 'Нет связи с сервером. Проверьте, что API запущен.',
  });
}

export function parseError(): ApiError {
  return new ApiError({ kind: 'parse', message: 'Сервер вернул некорректный ответ.' });
}

export function httpFallbackMessage(status: number): string {
  return `Сервер вернул ошибку ${status}.`;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') return abortError();
  return networkError();
}

export function isAborted(error: unknown): boolean {
  return toApiError(error).kind === 'aborted';
}
