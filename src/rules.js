// Rules engine: build legality, resource production, the robber,
// longest road, largest army and victory-point scoring.

import { BUILD_COSTS, DEV_CARD_TYPES } from "./gamestate.js";
import { RESOURCES } from "./board.js";

// ---------- Resource helpers ----------

export function canAfford(player, cost) {
  return Object.keys(cost).every((r) => player.resources[r] >= cost[r]);
}

export function payToBank(state, player, cost) {
  for (const r of Object.keys(cost)) {
    player.resources[r] -= cost[r];
    state.bank[r] += cost[r];
  }
}

export function takeFromBank(state, player, gains) {
  for (const r of Object.keys(gains)) {
    const amount = Math.min(gains[r], state.bank[r]);
    player.resources[r] += amount;
    state.bank[r] -= amount;
  }
}

// ---------- Board lookups ----------

export function buildingAt(state, vertexId) {
  return state.buildings[vertexId] || null;
}

export function roadAt(state, edgeId) {
  return state.roads[edgeId];
}

// ---------- Settlement placement ----------

export function canPlaceSettlement(state, playerIndex, vertexId, isSetup) {
  const vertex = state.board.vertices[vertexId];
  if (!vertex) return false;
  if (buildingAt(state, vertexId)) return false;

  // Distance rule: no adjacent vertex may have a building.
  for (const adj of vertex.adjacentVertexIds) {
    if (buildingAt(state, adj)) return false;
  }

  if (isSetup) return true;

  // Must connect to one of the player's roads.
  const connected = vertex.edgeIds.some(
    (eId) => state.roads[eId] === playerIndex
  );
  return connected;
}

export function getValidSettlementVertices(state, playerIndex, isSetup) {
  const result = [];
  for (const v of state.board.vertices) {
    if (canPlaceSettlement(state, playerIndex, v.id, isSetup)) result.push(v.id);
  }
  return result;
}

export function getValidCityVertices(state, playerIndex) {
  const result = [];
  for (const vId of Object.keys(state.buildings)) {
    const b = state.buildings[vId];
    if (b.playerIndex === playerIndex && b.type === "settlement") {
      result.push(Number(vId));
    }
  }
  return result;
}

// ---------- Road placement ----------

export function canPlaceRoad(state, playerIndex, edgeId, isSetup, fromVertex) {
  const edge = state.board.edges[edgeId];
  if (!edge) return false;
  if (state.roads[edgeId] !== undefined) return false;

  if (isSetup) {
    // Must touch the settlement just placed.
    return edge.vertexIds.includes(fromVertex);
  }

  // Connected if an endpoint has the player's building, or the player's road
  // reaches that endpoint and it isn't blocked by an opponent's building.
  for (const v of edge.vertexIds) {
    const b = buildingAt(state, v);
    if (b && b.playerIndex === playerIndex) return true;
    if (b && b.playerIndex !== playerIndex) continue; // blocked at this vertex
    const vertex = state.board.vertices[v];
    const hasOwnRoad = vertex.edgeIds.some(
      (eId) => eId !== edgeId && state.roads[eId] === playerIndex
    );
    if (hasOwnRoad) return true;
  }
  return false;
}

export function getValidRoadEdges(state, playerIndex, isSetup, fromVertex) {
  const result = [];
  for (const e of state.board.edges) {
    if (canPlaceRoad(state, playerIndex, e.id, isSetup, fromVertex))
      result.push(e.id);
  }
  return result;
}

// ---------- Mutations ----------

export function placeSettlement(state, playerIndex, vertexId) {
  state.buildings[vertexId] = { playerIndex, type: "settlement" };
  state.players[playerIndex].settlementsLeft--;
}

export function placeCity(state, playerIndex, vertexId) {
  state.buildings[vertexId] = { playerIndex, type: "city" };
  const p = state.players[playerIndex];
  p.settlementsLeft++;
  p.citiesLeft--;
}

export function placeRoad(state, playerIndex, edgeId) {
  state.roads[edgeId] = playerIndex;
  state.players[playerIndex].roadsLeft--;
}

