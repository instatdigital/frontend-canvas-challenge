import type { GraphData } from '@canvas/contracts';
import { getGraph, putGraph } from '../api/endpoints';
import { ApiError, toApiError } from '../api/errors';

export type SyncStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

export type SyncState = { status: SyncStatus; error: ApiError | null };

export type SyncTransport = { get: typeof getGraph; put: typeof putGraph };

export type SynchronizerOptions = {
  spaceId: string;
  debounceMs?: number;
  transport?: SyncTransport;
  onStateChange?: (state: SyncState) => void;
};

const DEFAULT_DEBOUNCE_MS = 500;

const CONFLICT_ERROR = new ApiError({
  kind: 'http',
  status: 412,
  code: 'GRAPH_VERSION_CONFLICT',
  message: 'Граф изменился. Сохраните свои правки и перечитайте данные сервера.',
});

export class GraphSynchronizer {
  private readonly spaceId: string;
  private readonly debounceMs: number;
  private readonly transport: SyncTransport;
  private readonly notify: (state: SyncState) => void;
  private state: SyncState = { status: 'idle', error: null };
  private latest: GraphData | null = null;
  private savedBody: GraphData | null = null;
  private etag: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: Promise<void> | null = null;
  private disposed = false;

  constructor(options: SynchronizerOptions) {
    this.spaceId = options.spaceId;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.transport = options.transport ?? { get: getGraph, put: putGraph };
    this.notify = options.onStateChange ?? (() => {});
  }

  get syncState(): SyncState {
    return this.state;
  }

  get draft(): GraphData | null {
    return this.latest;
  }

  get currentEtag(): string | null {
    return this.etag;
  }

  private get dirty(): boolean {
    return this.latest !== null && this.latest !== this.savedBody;
  }

  private setState(status: SyncStatus, error: ApiError | null = null): void {
    if (this.disposed) return;
    if (this.state.status === status && this.state.error === error) return;
    this.state = { status, error };
    this.notify(this.state);
  }

  async load(signal?: AbortSignal): Promise<GraphData> {
    const { graph, etag } = await this.transport.get(this.spaceId, signal);
    this.etag = etag;
    this.latest = null;
    this.savedBody = null;
    this.setState('saved');
    return graph;
  }

  async reload(signal?: AbortSignal): Promise<GraphData> {
    return this.load(signal);
  }

  update(graph: GraphData): void {
    this.latest = graph;
    if (this.state.status === 'conflict' || this.disposed) return;
    this.setState(this.flight !== null ? 'saving' : 'pending');
    this.restartSaveTimer();
  }

  async flush(): Promise<void> {
    while (this.dirty) {
      if (this.flight !== null) {
        await this.flight;
        continue;
      }
      if (this.state.status === 'conflict') throw this.state.error ?? CONFLICT_ERROR;
      this.clearTimer();
      await this.beginSave();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private restartSaveTimer(): void {
    this.clearTimer();
    if (this.flight !== null || this.disposed || this.state.status === 'conflict') return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.beginSave().catch(() => {});
    }, this.debounceMs);
  }

  private beginSave(): Promise<void> {
    if (this.flight !== null) return this.flight;
    if (!this.dirty) {
      this.setState('saved');
      return Promise.resolve();
    }
    const flight = this.transmit()
      .then(() => {
        this.flight = null;
        this.afterSuccess();
      })
      .catch((error: unknown) => {
        this.flight = null;
        throw error;
      });
    this.flight = flight;
    return flight;
  }

  private async transmit(): Promise<void> {
    const body = this.latest;
    const etag = this.etag;
    if (body === null || etag === null) {
      this.setState('idle');
      return;
    }
    this.setState('saving');
    try {
      const saved = await this.transport.put(this.spaceId, body, etag);
      this.etag = saved.etag;
      this.savedBody = body;
    } catch (error) {
      const apiError = toApiError(error);
      this.setState(apiError.status === 412 ? 'conflict' : 'error', apiError);
      throw apiError;
    }
  }

  private afterSuccess(): void {
    if (this.disposed) return;
    if (this.dirty) {
      this.setState('pending');
      this.restartSaveTimer();
    } else {
      this.setState('saved');
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
