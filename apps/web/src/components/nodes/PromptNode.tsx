import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useEditor } from '../../editor/EditorContext';
import type { CanvasNode } from '../../graph/model';
import { NodeHeader } from './NodeHeader';

export function PromptNode({ id, data }: NodeProps<CanvasNode>) {
  const { updateNodeData, removeNode } = useEditor();
  const text = 'text' in data ? data.text : '';
  const fieldId = `prompt-text-${id}`;
  return (
    <div className="canvas-node canvas-node--prompt">
      <NodeHeader title="Текст" onDelete={() => removeNode(id)} />
      <label className="node-field" htmlFor={fieldId}>
        Описание изображения
      </label>
      <textarea
        id={fieldId}
        className="nodrag"
        value={text}
        rows={4}
        maxLength={2000}
        placeholder="Например: горы на рассвете"
        onChange={(event) => updateNodeData(id, { text: event.target.value })}
      />
      <span className="handle-label handle-label--out">к генератору →</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
