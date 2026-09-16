import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import { listGenerations } from '../api/endpoints';
import { isAborted, toApiError } from '../api/errors';
import {
  GenerationManager,
  type GenerationSnapshot,
  type Scenario,
} from '../generation/GenerationManager';
import {
  fromApiGraph,
  toApiGraph,
  POSITION_LIMIT,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNodeData,
  type NodeKind,
  type XYPosition,
} from '../graph/model';
import { addEdge, addNode, removeNode, replaceNodeData } from '../graph/operations';
import { buildGraphIndex, canConnect } from '../graph/rules';
import { GraphSynchronizer, type SyncState } from '../sync/GraphSynchronizer';
import type { EditorContextValue } from './EditorContext';

const EMPTY_SNAPSHOT: GenerationSnapshot = { byNode: new Map(), byResult: new Map() };
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

export type EditorPhase = 'loading' | 'ready' | 'loadError';

const SPAWN_SPREAD = 0.8;

function nextNodePosition(container: HTMLElement | null, viewport: Viewport): XYPosition {
  const width = container?.clientWidth ?? window.innerWidth;
  const height = container?.clientHeight ?? window.innerHeight;
  const limit = (value: number) => Math.min(POSITION_LIMIT, Math.max(-POSITION_LIMIT, value));
  return {
    x: limit(
      (width / 2 - viewport.x) / viewport.zoom +
        ((Math.random() - 0.5) * SPAWN_SPREAD * width) / viewport.zoom,
    ),
    y: limit(
      (height / 2 - viewport.y) / viewport.zoom +
        ((Math.random() - 0.5) * SPAWN_SPREAD * height) / viewport.zoom,
    ),
  };
}

