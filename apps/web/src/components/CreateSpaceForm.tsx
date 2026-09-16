import { useState, type FormEvent } from 'react';
import { createSpace } from '../api/endpoints';
import { toApiError } from '../api/errors';
import type { SpaceData } from '@canvas/contracts';

export function CreateSpaceForm({ onCreated }: { onCreated: (space: SpaceData) => void }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') {
      setError('Введите название пространства.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(await createSpace(trimmed));
    } catch (cause) {
      setError(toApiError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-card" onSubmit={submit}>
      <h1>Новый канвас</h1>
      <p className="form-hint">
        Соберите цепочку «текст → генератор → результат» и запустите тестовую генерацию изображения.
      </p>
      <label className="form-field" htmlFor="space-title">
        Название пространства
      </label>
      <input
        id="space-title"
        value={title}
        maxLength={80}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Например: Мои эксперименты"
        aria-invalid={error !== null}
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Создаём…' : 'Создать пространство'}
      </button>
      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