// Give resources for the second setup settlement (one per adjacent hex).
export function giveSetupResources(state, playerIndex, vertexId) {
  const vertex = state.board.vertices[vertexId];
  const player = state.players[playerIndex];
  const gains = {};
  for (const hexId of vertex.hexIds) {
    const hex = state.board.hexes[hexId];
    if (hex.resource && hex.resource !== "desert") {
      gains[hex.resource] = (gains[hex.resource] || 0) + 1;
    }
  }
  takeFromBank(state, player, gains);
  return gains;
}

// ---------- Production ----------

export function produceResources(state, roll) {
  // Collect demand: playerIndex -> resource -> amount.
  const demand = state.players.map(() => ({}));
  for (const hex of state.board.hexes) {
    if (hex.number !== roll) continue;
    if (hex.hasRobber) continue;
    const res = hex.resource;
    if (!res || res === "desert") continue;
    for (const vId of hex.vertexIds) {
      const b = state.buildings[vId];
      if (!b) continue;
      const amount = b.type === "city" ? 2 : 1;
      demand[b.playerIndex][res] = (demand[b.playerIndex][res] || 0) + amount;
    }
  }

  // Apply bank scarcity rule per resource.
  const gains = state.players.map(() => ({}));
  for (const res of RESOURCES) {
    let totalDemand = 0;
    let claimants = 0;
    for (let i = 0; i < state.players.length; i++) {
      const d = demand[i][res] || 0;
      if (d > 0) {
        totalDemand += d;
        claimants++;
      }
    }
    if (totalDemand === 0) continue;
    if (state.bank[res] >= totalDemand) {
      for (let i = 0; i < state.players.length; i++) {
        const d = demand[i][res] || 0;
        if (d > 0) gains[i][res] = d;
      }
    } else if (claimants === 1) {
      // Single claimant gets whatever remains.
      for (let i = 0; i < state.players.length; i++) {
        const d = demand[i][res] || 0;
        if (d > 0) gains[i][res] = Math.min(d, state.bank[res]);
      }
    }
    // else: not enough for multiple claimants -> nobody gets this resource.
  }

  for (let i = 0; i < state.players.length; i++) {
    takeFromBank(state, state.players[i], gains[i]);
  }
  return gains;
}

// ---------- Robber ----------

export function moveRobber(state, hexId) {
  for (const hex of state.board.hexes) hex.hasRobber = false;
  state.board.hexes[hexId].hasRobber = true;
  state.robberHexId = hexId;
}

export function playersToStealFrom(state, hexId, currentPlayerIndex) {
  const hex = state.board.hexes[hexId];
  const set = new Set();
  for (const vId of hex.vertexIds) {
    const b = state.buildings[vId];
    if (b && b.playerIndex !== currentPlayerIndex) {
      const victim = state.players[b.playerIndex];
      const total = RESOURCES.reduce((s, r) => s + victim.resources[r], 0);
      if (total > 0) set.add(b.playerIndex);
    }
  }
  return [...set];
}

export function stealResource(state, fromIndex, toIndex) {
  const victim = state.players[fromIndex];
  const pool = [];
  for (const r of RESOURCES) {
    for (let i = 0; i < victim.resources[r]; i++) pool.push(r);
  }
  if (pool.length === 0) return null;
  const res = pool[Math.floor(Math.random() * pool.length)];
  victim.resources[res]--;
  state.players[toIndex].resources[res]++;
  return res;
}

export function discardCount(player) {
  const total = RESOURCES.reduce((s, r) => s + player.resources[r], 0);
  return total > 7 ? Math.floor(total / 2) : 0;
}

// ---------- Longest road ----------

function playerRoadGraph(state, playerIndex) {
  // vertex -> list of { edgeId, to }
  const graph = {};
  for (const e of state.board.edges) {
    if (state.roads[e.id] !== playerIndex) continue;
    const [a, b] = e.vertexIds;
    (graph[a] = graph[a] || []).push({ edgeId: e.id, to: b });
    (graph[b] = graph[b] || []).push({ edgeId: e.id, to: a });
  }
  return graph;
}

export function longestRoadForPlayer(state, playerIndex) {
  const graph = playerRoadGraph(state, playerIndex);
  const vertices = Object.keys(graph).map(Number);
  if (vertices.length === 0) return 0;

  let best = 0;

  function dfs(vertex, usedEdges, length) {
    if (length > best) best = length;
    for (const { edgeId, to } of graph[vertex]) {
      if (usedEdges.has(edgeId)) continue;
      // Cannot pass through a vertex occupied by an opponent.
      const b = state.buildings[vertex];
      if (b && b.playerIndex !== playerIndex) continue;
      usedEdges.add(edgeId);
      dfs(to, usedEdges, length + 1);
      usedEdges.delete(edgeId);
    }
  }

  for (const v of vertices) {
    dfs(v, new Set(), 0);
  }
  return best;
}

