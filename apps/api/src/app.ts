import { preconditions, conditionalRead } from './http.js';
import Fastify, { type FastifyRequest, type FastifyReply, type HTTPMethods } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { Type, type TSchema } from '@sinclair/typebox';
import * as C from '@canvas/contracts';
import { Store, DomainError, matchesETag } from './store.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawJson: string;
  }
}
type Request = FastifyRequest<{ Params: Record<string, string>; Body: unknown }>;
type Options = {
  dataFile?: string;
  generationDelayMs?: number;
  now?: () => number;
  logger?: boolean;
  corsOrigins?: string[];
};
type Route = {
  current?: (request: Request) => boolean;
  id: string;
  summary: string;
  tag: string;
  body?: TSchema;
  params?: TSchema;
  headers?: TSchema;
  data: TSchema;
  statuses?: number[];
  errors?: Record<number, string>;
  description?: string;
  graph?: boolean;
};
const idParams = C.object({ spaceId: C.Id });
const jobParams = C.object({ spaceId: C.Id, generationId: C.Id });
const headers = { 'X-Request-Id': Type.String(), 'Cache-Control': Type.String() };
const demoSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#b6cce7"/><stop offset="1" stop-color="#f3dfc1"/></linearGradient></defs><rect width="800" height="600" fill="url(#sky)"/><circle cx="590" cy="165" r="64" fill="#fff3c4"/><path d="M0 480L260 160 550 600H0" fill="#526f69"/><path d="M210 600L555 260 800 520V600" fill="#73968b"/><path d="M0 525Q260 475 800 550V600H0" fill="#c4d2c2"/></svg>';

