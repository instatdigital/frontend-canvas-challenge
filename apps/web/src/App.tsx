import { useCallback, useEffect, useState } from 'react';
import type { SpaceData } from '@canvas/contracts';
import { getSpace } from './api/endpoints';
import { isAborted, toApiError } from './api/errors';
import { CanvasScreen } from './components/CanvasScreen';
import { CreateSpaceForm } from './components/CreateSpaceForm';

const STORAGE_KEY = 'canvas.spaceId';

type Phase = 'checking' | 'form' | 'ready' | 'error';

export function App() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [space, setSpace] = useState<SpaceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      setPhase('form');
      return;
    }
    const abort = new AbortController();
    let cancelled = false;
    setPhase('checking');
    setError(null);
    void (async () => {
      try {
        const found = await getSpace(stored, abort.signal);
        if (!cancelled) {
          setSpace(found);
          setPhase('ready');
        }
      } catch (cause) {
        if (cancelled || isAborted(cause)) return;
        const apiError = toApiError(cause);
        if (apiError.status === 404) {
          localStorage.removeItem(STORAGE_KEY);
          if (!cancelled) setPhase('form');
          return;
        }
        setError(apiError.message);
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [checkAttempt]);

  const handleCreated = useCallback((created: SpaceData) => {
    localStorage.setItem(STORAGE_KEY, created.id);
    setSpace(created);
    setPhase('ready');
  }, []);

  if (phase === 'checking') return <div className="page-note">Открываем пространство…</div>;
  if (phase === 'error') {
    return (
      <div className="page-note page-note--error" role="alert">
        <p>Не удалось открыть пространство: {error}</p>
        <button type="button" onClick={() => setCheckAttempt((attempt) => attempt + 1)}>
          Повторить
        </button>
      </div>
    );
  }
  if (phase === 'form' || space === null) return <CreateSpaceForm onCreated={handleCreated} />;
  return <CanvasScreen space={space} />;
}
