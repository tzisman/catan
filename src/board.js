// Board creation: resource distribution, number tokens, robber and 9 ports.
// Supports random or fixed (beginner) layouts, built on top of the geometry.

import { buildGeometry, perimeterEdges } from "./hexgrid.js";

export const RESOURCES = ["brick", "wood", "sheep", "wheat", "ore"];

// Standard resource counts (19 tiles including 1 desert).
const RESOURCE_BAG = [
  "brick", "brick", "brick",
  "wood", "wood", "wood", "wood",
  "sheep", "sheep", "sheep", "sheep",
  "wheat", "wheat", "wheat", "wheat",
  "ore", "ore", "ore",
  "desert",
];

// Standard 18 number tokens (desert has none).
const NUMBER_BAG = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

// 9 ports: 4 generic (3:1) and one 2:1 per resource.
const PORT_BAG = [
  { type: "any" },
  { type: "any" },
  { type: "any" },
  { type: "any" },
  { type: "brick" },
  { type: "wood" },
  { type: "sheep" },
  { type: "wheat" },
  { type: "ore" },
];

// Fixed beginner layout: resource per hex id (0..18) following hexAxials order.
const FIXED_RESOURCES = [
  "ore", "sheep", "wood",
  "wheat", "brick", "sheep", "brick",
  "wheat", "wood", "desert", "wood", "ore",
  "wood", "ore", "wheat", "sheep",
  "brick", "wheat", "sheep",
];

const FIXED_NUMBERS_ORDER = [
  10, 2, 9, 12, 6, 4, 10, 9, 11, null, 3, 8, 8, 3, 4, 5, 5, 6, 11,
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isRed(n) {
  return n === 6 || n === 8;
}

// Try to assign numbers so no two red tokens (6/8) are adjacent.
function assignNumbers(hexes, adjacency) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const numbers = shuffle(NUMBER_BAG);
    const assignment = {};
    let idx = 0;
    for (const hex of hexes) {
      if (hex.resource === "desert") continue;
      assignment[hex.id] = numbers[idx++];
    }
    let ok = true;
    for (const hex of hexes) {
      if (hex.resource === "desert") continue;
      if (!isRed(assignment[hex.id])) continue;
      for (const nId of adjacency[hex.id]) {
        if (assignment[nId] !== undefined && isRed(assignment[nId])) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (ok) return assignment;
  }
  // Fallback: accept whatever the last shuffle produced.
  const numbers = shuffle(NUMBER_BAG);
  const assignment = {};
  let idx = 0;
  for (const hex of hexes) {
    if (hex.resource === "desert") continue;
    assignment[hex.id] = numbers[idx++];
  }
  return assignment;
}

// Build hex-to-hex adjacency (hexes sharing an edge).
function hexAdjacency(geom) {
  const adj = {};
  for (const hex of geom.hexes) adj[hex.id] = [];
  for (const e of geom.edges) {
    if (e.hexIds.length === 2) {
      const [a, b] = e.hexIds;
      adj[a].push(b);
      adj[b].push(a);
    }
  }
  return adj;
}

function assignPorts(geom, random) {
  const outer = perimeterEdges(geom);
  const ports = random ? shuffle(PORT_BAG) : PORT_BAG.slice();
  const count = ports.length;
  const step = outer.length / count;
  const result = [];
  for (let i = 0; i < count; i++) {
    const edge = outer[Math.round(i * step) % outer.length];
    const port = { ...ports[i], edgeId: edge.id, vertexIds: edge.vertexIds.slice() };
    result.push(port);
    for (const v of edge.vertexIds) {
      if (!geom.vertices[v].port) geom.vertices[v].port = port.type;
    }
  }
  return result;
}

export function createBoard(options = {}) {
  const { random = true } = options;
  const geom = buildGeometry();
  const adjacency = hexAdjacency(geom);

  const resources = random ? shuffle(RESOURCE_BAG) : FIXED_RESOURCES.slice();
  geom.hexes.forEach((hex, i) => {
    hex.resource = resources[i];
  });

  let numberAssignment;
  if (random) {
    numberAssignment = assignNumbers(geom.hexes, adjacency);
  } else {
    numberAssignment = {};
    geom.hexes.forEach((hex) => {
      const n = FIXED_NUMBERS_ORDER[hex.id];
      if (hex.resource !== "desert" && n != null) numberAssignment[hex.id] = n;
    });
  }

  let robberHexId = null;
  geom.hexes.forEach((hex) => {
    if (hex.resource === "desert") {
      hex.number = null;
      hex.hasRobber = true;
      robberHexId = hex.id;
    } else {
      hex.number = numberAssignment[hex.id];
    }
  });

  const ports = assignPorts(geom, random);

  return {
    hexes: geom.hexes,
    vertices: geom.vertices,
    edges: geom.edges,
    ports,
    viewWidth: geom.viewWidth,
    viewHeight: geom.viewHeight,
    adjacency,
    robberHexId,
  };
}

// Pip count (dots) representing dice probability for a number token.
export function numberPips(n) {
  if (n == null) return 0;
  return 6 - Math.abs(7 - n);
}
