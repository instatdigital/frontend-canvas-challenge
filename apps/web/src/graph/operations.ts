import type { XYPosition } from '@xyflow/react';
import type { CanvasEdge, CanvasNode, CanvasNodeData, NodeKind } from './model';
import { MAX_EDGES, MAX_NODES } from './model';
import { buildGraphIndex, canConnect } from './rules';

const DEFAULT_LABELS: { generator: string; result: string } = {
  generator: 'Генератор',
  result: 'Результат',
};

export function addNode(
  nodes: CanvasNode[],
  kind: NodeKind,
  position: XYPosition,
): CanvasNode[] | null {
  if (nodes.length >= MAX_NODES) return null;
  const data: CanvasNodeData = kind === 'prompt' ? { text: '' } : { label: DEFAULT_LABELS[kind] };
  return [...nodes, { id: crypto.randomUUID(), type: kind, position, data }];
}

export function replaceNodeData(
  nodes: CanvasNode[],
  nodeId: string,
  data: CanvasNodeData,
): CanvasNode[] {
  return nodes.map((node) => (node.id === nodeId ? { ...node, data } : node));
}

export function removeNode(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  nodeId: string,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  return {
    nodes: nodes.filter((node) => node.id !== nodeId),
    edges: edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  };
}

export function addEdge(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  sourceId: string,
  targetId: string,
): CanvasEdge[] | null {
  if (edges.length >= MAX_EDGES) return null;
  if (!canConnect(buildGraphIndex(nodes, edges), sourceId, targetId)) return null;
  return [...edges, { id: crypto.randomUUID(), source: sourceId, target: targetId }];
}

export function removeEdge(edges: CanvasEdge[], edgeId: string): CanvasEdge[] {
  return edges.filter((edge) => edge.id !== edgeId);
}
