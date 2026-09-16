import type { GenerationData, GenerationRequest, GraphData, SpaceData } from '@canvas/contracts';
import { apiRequest } from './client';
import { ApiError, parseError } from './errors';

export type GraphVersion = { graph: GraphData; etag: string };

export type GenerationStart = {
  generation: GenerationData;
  statusHref: string;
  retryAfterMs?: number;
};

function requireEtag(headers: Headers): string {
  const etag = headers.get('etag');
  if (etag === null) throw parseError();
  return etag;
}

function readRetryAfterMs(headers: Headers): number | undefined {
  const value = Number.parseInt(headers.get('retry-after') ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value * 1000 : undefined;
}

export async function createSpace(title: string, signal?: AbortSignal): Promise<SpaceData> {
  const response = await apiRequest<SpaceData>('/api/spaces', {
    method: 'POST',
    body: { title },
    expect: [201],
    signal,
  });
  return response.data;
}

export async function getSpace(spaceId: string, signal?: AbortSignal): Promise<SpaceData> {
  const response = await apiRequest<SpaceData>(`/api/spaces/${spaceId}`, { signal });
  return response.data;
}

export async function getGraph(spaceId: string, signal?: AbortSignal): Promise<GraphVersion> {
  const response = await apiRequest<GraphData>(`/api/spaces/${spaceId}/graph`, { signal });
  return { graph: response.data, etag: requireEtag(response.headers) };
}

export async function putGraph(
  spaceId: string,
  graph: GraphData,
  etag: string,
  signal?: AbortSignal,
): Promise<GraphVersion> {
  const response = await apiRequest<GraphData>(`/api/spaces/${spaceId}/graph`, {
    method: 'PUT',
    headers: { 'If-Match': etag },
    body: graph,
    signal,
  });
  return { graph: response.data, etag: requireEtag(response.headers) };
}

export async function listGenerations(
  spaceId: string,
  signal?: AbortSignal,
): Promise<GenerationData[]> {
  const response = await apiRequest<GenerationData[]>(`/api/spaces/${spaceId}/generations`, {
    signal,
  });
  return response.data;
}

export async function startGeneration(
  spaceId: string,
  input: GenerationRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<GenerationStart> {
  const response = await apiRequest<GenerationData>(`/api/spaces/${spaceId}/generations`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: input,
    expect: [200, 201, 202],
    signal,
  });
  return {
    generation: response.data,
    statusHref: response.headers.get('location') ?? response.data.links.self.href,
    retryAfterMs: readRetryAfterMs(response.headers),
  };
}

export async function getGenerationByHref(
  href: string,
  signal?: AbortSignal,
): Promise<GenerationData> {
  const response = await apiRequest<GenerationData>(href, { signal });
  return response.data;
}
