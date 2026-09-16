import type { GraphData } from '@canvas/contracts';
import type { Edge, Node, Viewport, XYPosition } from '@xyflow/react';

export type NodeKind = 'prompt' | 'generator' | 'result';
export type CanvasNodeData = { text: string } | { label: string };
export type CanvasNode = Node<CanvasNodeData, NodeKind> & { type: NodeKind };
export type CanvasEdge = Edge;
export type CanvasGraph = { nodes: CanvasNode[]; edges: CanvasEdge[]; viewport: Viewport };

export const MAX_NODES = 20;
export const MAX_EDGES = 20;

const POSITION_LIMIT = 10000;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;

function axis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(POSITION_LIMIT, Math.max(-POSITION_LIMIT, value));
}

function zoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

export function fromApiGraph(graph: GraphData): CanvasGraph {
  return { nodes: graph.nodes, edges: graph.edges, viewport: graph.viewport };
}

export function toApiGraph(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  viewport: Viewport,
): GraphData {
  const apiNodes = new Array<GraphData['nodes'][number]>(nodes.length);
  for (let index = 0; index < nodes.length; index += 1) {
    const { id, type, position, data } = nodes[index];
    apiNodes[index] = {
      id,
      type,
      position: { x: axis(position.x), y: axis(position.y) },
      data,
    } as GraphData['nodes'][number];
  }
  const apiEdges = new Array<GraphData['edges'][number]>(edges.length);
  for (let index = 0; index < edges.length; index += 1) {
    const { id, source, target } = edges[index];
    apiEdges[index] = { id, source, target };
  }
  return {
    nodes: apiNodes,
    edges: apiEdges,
    viewport: { x: axis(viewport.x), y: axis(viewport.y), zoom: zoom(viewport.zoom) },
  };
}

export type { XYPosition };