export async function buildApp(options: Options = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 65536,
    genReqId: () => randomUUID(),
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  const store = new Store(options.dataFile, options.generationDelayMs ?? 1500, options.now);
  app.decorateRequest('rawJson', '');
  // Preserve the graph representation byte for byte so PUT can return its strong ETag.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    if (!isUtf8(body as Buffer))
      return done(new DomainError(400, 'INVALID_UTF8', 'JSON должен быть в UTF-8.'));
    request.rawJson = (body as Buffer).toString('utf8');
    try {
      done(null, JSON.parse(request.rawJson));
    } catch {
      done(new DomainError(400, 'INVALID_JSON', 'Некорректный JSON.'));
    }
  });
  const allow = (url: string) => {
    const path = url.split('?')[0];
    const supported: HTTPMethods[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'TRACE'];
    const found = supported.filter((method) => app.findRoute({ method, url: path }));
    return found.length ? [...found, 'OPTIONS'].sort() : undefined;
  };
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id).header('Cache-Control', 'no-store');
  });
  await app.register(cors, {
    origin(origin, callback) {
      callback(
        null,
        !origin ||
          /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) ||
          Boolean(options.corsOrigins?.includes(origin)),
      );
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'If-Match', 'If-None-Match', 'Idempotency-Key'],
    exposedHeaders: ['ETag', 'Location', 'Retry-After', 'Allow', 'X-Request-Id', 'Accept-Encoding'],
    preflightContinue: true,
    strictPreflight: false,
  });
  app.addHook('onRequest', async (request, reply) => {
    const methods = allow(request.url);
    if (request.method === 'OPTIONS') {
      if (request.url === '*')
        return reply.header('Allow', 'GET, HEAD, POST, PUT, OPTIONS').code(204).send();
      if (!methods) throw new DomainError(404, 'ROUTE_NOT_FOUND', 'Маршрут не найден.');
      reply.header('Allow', methods.join(', '));
      if (request.headers.origin) reply.header('Access-Control-Allow-Methods', methods.join(', '));
      return reply.code(204).send();
    }
    if (methods && !methods.includes(request.method)) {
      reply.header('Allow', methods.join(', '));
      throw new DomainError(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается для этого адреса.');
    }
    const hasBody =
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding'] !== undefined;
    if (['GET', 'HEAD'].includes(request.method) && hasBody)
      throw new DomainError(400, 'REQUEST_BODY_NOT_ALLOWED', 'Этот запрос не принимает тело.');
    if (
      hasBody &&
      request.headers['content-encoding'] !== undefined &&
      request.headers['content-encoding'].trim().toLowerCase() !== 'identity'
    ) {
      reply.header('Accept-Encoding', 'identity');
      throw new DomainError(
        415,
        'UNSUPPORTED_CONTENT_ENCODING',
        'Сжатое тело запроса не поддерживается.',
      );
    }
    if (
      ['POST', 'PUT'].includes(request.method) &&
      hasBody &&
      request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json'
    )
      throw new DomainError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Ожидается application/json.');
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (
      /^\/api(?:\/|$)/.test(request.url.split('?')[0]) ||
      request.url.split('?')[0] === '/assets/demo.svg'
    )
      return conditionalRead(request, reply, payload);
    return payload;
  });
  app.addSchema({ $id: 'ErrorResponse', ...C.ErrorResponse });
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Canvas API',
        version: '1.0.0',
        description:
          'Локальный API для рабочего пространства с нодами. Авторизация не нужна. GET графа возвращает ETag; PUT требует If-Match. Ответы содержат сам ресурс, без обёртки data. Генерация имитируется.',
      },
      servers: [{ url: '/' }],
      tags: ['API', 'Spaces', 'Graph', 'Generations', 'Assets', 'HTTP'].map((name) => ({ name })),
    },
    transformObject(document) {
      if (!('openapiObject' in document)) return document.swaggerObject;
      const doc = document.openapiObject;
      const asset = doc.paths?.['/assets/demo.svg']?.get;
      if (asset) {
        asset.responses['304'] = {
          description: 'Без тела.',
          headers: {
            'Cache-Control': { schema: { type: 'string' } },
            'X-Request-Id': { schema: { type: 'string' } },
          },
        };
        for (const [status, description] of Object.entries({
          400: 'Некорректный запрос.',
          412: 'PRECONDITION_FAILED.',
          500: 'Внутренняя ошибка.',
        })) {
          asset.responses[status] = {
            description,
            content: { 'application/json': { schema: C.ErrorResponse } },
          };
        }
      }
      for (const path of Object.values(doc.paths ?? {})) {
        if (!path) continue;
        const base = path.get ?? path.post ?? path.put;
        if (path.get)
          path.head = {
            ...path.get,
            operationId: `head_${path.get.operationId}`,
            summary: `Заголовки: ${path.get.summary}`,
            responses: Object.fromEntries(
              Object.entries(path.get.responses).map(([status, response]) => {
                const value = { ...response };
                if ('content' in value) delete value.content;
                return [status, value];
              }),
            ),
          };
        path.options = {
          operationId: `options_${base?.operationId}`,
          tags: ['HTTP'],
          summary: 'Разрешённые методы',
          responses: {
            '204': {
              description: 'Без тела.',
              headers: {
                Allow: { schema: { type: 'string' } },
                'X-Request-Id': { schema: { type: 'string' } },
                'Cache-Control': { schema: { type: 'string' } },
              },
            },
          },
        };
      }
      return doc;
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list' },
    staticCSP: true,
  });
  app.setErrorHandler((error, request, reply) => {
    const value = error as Error & { validation?: unknown; statusCode?: number };
    const status =
      error instanceof DomainError
        ? error.status
        : value.validation
          ? 400
          : value.statusCode && value.statusCode < 500
            ? value.statusCode
            : 500;
    const code =
      error instanceof DomainError
        ? error.code
        : value.validation
          ? 'VALIDATION_ERROR'
          : status === 413
            ? 'PAYLOAD_TOO_LARGE'
            : status === 415
              ? 'UNSUPPORTED_MEDIA_TYPE'
              : status === 400
                ? 'INVALID_REQUEST'
                : 'INTERNAL_ERROR';
    if (status === 500) request.log.error({ err: error }, 'Request failed');
    reply.removeHeader('ETag').removeHeader('Location').removeHeader('Retry-After');
    reply
      .header('Cache-Control', 'no-store')
      .code(status)
      .send({
        error: {
          code,
          message:
            error instanceof DomainError
              ? error.message
              : status === 500
                ? 'Не удалось выполнить запрос.'
                : 'Проверьте формат и поля запроса.',
        },
      });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: 'Маршрут не найден.' } }),
  );
  app.get('/', { schema: { hide: true } }, (_r, reply) => reply.redirect('/docs/'));
  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  function add(
    method: HTTPMethods,
    url: string,
    route: Route,
    handler: (request: Request, reply: FastifyReply) => unknown,
  ) {
    const responses: Record<string, unknown> = {};
    for (const status of route.statuses ?? [200])
      responses[status] = {
        ...route.data,
        description:
          status === 201
            ? 'Ресурс создан.'
            : status === 202
              ? 'Обработка продолжается.'
              : 'Текущее представление ресурса.',
        headers: {
          ...headers,
          ...(route.graph ? { ETag: Type.String() } : {}),
          ...([201, 202].includes(status) ? { Location: Type.String() } : {}),
          ...(status === 202 ? { 'Retry-After': Type.String() } : {}),
        },
      };
    if (method === 'GET')
      responses[304] = {
        type: 'null',
        description: 'Условие If-None-Match совпало; без тела.',
        headers: { ...headers, ...(route.graph ? { ETag: Type.String() } : {}) },
      };
    const errors = {
      400: 'Некорректные поля, JSON или заголовки.',
      412: 'PRECONDITION_FAILED: условие запроса не выполнено.',
      500: 'INTERNAL_ERROR.',
      ...(route.body
        ? {
            413: 'PAYLOAD_TOO_LARGE: максимум 64 КБ.',
            415: 'UNSUPPORTED_MEDIA_TYPE или UNSUPPORTED_CONTENT_ENCODING.',
          }
        : {}),
      ...route.errors,
    };
    for (const [status, description] of Object.entries(errors))
      responses[status] = {
        $ref: 'ErrorResponse#',
        description,
        headers: {
          ...headers,
          ...(status === '415'
            ? {
                'Accept-Encoding': Type.String({
                  description: 'Только при неподдерживаемом Content-Encoding: identity.',
                }),
              }
            : {}),
        },
      };
    app.route({
      method,
      url,
      schema: {
        operationId: route.id,
        summary: route.summary,
        tags: [route.tag],
        description: route.description,
        ...(route.body ? { body: route.body } : {}),
        ...(route.params ? { params: route.params } : {}),
        headers: Type.Object({
          'if-match': Type.Optional(
            Type.String({
              description:
                'Условие для ресурса по адресу запроса. ETag выдаётся только там, где указан в ответе.',
            }),
          ),
          'if-none-match': Type.Optional(
            Type.String({ description: 'Совпадение: 304 для GET/HEAD, 412 для изменения.' }),
          ),
          ...(route.headers?.properties ?? {}),
        }),
        response: responses,
      },
      preHandler: async (request) => {
        if (!['GET', 'HEAD'].includes(request.method) && !route.graph) {
          // Look up parent/item before conditions so a missing resource stays 404.
          if (
            request.headers['if-match'] !== undefined ||
            request.headers['if-none-match'] !== undefined
          )
            preconditions(request, route.current?.(request as Request) ?? true);
        }
      },
      handler,
    });
  }
  add(
    'GET',
    '/api',
    {
      id: 'getApi',
      summary: 'Ресурсы API',
      tag: 'API',
      data: C.object({ version: Type.String(), links: C.Links }),
    },
    async () => ({
      version: '1.0.0',
      links: {
        spaces: { href: '/api/spaces', method: 'GET' },
        createSpace: { href: '/api/spaces', method: 'POST' },
        config: { href: '/api/config', method: 'GET' },
        contract: { href: '/openapi.json', method: 'GET' },
      },
    }),
  );
  add(
    'GET',
    '/api/config',
    { id: 'getConfig', summary: 'Параметры тестового', tag: 'API', data: C.Config },
    async () => ({
      debounceMs: 500,
      pollIntervalMs: 500,
      generationDelayMs: store.delayMs,
      maxNodes: 20,
      maxEdges: 20,
      nodeTypes: ['prompt', 'generator', 'result'],
      links: { self: { href: '/api/config', method: 'GET' } },
    }),
  );
  add(
    'GET',
    '/api/spaces',
    { id: 'listSpaces', summary: 'Рабочие пространства', tag: 'Spaces', data: Type.Array(C.Space) },
    async () => store.spaces(),
  );
  add(
    'POST',
    '/api/spaces',
    {
      id: 'createSpace',
      summary: 'Создать рабочее пространство',
      tag: 'Spaces',
      body: C.SpaceInput,
      data: C.Space,
      statuses: [201],
    },
    (r, p) => {
      const space = store.createSpace((r.body as { title: string }).title);
      return p.header('Location', space.links.self.href).code(201).send(space);
    },
  );
  add(
    'GET',
    '/api/spaces/:spaceId',
    {
      id: 'getSpace',
      summary: 'Рабочее пространство',
      tag: 'Spaces',
      params: idParams,
      data: C.Space,
      errors: { 404: 'SPACE_NOT_FOUND.' },
    },
    async (r) => store.space(r.params.spaceId),
  );
  add(
    'GET',
    '/api/spaces/:spaceId/graph',
    {
      id: 'getGraph',
      summary: 'Граф и его ETag',
      tag: 'Graph',
      params: idParams,
      data: C.Graph,
      graph: true,
      headers: Type.Object({
        'if-none-match': Type.Optional(Type.String()),
        'if-match': Type.Optional(Type.String()),
      }),
      errors: { 404: 'SPACE_NOT_FOUND.', 412: 'GRAPH_VERSION_CONFLICT.' },
      description:
        'Сохранённые nodes, edges и viewport. If-None-Match позволяет получить 304 без тела. Сильный ETag относится только к этому ресурсу.',
    },
    (r, p) => {
      const graph = store.graph(r.params.spaceId);
      p.header('ETag', graph.etag).header('Cache-Control', 'private, no-cache');
      if (
        r.headers['if-match'] !== undefined &&
        !matchesETag(r.headers['if-match'] as string, graph.etag)
      )
        throw new DomainError(412, 'GRAPH_VERSION_CONFLICT', 'Граф изменился.');
      return p.type('application/json; charset=utf-8').send(graph.raw);
    },
  );
  add(
    'PUT',
    '/api/spaces/:spaceId/graph',
    {
      id: 'replaceGraph',
      summary: 'Заменить граф целиком',
      tag: 'Graph',
      params: idParams,
      body: C.Graph,
      headers: C.GraphHeaders,
      data: C.Graph,
      graph: true,
      errors: {
        404: 'SPACE_NOT_FOUND.',
        412: 'GRAPH_VERSION_CONFLICT.',
        422: 'INVALID_GRAPH.',
        428: 'PRECONDITION_REQUIRED.',
      },
      description:
        'Передайте весь граф и If-Match из предыдущего GET/PUT. Ответ содержит тот же JSON и новый ETag. Идентичный повтор с актуальным ETag не меняет данные.',
    },
    (r, p) => {
      if (r.headers['if-none-match'] !== undefined) {
        const graph = store.graph(r.params.spaceId);
        if (r.headers['if-match'] === undefined)
          throw new DomainError(428, 'PRECONDITION_REQUIRED', 'Передайте If-Match.');
        if (!matchesETag(r.headers['if-match'] as string, graph.etag))
          throw new DomainError(412, 'GRAPH_VERSION_CONFLICT', 'Граф изменился.');
        if (matchesETag(r.headers['if-none-match'] as string, graph.etag, true))
          throw new DomainError(412, 'GRAPH_VERSION_CONFLICT', 'Условие сохранения не выполнено.');
      }
      const graph = store.saveGraph(
        r.params.spaceId,
        r.rawJson,
        r.headers['if-match'] as string | undefined,
      );
      return p.header('ETag', graph.etag).type('application/json; charset=utf-8').send(graph.raw);
    },
  );
  add(
    'GET',
    '/api/spaces/:spaceId/generations',
    {
      id: 'listGenerations',
      summary: 'Генерации пространства',
      tag: 'Generations',
      params: idParams,
      data: Type.Array(C.Generation),
      errors: { 404: 'SPACE_NOT_FOUND.' },
    },
    async (r) => store.generations(r.params.spaceId),
  );
  add(
    'POST',
    '/api/spaces/:spaceId/generations',
    {
      id: 'createGeneration',
      current: (r) => Boolean(store.space(r.params.spaceId)),
      summary: 'Создать генерацию',
      tag: 'Generations',
      params: idParams,
      body: C.GenerationInput,
      headers: C.IdempotencyHeaders,
      data: C.Generation,
      statuses: [200, 201, 202],
      errors: {
        404: 'SPACE_NOT_FOUND.',
        409: 'GRAPH_CHANGED, GENERATION_IN_PROGRESS или IDEMPOTENCY_CONFLICT.',
        422: 'GENERATOR_REQUIRED или INCOMPLETE_CHAIN.',
      },
      description:
        'Сначала завершите сохранение графа. graphETag в теле указывает снимок графа; If-Match здесь не используется. processing: 202 с Location и Retry-After; мгновенное создание: 201; завершённый повтор по ключу: 200.',
    },
    (r, p) => {
      const value = store.createGeneration(
        r.params.spaceId,
        r.body as C.GenerationRequest,
        r.headers['idempotency-key'] as string,
      );
      const status = value.data.status === 'processing' ? 202 : value.created ? 201 : 200;
      if (status !== 200) p.header('Location', value.data.links.self.href);
      if (status === 202) p.header('Retry-After', '1');
      return p.code(status).send(value.data);
    },
  );
  add(
    'GET',
    '/api/spaces/:spaceId/generations/:generationId',
    {
      id: 'getGeneration',
      summary: 'Статус и результат генерации',
      tag: 'Generations',
      params: jobParams,
      data: C.Generation,
      errors: { 404: 'SPACE_NOT_FOUND или GENERATION_NOT_FOUND.' },
    },
    async (r) => store.generation(r.params.spaceId, r.params.generationId),
  );
  app.get(
    '/assets/demo.svg',
    {
      schema: {
        operationId: 'getDemoImage',
        headers: Type.Object({
          'if-match': Type.Optional(Type.String()),
          'if-none-match': Type.Optional(Type.String()),
        }),
        summary: 'Тестовое изображение',
        tags: ['Assets'],
        produces: ['image/svg+xml'],
        response: { 200: { type: 'string', description: 'Локальное SVG-изображение.' } },
      },
    },
    (_r, p) =>
      p.header('Cache-Control', 'public, max-age=3600').type('image/svg+xml').send(demoSvg),
  );
  await app.ready();
  return app;
}
