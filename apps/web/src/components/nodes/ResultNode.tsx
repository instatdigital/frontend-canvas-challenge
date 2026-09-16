import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEditor } from '../../editor/EditorContext';
import type { CanvasNode } from '../../graph/model';
import { NodeHeader } from './NodeHeader';

export function ResultNode({ id }: NodeProps<CanvasNode>) {
  const editor = useEditor();
  const attempt = editor.attemptForResult(id);
  return (
    <div className="canvas-node canvas-node--result">
      <NodeHeader title="Результат" onDelete={() => editor.removeNode(id)} />
      <span className="handle-label handle-label--in">← от генератора</span>
      <Handle type="target" position={Position.Left} />
      {attempt === undefined && <div className="node-status">Ожидает генерации</div>}
      {attempt?.status === 'processing' && (
        <div className="node-status" role="status">
          <span className="spinner" aria-hidden="true" />
          Генерация выполняется…
        </div>
      )}
      {attempt?.status === 'succeeded' && attempt.imageUrl !== null && (
        <img className="node-image" src={attempt.imageUrl} alt="Результат генерации" />
      )}
      {attempt?.status === 'failed' && (
        <div className="node-error" role="alert">
          <span>Генерация не удалась ({attempt.failureCode}).</span>
          <button type="button" className="nodrag" onClick={() => editor.generate(attempt.nodeId)}>
            Повторить с новым ключом
          </button>
        </div>
      )}
    </div>
  );
}