export function useCanvasEditor(spaceId: string) {
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [phase, setPhase] = useState<EditorPhase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>({ status: 'idle', error: null });
  const [snapshot, setSnapshot] = useState<GenerationSnapshot>(EMPTY_SNAPSHOT);
  const [scenarios, setScenarios] = useState<Record<string, Scenario>>({});
  const [initialViewport, setInitialViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const viewportRef = useRef(DEFAULT_VIEWPORT);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scenariosRef = useRef<Record<string, Scenario>>({});
  const syncRef = useRef<GraphSynchronizer | null>(null);
  const managerRef = useRef<GenerationManager | null>(null);
  const flowRef = useRef<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);

  const commit = useCallback(
    (nextNodes: CanvasNode[], nextEdges: CanvasEdge[], persist: boolean = true) => {
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      if (persist) syncRef.current?.update(toApiGraph(nextNodes, nextEdges, viewportRef.current));
    },
    [],
  );

  useEffect(() => {
    const sync = new GraphSynchronizer({ spaceId, onStateChange: setSyncState });
    const manager = new GenerationManager({ spaceId, onStateChange: setSnapshot });
    syncRef.current = sync;
    managerRef.current = manager;
    const abort = new AbortController();
    let cancelled = false;
    setPhase('loading');
    setLoadError(null);
    void (async () => {
      try {
        const graph = await sync.load(abort.signal);
        if (cancelled) return;
        const canvas = fromApiGraph(graph);
        nodesRef.current = canvas.nodes;
        edgesRef.current = canvas.edges;
        viewportRef.current = graph.viewport;
        setNodes(canvas.nodes);
        setEdges(canvas.edges);
        setInitialViewport(graph.viewport);
        manager.restore(await listGenerations(spaceId, abort.signal));
        if (!cancelled) setPhase('ready');
      } catch (error) {
        if (cancelled || isAborted(error)) return;
        setLoadError(toApiError(error).message);
        setPhase('loadError');
      }
    })();
    return () => {
      cancelled = true;
      abort.abort();
      sync.dispose();
      manager.dispose();
    };
  }, [spaceId, loadAttempt]);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const nextNodes = applyNodeChanges(changes, nodesRef.current);
      let nextEdges = edgesRef.current;
      const removedIds = new Set<string>();
      let persist = false;
      for (const change of changes) {
        if (change.type === 'remove') removedIds.add(change.id);
        if (change.type !== 'select' && change.type !== 'dimensions') persist = true;
      }
      if (removedIds.size > 0)
        nextEdges = nextEdges.filter(
          (edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target),
        );
      commit(nextNodes, nextEdges, persist);
    },
    [commit],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      const persist = changes.some((change) => change.type !== 'select');
      commit(nodesRef.current, applyEdgeChanges(changes, edgesRef.current), persist);
    },
    [commit],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const nextEdges = addEdge(
        nodesRef.current,
        edgesRef.current,
        connection.source,
        connection.target,
      );
      if (nextEdges !== null) commit(nodesRef.current, nextEdges);
    },
    [commit],
  );

  const onMoveEnd = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    viewportRef.current = viewport;
    syncRef.current?.update(toApiGraph(nodesRef.current, edgesRef.current, viewport));
  }, []);

  const updateNodeData = useCallback(
    (nodeId: string, data: CanvasNodeData) => {
      commit(replaceNodeData(nodesRef.current, nodeId, data), edgesRef.current);
    },
    [commit],
  );

  const removeNodeById = useCallback(
    (nodeId: string) => {
      const next = removeNode(nodesRef.current, edgesRef.current, nodeId);
      commit(next.nodes, next.edges);
    },
    [commit],
  );

  const addNodeByKind = useCallback(
    (kind: NodeKind) => {
      const position = nextNodePosition(containerRef.current, viewportRef.current);
      const nextNodes = addNode(nodesRef.current, kind, position);
      if (nextNodes !== null) commit(nextNodes, edgesRef.current);
    },
    [commit],
  );

  const prepare = useCallback(async () => {
    await syncRef.current?.flush();
    return syncRef.current?.currentEtag ?? '';
  }, []);

  const generate = useCallback(
    (nodeId: string) => {
      void managerRef.current?.start({
        nodeId,
        scenario: scenariosRef.current[nodeId] ?? 'success',
        prepare,
      });
    },
    [prepare],
  );

  const retryError = useCallback((nodeId: string) => {
    managerRef.current?.retry(nodeId);
  }, []);

  const setScenario = useCallback((nodeId: string, scenario: Scenario) => {
    scenariosRef.current = { ...scenariosRef.current, [nodeId]: scenario };
    setScenarios(scenariosRef.current);
  }, []);

  const conflictReload = useCallback(async () => {
    const sync = syncRef.current;
    if (sync === null) return;
    try {
      const graph = await sync.reload();
      const canvas = fromApiGraph(graph);
      viewportRef.current = graph.viewport;
      flowRef.current?.setViewport(graph.viewport);
      commit(canvas.nodes, canvas.edges, false);
    } catch (error) {
      setLoadError(toApiError(error).message);
      setPhase('loadError');
    }
  }, [commit]);

  const retrySave = useCallback(() => {
    void syncRef.current?.flush().catch(() => {});
  }, []);

  const retryLoad = useCallback(() => {
    setLoadAttempt((attempt) => attempt + 1);
  }, []);

  const onInit = useCallback((instance: ReactFlowInstance<CanvasNode, CanvasEdge>) => {
    flowRef.current = instance;
  }, []);

  const graphIndex = useMemo(() => buildGraphIndex(nodes, edges), [nodes, edges]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => canConnect(graphIndex, connection.source, connection.target),
    [graphIndex],
  );

  const contextValue = useMemo<EditorContextValue>(
    () => ({
      updateNodeData,
      removeNode: removeNodeById,
      setScenario,
      scenarioFor: (nodeId) => scenarios[nodeId] ?? 'success',
      generate,
      retryError,
      attemptFor: (nodeId) => snapshot.byNode.get(nodeId),
      attemptForResult: (nodeId) => snapshot.byResult.get(nodeId),
    }),
    [updateNodeData, removeNodeById, setScenario, scenarios, generate, retryError, snapshot],
  );

  return {
    nodes,
    edges,
    containerRef,
    phase,
    loadError,
    syncState,
    initialViewport,
    contextValue,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onMoveEnd,
    onInit,
    isValidConnection,
    addNodeByKind,
    conflictReload,
    retrySave,
    retryLoad,
  };
}
