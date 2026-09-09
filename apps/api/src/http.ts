import type { FastifyRequest, FastifyReply } from 'fastify';

export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function matchesETag(
  header: string,
  current?: string,
  weak = false,
  exists = true,
): boolean {
  if (header.trim() === '*') return exists;
  let remainder = header.trim();
  const tags: string[] = [];
  let empty = 0;
  while (remainder) {
    // HTTP recipients tolerate a reasonable number of empty list members.
    if (remainder.startsWith(',')) {
      if (++empty > 32)
        throw new DomainError(
          400,
          'INVALID_PRECONDITION',
          'Слишком много пустых элементов в заголовке.',
        );
      remainder = remainder.slice(1).trim();
      continue;
    }
    const match = /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"/.exec(remainder);
    if (!match)
      throw new DomainError(400, 'INVALID_PRECONDITION', 'Некорректный условный заголовок.');
    tags.push(match[0]);
    remainder = remainder.slice(match[0].length).trim();
    if (remainder && !remainder.startsWith(','))
      throw new DomainError(400, 'INVALID_PRECONDITION', 'Некорректный условный заголовок.');
    if (remainder) remainder = remainder.slice(1).trim();
  }
  return (
    exists &&
    current !== undefined &&
    tags.some((tag) => (weak ? tag.replace(/^W\//, '') : tag) === current)
  );
}

export function preconditions(
  request: FastifyRequest,
  exists = true,
  etag?: string,
): 304 | undefined {
  const match = request.headers['if-match'];
  const none = request.headers['if-none-match'];
  if (match !== undefined && !matchesETag(match, etag, false, exists))
    throw new DomainError(412, 'PRECONDITION_FAILED', 'Условие If-Match не выполнено.');
  if (none !== undefined && matchesETag(none, etag, true, exists)) {
    if (request.method === 'GET' || request.method === 'HEAD') return 304;
    throw new DomainError(412, 'PRECONDITION_FAILED', 'Условие If-None-Match не выполнено.');
  }
}

export async function conditionalRead(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
) {
  if (
    !['GET', 'HEAD'].includes(request.method) ||
    reply.statusCode < 200 ||
    reply.statusCode >= 300
  )
    return payload;
  const value = reply.getHeader('ETag');
  if (preconditions(request, true, typeof value === 'string' ? value : undefined) === 304) {
    reply.code(304);
    // HEAD's final hook measures the original representation and removes its body.
    if (request.method === 'HEAD') return payload;
    if (typeof payload === 'string' || Buffer.isBuffer(payload))
      reply.header('Content-Length', Buffer.byteLength(payload));
    else reply.removeHeader('Content-Length');
    return null;
  }
  return payload;
}
