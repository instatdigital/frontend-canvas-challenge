import { abortError, toApiError } from './errors';

export type PollOptions<T> = {
  read: (signal: AbortSignal) => Promise<T>;
  isSettled: (value: T) => boolean;
  intervalMs: number;
  firstIntervalMs?: number;
  onValue?: (value: T) => void;
  retries?: number;
  signal?: AbortSignal;
};

export async function pollUntilSettled<T>(options: PollOptions<T>): Promise<T> {
  const signal = options.signal ?? new AbortController().signal;
  let retries = options.retries ?? 0;
  let delayMs = options.firstIntervalMs;
  for (;;) {
    if (delayMs !== undefined) await sleep(delayMs, signal);
    let value: T;
    try {
      value = await options.read(signal);
    } catch (error) {
      if (retries <= 0 || toApiError(error).kind === 'aborted') throw error;
      retries -= 1;
      delayMs = options.intervalMs;
      continue;
    }
    retries = options.retries ?? 0;
    if (options.isSettled(value)) return value;
    options.onValue?.(value);
    delayMs = options.intervalMs;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
