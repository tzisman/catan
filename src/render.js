// Renders the board and pieces as SVG from the game state, and draws
// interactive highlights for legal moves.

import { numberPips } from "./board.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export const RESOURCE_COLORS = {
  brick: "#c15a3a",
  wood: "#2f7d40",
  sheep: "#a7d86a",
  wheat: "#f0c040",
  ore: "#8b98a5",
  desert: "#ddcfa3",
};

export const RESOURCE_ICON = {
  brick: "🧱",
  wood: "🌲",
  sheep: "🐑",
  wheat: "🌾",
  ore: "⛰️",
  desert: "🏜️",
  any: "?",
};

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const k of Object.keys(attrs)) {
    node.setAttribute(k, attrs[k]);
  }
  if (parent) parent.appendChild(node);
  return node;
}

function hexPolygonPoints(hex, vertices) {
  return hex.vertexIds
    .map((vId) => {
      const v = vertices[vId];
      return `${v.x},${v.y}`;
    })
    .join(" ");
}

function drawNumberToken(layer, hex) {
  if (hex.number == null) return;
  const g = el("g", {}, layer);
  el("circle", {
    cx: hex.cx,
    cy: hex.cy,
    r: 17,
    fill: "#f4ecd6",
    stroke: "#7a6a4f",
    "stroke-width": 1.5,
  }, g);
  const red = hex.number === 6 || hex.number === 8;
  const text = el("text", {
    x: hex.cx,
    y: hex.cy + 1,
    "text-anchor": "middle",
    "dominant-baseline": "middle",
    "font-size": red ? 17 : 15,
    "font-weight": "bold",
    fill: red ? "#c0392b" : "#333",
  }, g);
  text.textContent = String(hex.number);
  // pips
  const pips = numberPips(hex.number);
  const pipW = 4;
  const startX = hex.cx - ((pips - 1) * pipW) / 2;
  for (let i = 0; i < pips; i++) {
    el("circle", {
      cx: startX + i * pipW,
      cy: hex.cy + 12,
      r: 1.3,
      fill: red ? "#c0392b" : "#555",
    }, g);
  }
}

function drawRobber(layer, hex) {
  const g = el("g", {}, layer);
  el("ellipse", {
    cx: hex.cx,
    cy: hex.cy + 20,
    rx: 11,
    ry: 5,
    fill: "#1f1f1f",
    opacity: 0.85,
  }, g);
  el("path", {
    d: `M ${hex.cx - 9} ${hex.cy + 20}
        Q ${hex.cx - 9} ${hex.cy - 2} ${hex.cx} ${hex.cy - 6}
        Q ${hex.cx + 9} ${hex.cy - 2} ${hex.cx + 9} ${hex.cy + 20} Z`,
    fill: "#2b2b2b",
    stroke: "#000",
    "stroke-width": 1,
  }, g);
  el("circle", {
    cx: hex.cx,
    cy: hex.cy - 8,
    r: 6,
    fill: "#2b2b2b",
    stroke: "#000",
    "stroke-width": 1,
  }, g);
}

function drawPorts(layer, state) {
  const board = state.board;
  const cx = board.viewWidth / 2;
  const cy = board.viewHeight / 2;
  for (const port of board.ports) {
    const [a, b] = port.vertexIds;
    const va = board.vertices[a];
    const vb = board.vertices[b];
    const mx = (va.x + vb.x) / 2;
    const my = (va.y + vb.y) / 2;
    // push outward from board center
    const dx = mx - cx;
    const dy = my - cy;
    const len = Math.hypot(dx, dy) || 1;
    const bx = mx + (dx / len) * 26;
    const by = my + (dy / len) * 26;

    const g = el("g", { class: "port" }, layer);
    el("line", { x1: va.x, y1: va.y, x2: bx, y2: by, stroke: "#8a6d3b", "stroke-width": 2, "stroke-dasharray": "3 2" }, g);
    el("line", { x1: vb.x, y1: vb.y, x2: bx, y2: by, stroke: "#8a6d3b", "stroke-width": 2, "stroke-dasharray": "3 2" }, g);
    const fill = port.type === "any" ? "#4b5d67" : RESOURCE_COLORS[port.type];
    el("circle", { cx: bx, cy: by, r: 15, fill, stroke: "#3a2c14", "stroke-width": 2 }, g);
    const icon = el("text", {
      x: bx, y: by - 2, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 12,
    }, g);
    icon.textContent = RESOURCE_ICON[port.type] || "?";
    const ratio = el("text", {
      x: bx, y: by + 9, "text-anchor": "middle", "dominant-baseline": "middle",
      "font-size": 7, "font-weight": "bold", fill: "#fff",
    }, g);
    ratio.textContent = port.type === "any" ? "3:1" : "2:1";
  }
}

