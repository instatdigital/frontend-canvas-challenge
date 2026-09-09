import { Type, type Static, type TSchema } from '@sinclair/typebox';

export const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
export const Id = Type.String({ format: 'uuid' });
const Label = Type.String({ minLength: 1, maxLength: 80, pattern: '\\S' });
const Position = object({
  x: Type.Number({ minimum: -10000, maximum: 10000 }),
  y: Type.Number({ minimum: -10000, maximum: 10000 }),
});
export const Node = Type.Union([
  object({
    id: Id,
    type: Type.Literal('prompt'),
    position: Position,
    data: object({ text: Type.String({ maxLength: 2000 }) }),
  }),
  object({
    id: Id,
    type: Type.Literal('generator'),
    position: Position,
    data: object({ label: Label }),
  }),
  object({
    id: Id,
    type: Type.Literal('result'),
    position: Position,
    data: object({ label: Label }),
  }),
]);
export const Edge = object({ id: Id, source: Id, target: Id });
export const Graph = object({
  nodes: Type.Array(Node, { maxItems: 20 }),
  edges: Type.Array(Edge, { maxItems: 20 }),
  viewport: object({
    x: Type.Number(),
    y: Type.Number(),
    zoom: Type.Number({ minimum: 0.1, maximum: 4 }),
  }),
});
export const Links = Type.Record(
  Type.String(),
  object({
    href: Type.String({ pattern: '^/' }),
    method: Type.Union([Type.Literal('GET'), Type.Literal('POST'), Type.Literal('PUT')]),
  }),
);
export const SpaceInput = object({ title: Label });
export const Space = object({
  id: Id,
  title: Label,
  createdAt: Type.String({ format: 'date-time' }),
  links: Links,
});
export const GenerationInput = object({
  nodeId: Id,
  graphETag: Type.String({ pattern: '^"[a-f0-9]{64}"$' }),
  scenario: Type.Union([Type.Literal('success'), Type.Literal('failure')]),
});
export const Generation = object({
  id: Id,
  spaceId: Id,
  nodeId: Id,
  resultNodeId: Id,
  prompt: Type.String(),
  graphETag: Type.String(),
  scenario: GenerationInput.properties.scenario,
  status: Type.Union([
    Type.Literal('processing'),
    Type.Literal('succeeded'),
    Type.Literal('failed'),
  ]),
  createdAt: Type.String({ format: 'date-time' }),
  imageUrl: Type.Unsafe<string | null>({ type: 'string', nullable: true }),
  failureCode: Type.Unsafe<string | null>({ type: 'string', nullable: true }),
  links: Links,
});
export const ErrorResponse = object({
  error: object({ code: Type.String(), message: Type.String() }),
});
export const IdempotencyHeaders = Type.Object({
  'idempotency-key': Type.String({
    minLength: 8,
    maxLength: 128,
    pattern: '^[A-Za-z0-9_-]+$',
    description: 'Сохраняйте ключ при повторе запроса; для новой генерации нужен новый ключ.',
  }),
});
export const GraphHeaders = Type.Object({
  'if-match': Type.Optional(
    Type.String({
      description: 'ETag текущего графа, включая кавычки. Без заголовка сервер вернёт 428.',
    }),
  ),
});
export const Config = object({
  debounceMs: Type.Integer(),
  pollIntervalMs: Type.Integer(),
  generationDelayMs: Type.Integer(),
  maxNodes: Type.Integer(),
  maxEdges: Type.Integer(),
  nodeTypes: Type.Array(Type.String()),
  links: Links,
});

export type GraphData = Static<typeof Graph>;
export type NodeData = Static<typeof Node>;
export type GenerationData = Static<typeof Generation>;
export type GenerationRequest = Static<typeof GenerationInput>;
export type SpaceData = Static<typeof Space>;
