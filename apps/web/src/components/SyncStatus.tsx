import type { SyncState } from '../sync/GraphSynchronizer';

const STATUS_LABELS: Record<SyncState['status'], string> = {
  idle: 'Граф не загружен',
  pending: 'Есть несохранённые правки',
  saving: 'Сохраняем…',
  saved: 'Все изменения сохранены',
  error: 'Ошибка сохранения',
  conflict: 'Конфликт версий',
};

export function SyncStatus({ state, onRetry }: { state: SyncState; onRetry: () => void }) {
  return (
    <div className={`sync sync--${state.status}`} role="status">
      <span className="sync-dot" aria-hidden="true" />
      <span>{STATUS_LABELS[state.status]}</span>
      {state.status === 'error' && state.error !== null && (
        <>
          <span className="sync-message">{state.error.message}</span>
          <button type="button" onClick={onRetry}>
            Повторить сохранение
          </button>
        </>
      )}
    </div>
  );
}
