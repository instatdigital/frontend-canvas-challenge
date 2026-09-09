import { randomUUID } from 'node:crypto';

export function sampleGraph(text = 'Горы на рассвете') {
  const nodes = [
    { id: randomUUID(), type: 'prompt', position: { x: 0, y: 0 }, data: { text } },
    {
      id: randomUUID(),
      type: 'generator',
      position: { x: 320, y: 0 },
      data: { label: 'Генератор' },
    },
    { id: randomUUID(), type: 'result', position: { x: 640, y: 0 }, data: { label: 'Результат' } },
  ];
  return {
    nodes,
    edges: [
      { id: randomUUID(), source: nodes[0].id, target: nodes[1].id },
      { id: randomUUID(), source: nodes[1].id, target: nodes[2].id },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
