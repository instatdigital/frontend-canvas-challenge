import type { CanvasEdge, CanvasNode, NodeKind } from './model';

export type GraphIndex = {
  kinds: Map<string, NodeKind>;
  occupiedTargets: Set<string>;
  generatorsWithResult: Set<string>;
};

export function buildGraphIndex(nodes: CanvasNode[], edges: CanvasEdge[]): GraphIndex {
  const kinds = new Map<string, NodeKind>();
  for (const node of nodes) kinds.set(node.id, node.type);
  const occupiedTargets = new Set<string>();
  const generatorsWithResult = new Set<string>();
  for (const edge of edges) {
    occupiedTargets.add(edge.target);
    if (kinds.get(edge.source) === 'generator') generatorsWithResult.add(edge.source);
  }
  return { kinds, occupiedTargets, generatorsWithResult };
}

export function canConnect(index: GraphIndex, sourceId: string, targetId: string): boolean {
  if (sourceId === targetId) return false;
  const sourceKind = index.kinds.get(sourceId);
  const targetKind = index.kinds.get(targetId);
  if (sourceKind === undefined || targetKind === undefined) return false;
  if (sourceKind === 'prompt' && targetKind === 'generator')
    return !index.occupiedTargets.has(targetId);
  if (sourceKind === 'generator' && targetKind === 'result')
    return !index.occupiedTargets.has(targetId) && !index.generatorsWithResult.has(sourceId);
  return false;
}
