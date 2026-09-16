import '@xyflow/react/dist/style.css';
import { Background, Controls, ReactFlow, type NodeTypes } from '@xyflow/react';
import type { SpaceData } from '@canvas/contracts';
import { EditorContext } from '../editor/EditorContext';
import { useCanvasEditor } from '../editor/useCanvasEditor';
import { MAX_NODES, type NodeKind } from '../graph/model';
import { SyncStatus } from './SyncStatus';
import { PromptNode } from './nodes/PromptNode';
import { GeneratorNode } from './nodes/GeneratorNode';
import { ResultNode } from './nodes/ResultNode';

const NODE_TYPES = {
  prompt: PromptNode,
  generator: GeneratorNode,
  result: ResultNode,
} as NodeTypes;

const ADD_BUTTONS: { kind: NodeKind; label: string }[] = [
  { kind: 'prompt', label: '+ Текст' },
  { kind: 'generator', label: '+ Генератор' },
  { kind: 'result', label: '+ Результат' },
];

export function CanvasScreen({ space }: { space: SpaceData }) {
  const editor = useCanvasEditor(space.id);

  if (editor.phase === 'loading') {
    return <div className="page-note">Загружаем граф пространства…</div>;
  }
  if (editor.phase === 'loadError') {
    return (
      <div className="page-note page-note--error" role="alert">
        <p>Не удалось загрузить данные: {editor.loadError}</p>
        <button type="button" onClick={editor.retryLoad}>
          Повторить загрузку
        </button>
      </div>
    );
  }

  const limitReached = editor.nodes.length >= MAX_NODES;

  return (
    <EditorContext.Provider value={editor.contextValue}>
      <div className="app-shell">
        <header className="topbar">
          <h1 className="topbar-title">Канвас — {space.title}</h1>
          <div className="toolbar-add" role="group" aria-label="Добавление нод">
            {ADD_BUTTONS.map((button) => (
              <button
                key={button.kind}
                type="button"
                disabled={limitReached}
                title={limitReached ? `Максимум ${MAX_NODES} нод` : undefined}
                onClick={() => editor.addNodeByKind(button.kind)}
              >
                {button.label}
              </button>
            ))}
          </div>
          <SyncStatus state={editor.syncState} onRetry={editor.retrySave} />
        </header>
        {editor.syncState.status === 'conflict' && (
          <div className="conflict-banner" role="alert">
            <p>
              Граф изменился на сервере. Ваш черновик сохранён локально и не отправлен.
              Перечитывание заменит его серверной версией.
            </p>
            <button type="button" onClick={() => void editor.conflictReload()}>
              Перечитать с сервера
            </button>
          </div>
        )}
        <div className="canvas-wrap" ref={editor.containerRef}>
          <ReactFlow
            nodes={editor.nodes}
            edges={editor.edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={editor.onNodesChange}
            onEdgesChange={editor.onEdgesChange}
            onConnect={editor.onConnect}
            isValidConnection={editor.isValidConnection}
            onMoveEnd={editor.onMoveEnd}
            onInit={editor.onInit}
            defaultViewport={editor.initialViewport}
            deleteKeyCode={['Delete', 'Backspace']}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
    </EditorContext.Provider>
  );
}