export function recalcLongestRoad(state) {
  let changed = false;
  for (const p of state.players) {
    p.longestRoadLength = longestRoadForPlayer(state, p.id);
  }
  const currentOwner =
    state.longestRoadOwner != null ? state.players[state.longestRoadOwner] : null;
  const currentLen = currentOwner ? currentOwner.longestRoadLength : 0;

  // Find max length among players with >= 5.
  let maxLen = 0;
  let leaders = [];
  for (const p of state.players) {
    if (p.longestRoadLength >= 5) {
      if (p.longestRoadLength > maxLen) {
        maxLen = p.longestRoadLength;
        leaders = [p.id];
      } else if (p.longestRoadLength === maxLen) {
        leaders.push(p.id);
      }
    }
  }

  if (maxLen < 5) {
    // Nobody qualifies (e.g. road got cut below 5).
    if (currentOwner && currentOwner.longestRoadLength < 5) {
      currentOwner.hasLongestRoad = false;
      state.longestRoadOwner = null;
      changed = true;
    }
    return changed;
  }

  // Current owner keeps it unless strictly beaten.
  if (currentOwner && currentOwner.longestRoadLength === maxLen) {
    return changed;
  }
  if (leaders.length === 1 && maxLen > currentLen) {
    if (currentOwner) currentOwner.hasLongestRoad = false;
    state.players[leaders[0]].hasLongestRoad = true;
    state.longestRoadOwner = leaders[0];
    changed = true;
  } else if (!currentOwner && leaders.length === 1) {
    state.players[leaders[0]].hasLongestRoad = true;
    state.longestRoadOwner = leaders[0];
    changed = true;
  }
  return changed;
}

// ---------- Largest army ----------

export function recalcLargestArmy(state) {
  let changed = false;
  const currentOwner =
    state.largestArmyOwner != null ? state.players[state.largestArmyOwner] : null;
  const currentCount = currentOwner ? currentOwner.playedKnights : 0;

  let maxCount = 0;
  let leader = null;
  let tie = false;
  for (const p of state.players) {
    if (p.playedKnights > maxCount) {
      maxCount = p.playedKnights;
      leader = p.id;
      tie = false;
    } else if (p.playedKnights === maxCount && maxCount > 0) {
      tie = true;
    }
  }

  if (maxCount < 3) return changed;
  if (currentOwner && currentOwner.playedKnights === maxCount) return changed;
  if (leader != null && !tie && maxCount > currentCount) {
    if (currentOwner) currentOwner.hasLargestArmy = false;
    state.players[leader].hasLargestArmy = true;
    state.largestArmyOwner = leader;
    changed = true;
  }
  return changed;
}

// ---------- Scoring ----------

export function countBuildings(state, playerIndex) {
  let settlements = 0;
  let cities = 0;
  for (const vId of Object.keys(state.buildings)) {
    const b = state.buildings[vId];
    if (b.playerIndex !== playerIndex) continue;
    if (b.type === "settlement") settlements++;
    else if (b.type === "city") cities++;
  }
  return { settlements, cities };
}

// Public victory points (visible to everyone).
export function publicVictoryPoints(state, playerIndex) {
  const p = state.players[playerIndex];
  const { settlements, cities } = countBuildings(state, playerIndex);
  let vp = settlements + cities * 2;
  if (p.hasLongestRoad) vp += 2;
  if (p.hasLargestArmy) vp += 2;
  return vp;
}

// Total victory points including hidden VP dev cards (for win checks).
export function totalVictoryPoints(state, playerIndex) {
  const p = state.players[playerIndex];
  return (
    publicVictoryPoints(state, playerIndex) +
    p.devCards.victoryPoint +
    p.newDevCards.victoryPoint
  );
}

export function checkWinner(state) {
  for (const p of state.players) {
    if (totalVictoryPoints(state, p.id) >= 10) return p.id;
  }
  return null;
}
