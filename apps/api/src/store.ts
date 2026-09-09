import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GraphData, GenerationData, GenerationRequest, SpaceData } from '@canvas/contracts';

import { DomainError, matchesETag } from './http.js';
export { DomainError, matchesETag } from './http.js';

type StoredSpace = { id: string; title: string; createdAt: string; rawGraph: string };
type StoredGeneration = Omit<GenerationData, 'status' | 'imageUrl' | 'failureCode' | 'links'> & {
  settlesAt: number;
};
type State = {
  version: 1;
  spaces: Record<string, StoredSpace>;
  generations: Record<string, StoredGeneration>;
  keys: Record<string, { fingerprint: string; generationId: string }>;
};
const link = (href: string, method: 'GET' | 'POST' | 'PUT' = 'GET') => ({ href, method });
const emptyGraph = (): GraphData => ({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
export const etag = (raw: string) => `"${createHash('sha256').update(raw).digest('hex')}"`;

export class Store {
  private state: State;
  constructor(
    private file?: string,
    readonly delayMs = 1500,
    private now = Date.now,
  ) {
    this.state =
      file && existsSync(file)
        ? JSON.parse(readFileSync(file, 'utf8'))
        : { version: 1, spaces: {}, generations: {}, keys: {} };
    if (this.state.version !== 1) throw new Error('Unsupported data file.');
  }
  private commit<T>(action: () => T): T {
    const previous = structuredClone(this.state);
    try {
      const value = action();
      if (this.file) {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
        renameSync(`${this.file}.tmp`, this.file);
      }
      return value;
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }
  private storedSpace(id: string) {
    const space = Object.hasOwn(this.state.spaces, id) ? this.state.spaces[id] : undefined;
    if (!space) throw new DomainError(404, 'SPACE_NOT_FOUND', 'Рабочее пространство не найдено.');
    return space;
  }
  space(id: string): SpaceData {
    const { title, createdAt } = this.storedSpace(id);
    return {
      id,
      title,
      createdAt,
      links: {
        self: link(`/api/spaces/${id}`),
        graph: link(`/api/spaces/${id}/graph`),
        saveGraph: link(`/api/spaces/${id}/graph`, 'PUT'),
        generations: link(`/api/spaces/${id}/generations`),
        createGeneration: link(`/api/spaces/${id}/generations`, 'POST'),
      },
    };
  }
  spaces() {
    return Object.keys(this.state.spaces)
      .reverse()
      .map((id) => this.space(id));
  }
  createSpace(title: string) {
    return this.commit(() => {
      const id = randomUUID();
      this.state.spaces[id] = {
        id,
        title,
        createdAt: new Date(this.now()).toISOString(),
        rawGraph: JSON.stringify(emptyGraph()),
      };
      return this.space(id);
    });
  }
  graph(id: string) {
    const raw = this.storedSpace(id).rawGraph;
    return { raw, etag: etag(raw), data: JSON.parse(raw) as GraphData };
  }
  saveGraph(id: string, raw: string, condition?: string) {
    const previous = this.graph(id);
    if (condition === undefined)
      throw new DomainError(
        428,
        'PRECONDITION_REQUIRED',
        'Передайте If-Match с ETag загруженного графа.',
      );
    if (!matchesETag(condition, previous.etag))
      throw new DomainError(
        412,
        'GRAPH_VERSION_CONFLICT',
        'Граф изменился. Сохраните свои правки и перечитайте данные сервера.',
      );
    const graph = JSON.parse(raw) as GraphData;
    this.validateGraph(graph);
    if (previous.raw === raw) return previous;
    return this.commit(() => {
      this.storedSpace(id).rawGraph = raw;
      return this.graph(id);
    });
  }
  private validateGraph(graph: GraphData) {
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const ids = new Set<string>();
    const targets = new Set<string>();
    const outputs = new Set<string>();
    if (nodes.size !== graph.nodes.length)
      throw new DomainError(422, 'INVALID_GRAPH', 'Идентификаторы нод должны быть уникальными.');
    for (const edge of graph.edges) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      const valid =
        source &&
        target &&
        ((source.type === 'prompt' && target.type === 'generator') ||
          (source.type === 'generator' && target.type === 'result'));
      if (
        !valid ||
        ids.has(edge.id) ||
        targets.has(edge.target) ||
        (source.type === 'generator' && outputs.has(source.id))
      )
        throw new DomainError(
          422,
          'INVALID_GRAPH',
          'Соединяйте текст с генератором, генератор с результатом. У входа одна связь, у генератора один результат.',
        );
      ids.add(edge.id);
      targets.add(edge.target);
      if (source.type === 'generator') outputs.add(source.id);
    }
  }
  generation(spaceId: string, id: string): GenerationData {
    this.storedSpace(spaceId);
    const record = Object.hasOwn(this.state.generations, id)
      ? this.state.generations[id]
      : undefined;
    if (!record || record.spaceId !== spaceId)
      throw new DomainError(
        404,
        'GENERATION_NOT_FOUND',
        'Генерация не найдена в этом пространстве.',
      );
    const { settlesAt, ...value } = record;
    const status =
      this.now() < settlesAt
        ? 'processing'
        : record.scenario === 'success'
          ? 'succeeded'
          : 'failed';
    return {
      ...value,
      status,
      imageUrl: status === 'succeeded' ? '/assets/demo.svg' : null,
      failureCode: status === 'failed' ? 'SIMULATED_FAILURE' : null,
      links: {
        self: link(`/api/spaces/${spaceId}/generations/${id}`),
        graph: link(`/api/spaces/${spaceId}/graph`),
        ...(status === 'succeeded' ? { image: link('/assets/demo.svg') } : {}),
      },
    };
  }
  generations(spaceId: string) {
    this.storedSpace(spaceId);
    return Object.values(this.state.generations)
      .filter((g) => g.spaceId === spaceId)
      .reverse()
      .map((g) => this.generation(spaceId, g.id));
  }
  createGeneration(spaceId: string, body: GenerationRequest, key: string) {
    this.storedSpace(spaceId);
    const index = `${spaceId}:${key}`;
    const fingerprint = JSON.stringify([body.nodeId, body.graphETag, body.scenario]);
    const previous = this.state.keys[index];
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new DomainError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'Ключ уже использован с другими данными.',
        );
      return { data: this.generation(spaceId, previous.generationId), created: false };
    }
    const graph = this.graph(spaceId);
    if (body.graphETag !== graph.etag)
      throw new DomainError(
        409,
        'GRAPH_CHANGED',
        'Сначала сохраните текущий граф и используйте его новый ETag.',
      );
    const node = graph.data.nodes.find((n) => n.id === body.nodeId);
    if (!node || node.type !== 'generator')
      throw new DomainError(422, 'GENERATOR_REQUIRED', 'Выберите ноду генератора.');
    const input = graph.data.edges.find((e) => e.target === node.id);
    const output = graph.data.edges.find((e) => e.source === node.id);
    const prompt = graph.data.nodes.find((n) => n.id === input?.source);
    if (!output || prompt?.type !== 'prompt' || !prompt.data.text.trim())
      throw new DomainError(
        422,
        'INCOMPLETE_CHAIN',
        'Соедините непустой текст, генератор и результат.',
      );
    if (this.generations(spaceId).some((g) => g.nodeId === node.id && g.status === 'processing'))
      throw new DomainError(
        409,
        'GENERATION_IN_PROGRESS',
        'У этой ноды уже есть активная генерация.',
      );
    return this.commit(() => {
      const id = randomUUID();
      this.state.generations[id] = {
        id,
        spaceId,
        nodeId: node.id,
        resultNodeId: output.target,
        prompt: prompt.data.text,
        graphETag: graph.etag,
        scenario: body.scenario,
        createdAt: new Date(this.now()).toISOString(),
        settlesAt: this.now() + this.delayMs,
      };
      this.state.keys[index] = { fingerprint, generationId: id };
      return { data: this.generation(spaceId, id), created: true };
    });
  }
}