function drawRoad(layer, edge, color) {
  el("line", {
    x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
    stroke: "#00000055", "stroke-width": 9, "stroke-linecap": "round",
  }, layer);
  el("line", {
    x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
    stroke: color, "stroke-width": 6, "stroke-linecap": "round",
  }, layer);
}

function drawSettlement(layer, v, color, textColor) {
  const g = el("g", {}, layer);
  const s = 9;
  el("polygon", {
    points: `${v.x - s},${v.y + s} ${v.x - s},${v.y - s * 0.2} ${v.x},${v.y - s} ${v.x + s},${v.y - s * 0.2} ${v.x + s},${v.y + s}`,
    fill: color, stroke: "#222", "stroke-width": 1.5, "stroke-linejoin": "round",
  }, g);
}

function drawCity(layer, v, color) {
  const g = el("g", {}, layer);
  const s = 8;
  // wider base with two roof peaks
  el("polygon", {
    points: [
      `${v.x - 13},${v.y + s}`,
      `${v.x - 13},${v.y - 2}`,
      `${v.x - 6},${v.y - 8}`,
      `${v.x + 1},${v.y - 2}`,
      `${v.x + 1},${v.y - 6}`,
      `${v.x + 8},${v.y - 11}`,
      `${v.x + 13},${v.y - 6}`,
      `${v.x + 13},${v.y + s}`,
    ].join(" "),
    fill: color, stroke: "#222", "stroke-width": 1.5, "stroke-linejoin": "round",
  }, g);
}

// Main render. options:
//  highlights: { vertices:Set, edges:Set, hexes:Set }
//  handlers: { onVertex, onEdge, onHex }
export function renderGame(svg, state, options = {}) {
  const { highlights = {}, handlers = {} } = options;
  const hv = highlights.vertices || new Set();
  const he = highlights.edges || new Set();
  const hh = highlights.hexes || new Set();

  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const board = state.board;
  svg.setAttribute("viewBox", `0 0 ${board.viewWidth} ${board.viewHeight}`);

  const hexLayer = el("g", {}, svg);
  const portLayer = el("g", {}, svg);
  const roadLayer = el("g", {}, svg);
  const buildingLayer = el("g", {}, svg);
  const highlightLayer = el("g", {}, svg);

  // Hexes
  for (const hex of board.hexes) {
    const g = el("g", {}, hexLayer);
    el("polygon", {
      points: hexPolygonPoints(hex, board.vertices),
      fill: RESOURCE_COLORS[hex.resource] || "#ccc",
      stroke: "#6b5a3e",
      "stroke-width": 2,
      "stroke-linejoin": "round",
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.12))",
    }, g);
    const icon = el("text", {
      x: hex.cx, y: hex.cy - 22, "text-anchor": "middle", "font-size": 15, opacity: 0.65,
    }, g);
    icon.textContent = RESOURCE_ICON[hex.resource] || "";
    drawNumberToken(g, hex);
    if (hex.hasRobber) drawRobber(g, hex);
  }

  drawPorts(portLayer, state);

  // Roads
  for (const edgeId of Object.keys(state.roads)) {
    const pIdx = state.roads[edgeId];
    const edge = board.edges[edgeId];
    drawRoad(roadLayer, edge, state.players[pIdx].color);
  }

  // Buildings
  for (const vId of Object.keys(state.buildings)) {
    const b = state.buildings[vId];
    const v = board.vertices[vId];
    const player = state.players[b.playerIndex];
    if (b.type === "city") drawCity(buildingLayer, v, player.color);
    else drawSettlement(buildingLayer, v, player.color, player.textColor);
  }

  // Highlights (interactive)
  for (const eId of he) {
    const edge = board.edges[eId];
    const line = el("line", {
      x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
      class: "hl-edge",
    }, highlightLayer);
    line.style.cursor = "pointer";
    line.addEventListener("click", () => handlers.onEdge && handlers.onEdge(eId));
  }
  for (const vId of hv) {
    const v = board.vertices[vId];
    const c = el("circle", {
      cx: v.x, cy: v.y, r: 10, class: "hl-vertex",
    }, highlightLayer);
    c.style.cursor = "pointer";
    c.addEventListener("click", () => handlers.onVertex && handlers.onVertex(vId));
  }
  for (const hexId of hh) {
    const hex = board.hexes[hexId];
    const c = el("circle", {
      cx: hex.cx, cy: hex.cy, r: 30, class: "hl-hex",
    }, highlightLayer);
    c.style.cursor = "pointer";
    c.addEventListener("click", () => handlers.onHex && handlers.onHex(hexId));
  }
}
