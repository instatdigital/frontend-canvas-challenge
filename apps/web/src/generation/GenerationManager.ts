import type { GenerationData, GenerationRequest } from '@canvas/contracts';
import { toAbsoluteUrl } from '../api/client';
import { getGenerationByHref, startGeneration } from '../api/endpoints';
import { isAborted, toApiError, type ApiError } from '../api/errors';
import { pollUntilSettled } from '../api/poll';

export type Scenario = GenerationRequest['scenario'];

export type AttemptStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'error';

export type Attempt = {
  seq: number;
  key: string;
  nodeId: string;
  scenario: Scenario;
  graphETag: string | null;
  status: AttemptStatus;
  generationId: string | null;
  href: string | null;
  resultNodeId: string | null;
  imageUrl: string | null;
  failureCode: string | null;
  error: ApiError | null;
};

export type GenerationSnapshot = {
  byNode: ReadonlyMap<string, Attempt>;
  byResult: ReadonlyMap<string, Attempt>;
};

export type GenerationTransport = {
  start: typeof startGeneration;
  read: typeof getGenerationByHref;
};

export type StartInput = {
  nodeId: string;
  scenario: Scenario;
  prepare: () => Promise<string>;
};

export type GenerationManagerOptions = {
  spaceId: string;
  pollIntervalMs?: number;
  transport?: GenerationTransport;
  onStateChange?: (snapshot: GenerationSnapshot) => void;
};

const DEFAULT_POLL_INTERVAL_MS = 500;
const POLL_RETRIES = 3;

export class GenerationManager {
  private readonly spaceId: string;
  private readonly pollIntervalMs: number;
  private readonly transport: GenerationTransport;
  private readonly notify: (snapshot: GenerationSnapshot) => void;
  private readonly abort = new AbortController();
  private readonly attempts = new Map<string, Attempt>();
  private seq = 0;
  private disposed = false;

  constructor(options: GenerationManagerOptions) {
    this.spaceId = options.spaceId;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.transport = options.transport ?? { start: startGeneration, read: getGenerationByHref };
    this.notify = options.onStateChange ?? (() => {});
  }

  attemptFor(nodeId: string): Attempt | undefined {
    return this.attempts.get(nodeId);
  }

  snapshot(): GenerationSnapshot {
    const byNode = new Map<string, Attempt>();
    const byResult = new Map<string, Attempt>();
    for (const attempt of this.attempts.values()) {
      const frozen = { ...attempt };
      byNode.set(frozen.nodeId, frozen);
      if (frozen.resultNodeId === null) continue;
      if (frozen.status === 'starting' || frozen.status === 'error') continue;
      const previous = byResult.get(frozen.resultNodeId);
      if (previous === undefined || previous.seq < frozen.seq)
        byResult.set(frozen.resultNodeId, frozen);
    }
    return { byNode, byResult };
  }

  async start(input: StartInput): Promise<void> {
    const current = this.attempts.get(input.nodeId);
    if (current !== undefined && (current.status === 'starting' || current.status === 'processing'))
      return;
    const attempt: Attempt = {
      seq: (this.seq += 1),
      key: crypto.randomUUID(),
      nodeId: input.nodeId,
      scenario: input.scenario,
      graphETag: null,
      status: 'starting',
      generationId: null,
      href: null,
      resultNodeId: null,
      imageUrl: null,
      failureCode: null,
      error: null,
    };
    this.attempts.set(input.nodeId, attempt);
    this.emit();
    let etag: string;
    try {
      etag = await input.prepare();
    } catch (error) {
      this.failAttempt(attempt, toApiError(error));
      return;
    }
    attempt.graphETag = etag;
    await this.sendStart(attempt);
  }

  retry(nodeId: string): void {
    const attempt = this.attempts.get(nodeId);
    if (attempt === undefined || attempt.status !== 'error' || this.disposed) return;
    attempt.error = null;
    if (attempt.generationId === null || attempt.href === null) {
      attempt.status = 'starting';
      this.emit();
      void this.sendStart(attempt);
    } else {
      attempt.status = 'processing';
      this.emit();
      this.track(attempt, attempt.href, undefined);
    }
  }

  restore(generations: GenerationData[]): void {
    if (this.disposed) return;
    this.attempts.clear();
    for (const generation of generations) {
      if (this.attempts.has(generation.nodeId)) continue;
      const attempt: Attempt = {
        seq: (this.seq += 1),
        key: '',
        nodeId: generation.nodeId,
        scenario: generation.scenario,
        graphETag: generation.graphETag,
        status: generation.status === 'processing' ? 'processing' : generation.status,
        generationId: generation.id,
        href: generation.links.self.href,
        resultNodeId: generation.resultNodeId,
        imageUrl:
          generation.status === 'succeeded' && generation.imageUrl !== null
            ? toAbsoluteUrl(generation.imageUrl)
            : null,
        failureCode: generation.failureCode,
        error: null,
      };
      this.attempts.set(generation.nodeId, attempt);
      if (generation.status === 'processing')
        this.track(attempt, generation.links.self.href, undefined);
    }
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
  }

  private async sendStart(attempt: Attempt): Promise<void> {
    const body: GenerationRequest = {
      nodeId: attempt.nodeId,
      graphETag: attempt.graphETag ?? '',
      scenario: attempt.scenario,
    };
    try {
      const started = await this.transport.start(
        this.spaceId,
        body,
        attempt.key,
        this.abort.signal,
      );
      attempt.generationId = started.generation.id;
      attempt.href = started.statusHref;
      attempt.resultNodeId = started.generation.resultNodeId;
      if (started.generation.status === 'processing') {
        attempt.status = 'processing';
        this.emit();
        this.track(attempt, started.statusHref, started.retryAfterMs);
      } else {
        this.settle(attempt, started.generation);
      }
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.kind === 'aborted') return;
      this.failAttempt(attempt, apiError);
    }
  }

  private track(attempt: Attempt, href: string, firstIntervalMs?: number): void {
    void pollUntilSettled({
      read: (signal) => this.transport.read(href, signal),
      isSettled: (generation) => generation.status !== 'processing',
      intervalMs: this.pollIntervalMs,
      firstIntervalMs,
      retries: POLL_RETRIES,
      signal: this.abort.signal,
    })
      .then((generation) => this.settle(attempt, generation))
      .catch((error: unknown) => {
        if (isAborted(error)) return;
        this.failAttempt(attempt, toApiError(error));
      });
  }

  private settle(attempt: Attempt, generation: GenerationData): void {
    if (this.attempts.get(attempt.nodeId) !== attempt) return;
    attempt.resultNodeId = generation.resultNodeId;
    attempt.failureCode = generation.failureCode;
    if (generation.status === 'succeeded' && generation.imageUrl !== null) {
      attempt.status = 'succeeded';
      attempt.imageUrl = toAbsoluteUrl(generation.imageUrl);
    } else {
      attempt.status = 'failed';
      attempt.imageUrl = null;
    }
    this.emit();
  }

  private failAttempt(attempt: Attempt, error: ApiError): void {
    if (this.attempts.get(attempt.nodeId) !== attempt) return;
    attempt.status = 'error';
    attempt.error = error;
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    this.notify(this.snapshot());
  }
}
