import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEditor } from '../../editor/EditorContext';
import type { AttemptStatus } from '../../generation/GenerationManager';
import type { CanvasNode } from '../../graph/model';
import { NodeHeader } from './NodeHeader';

const STATUS_LABELS: Record<AttemptStatus, string> = {
  starting: 'Сохраняем граф и запускаем…',
  processing: 'Генерация выполняется…',
  succeeded: 'Изображение готово',
  failed: 'Последняя генерация не удалась',
  error: 'Не удалось запустить генерацию',
};

export function GeneratorNode({ id, data }: NodeProps<CanvasNode>) {
  const editor = useEditor();
  const label = 'label' in data ? data.label : '';
  const attempt = editor.attemptFor(id);
  const busy = attempt?.status === 'starting' || attempt?.status === 'processing';
  const scenarioId = `scenario-${id}`;
  return (
    <div className="canvas-node canvas-node--generator">
      <NodeHeader title={label} onDelete={() => editor.removeNode(id)} />
      <span className="handle-label handle-label--in">← текст</span>
      <Handle type="target" position={Position.Left} />
      <div className="node-status" role="status">
        {attempt === undefined ? 'Готов к запуску' : STATUS_LABELS[attempt.status]}
      </div>
      {attempt?.status === 'error' && attempt.error !== null && (
        <div className="node-error" role="alert">
          <span>{attempt.error.message}</span>
          <button type="button" className="nodrag" onClick={() => editor.retryError(id)}>
            Повторить запуск
          </button>
        </div>
      )}
      <label className="node-field" htmlFor={scenarioId}>
        Сценарий генерации
      </label>
      <select
        id={scenarioId}
        className="nodrag"
        value={editor.scenarioFor(id)}
        onChange={(event) => editor.setScenario(id, event.target.value as 'success' | 'failure')}
      >
        <option value="success">успех</option>
        <option value="failure">сбой</option>
      </select>
      <button
        type="button"
        className="node-action nodrag"
        disabled={busy}
        onClick={() => editor.generate(id)}
      >
        {busy ? 'Генерация…' : 'Сгенерировать'}
      </button>
      <span className="handle-label handle-label--out">к результату →</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
