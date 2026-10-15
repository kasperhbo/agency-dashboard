import type { AgentTopology, TopologyNode, TopologyEdge } from '../src/types';
export interface PositionedNode extends TopologyNode { x: number; y: number; width: number; height: number }
export interface PositionedEdge extends TopologyEdge { path: string }
export interface LayoutOptions { provider?: string; project?: string; folder?: string; query?: string; activeOnly?: boolean; familyLimit?: number; childLimit?: number; expanded?: string[]; now?: number }
export function layoutTopology(graph: Pick<AgentTopology, 'nodes' | 'edges'>, options?: LayoutOptions): {
  width: number; height: number; nodes: PositionedNode[]; edges: PositionedEdge[];
  moreGroups: { parentId: string; count: number; x: number; y: number; width: number; height: number }[];
  hiddenCount: number; hiddenFamilies: number; visibleRuns: number; matchingRuns: number;
};
