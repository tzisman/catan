// Hex grid geometry for a standard Catan board (19 hexes, rows 3-4-5-4-3).
// Pointy-top hexes using axial coordinates. Produces hexes, vertices and edges
// with adjacency graphs and pixel positions, all derived from geometry.

export const HEX_SIZE = 56; // circumradius in pixels

// The 19 hex axial coordinates for a radius-2 hexagon (|q|,|r|,|s|<=2, s=-q-r).
export function hexAxials() {
  const coords = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const s = -q - r;
      if (Math.abs(q) <= 2 && Math.abs(r) <= 2 && Math.abs(s) <= 2) {
        coords.push({ q, r });
      }
    }
  }
  return coords;
}

function axialToPixel(q, r, size) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * (3 / 2) * r;
  return { x, y };
}

// 6 corners of a pointy-top hex.
function hexCorners(cx, cy, size) {
  const corners = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    corners.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    });
  }
  return corners;
}

function keyOf(x, y) {
  // Round to reduce floating point noise so shared corners dedupe.
  return `${Math.round(x)},${Math.round(y)}`;
}

// Build the complete geometry graph.
export function buildGeometry(size = HEX_SIZE) {
  const axials = hexAxials();

  // First pass: compute centers to find bounds for centering.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const centers = axials.map(({ q, r }) => {
    const { x, y } = axialToPixel(q, r, size);
    minX = Math.min(minX, x - size);
    maxX = Math.max(maxX, x + size);
    minY = Math.min(minY, y - size);
    maxY = Math.max(maxY, y + size);
    return { q, r, x, y };
  });

  const width = maxX - minX;
  const height = maxY - minY;
  const offX = -minX + size * 1.2; // padding for ports
  const offY = -minY + size * 1.2;
  const padding = size * 1.2;

  const vertexMap = new Map(); // key -> vertex id
  const vertices = [];
  const edgeMap = new Map(); // "va-vb" (sorted) -> edge id
  const edges = [];
  const hexes = [];

  function getVertex(x, y) {
    const k = keyOf(x, y);
    if (vertexMap.has(k)) return vertexMap.get(k);
    const id = vertices.length;
    vertices.push({
      id,
      x,
      y,
      hexIds: [],
      edgeIds: [],
      adjacentVertexIds: [],
      port: null,
    });
    vertexMap.set(k, id);
    return id;
  }

  function getEdge(a, b) {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeMap.has(key)) return edgeMap.get(key);
    const id = edges.length;
    const va = vertices[a];
    const vb = vertices[b];
    edges.push({
      id,
      vertexIds: [a, b],
      hexIds: [],
      x1: va.x,
      y1: va.y,
      x2: vb.x,
      y2: vb.y,
    });
    edgeMap.set(key, id);
    return id;
  }

  centers.forEach(({ q, r, x, y }, index) => {
    const cx = x + offX;
    const cy = y + offY;
    const corners = hexCorners(cx, cy, size);
    const cornerIds = corners.map((c) => getVertex(c.x, c.y));

    const hex = {
      id: index,
      q,
      r,
      cx,
      cy,
      vertexIds: cornerIds,
      edgeIds: [],
      resource: null,
      number: null,
      hasRobber: false,
    };

    for (let i = 0; i < 6; i++) {
      const a = cornerIds[i];
      const b = cornerIds[(i + 1) % 6];
      const eId = getEdge(a, b);
      hex.edgeIds.push(eId);
      if (!edges[eId].hexIds.includes(index)) edges[eId].hexIds.push(index);
      if (!vertices[a].hexIds.includes(index)) vertices[a].hexIds.push(index);
      if (!vertices[a].edgeIds.includes(eId)) vertices[a].edgeIds.push(eId);
      if (!vertices[b].edgeIds.includes(eId)) vertices[b].edgeIds.push(eId);
    }
    hexes.push(hex);
  });

  // Build vertex adjacency from edges.
  for (const e of edges) {
    const [a, b] = e.vertexIds;
    if (!vertices[a].adjacentVertexIds.includes(b))
      vertices[a].adjacentVertexIds.push(b);
    if (!vertices[b].adjacentVertexIds.includes(a))
      vertices[b].adjacentVertexIds.push(a);
  }

  const viewWidth = width + padding * 2;
  const viewHeight = height + padding * 2;

  return {
    hexes,
    vertices,
    edges,
    viewWidth,
    viewHeight,
  };
}

// Perimeter edges are those adjacent to only one hex, ordered around the coast.
export function perimeterEdges(geom) {
  const outer = geom.edges.filter((e) => e.hexIds.length === 1);
  // Order them by angle around the board center.
  const cx = geom.viewWidth / 2;
  const cy = geom.viewHeight / 2;
  outer.sort((a, b) => {
    const angA = Math.atan2((a.y1 + a.y2) / 2 - cy, (a.x1 + a.x2) / 2 - cx);
    const angB = Math.atan2((b.y1 + b.y2) / 2 - cy, (b.x1 + b.x2) / 2 - cx);
    return angA - angB;
  });
  return outer;
}
