// Computer player: VP-driven, blocks leaders, multi-resource trades, no random moves.

import { numberPips, RESOURCES } from "./board.js";
import { BUILD_COSTS, totalResourceCards } from "./gamestate.js";
import {
  canAfford,
  getValidSettlementVertices,
  getValidCityVertices,
  getValidRoadEdges,
  totalVictoryPoints,
  longestRoadForPlayer,
} from "./rules.js";
import {
  bankTradeRatio,
  canBankTrade,
  canPlayerTrade,
  bundleTotal,
} from "./trade.js";

const WIN_VP = 10;
const BLOCK_THRESHOLD = 7;

// ---------- Scoring helpers ----------

function leaderInfo(state) {
  let id = 0;
  let vp = -1;
  for (const p of state.players) {
    const v = totalVictoryPoints(state, p.id);
    if (v > vp) {
      vp = v;
      id = p.id;
    }
  }
  return { id, vp };
}

function vpUrgency(state, playerIndex) {
  const myVp = totalVictoryPoints(state, playerIndex);
  const { vp: leaderVp } = leaderInfo(state);
  if (leaderVp >= BLOCK_THRESHOLD && leaderInfo(state).id !== playerIndex) return 2.5;
  if (myVp >= 8) return 2;
  if (myVp >= 6) return 1.5;
  return 1;
}

function vertexScore(state, vertexId) {
  const v = state.board.vertices[vertexId];
  let score = 0;
  const resourceSet = new Set();
  for (const hexId of v.hexIds) {
    const hex = state.board.hexes[hexId];
    if (!hex.resource || hex.resource === "desert") continue;
    score += numberPips(hex.number);
    resourceSet.add(hex.resource);
  }
  score += resourceSet.size * 1.5;
  if (v.port === "any") score += 1.5;
  else if (v.port) score += 2;
  return score;
}

function blockingBonus(state, playerIndex, vertexId) {
  const leader = leaderInfo(state);
  let bonus = 0;
  const v = state.board.vertices[vertexId];

  for (const adj of v.adjacentVertexIds) {
    if (state.buildings[adj]) continue;
    for (const eId of state.board.vertices[adj].edgeIds) {
      const owner = state.roads[eId];
      if (owner == null || owner === playerIndex) continue;
      const threat = totalVictoryPoints(state, owner);
      bonus += vertexScore(state, vertexId) * 0.35 + threat * 0.6;
      if (owner === leader.id && leader.vp >= BLOCK_THRESHOLD) bonus += 6;
    }
  }

  for (const hexId of v.hexIds) {
    const hex = state.board.hexes[hexId];
    if (!hex.resource || hex.resource === "desert") continue;
    for (const vId of hex.vertexIds) {
      const b = state.buildings[vId];
      if (!b || b.playerIndex === playerIndex) continue;
      const mult = b.type === "city" ? 2 : 1;
      bonus += numberPips(hex.number) * mult * 0.25;
      if (b.playerIndex === leader.id && leader.vp >= BLOCK_THRESHOLD) bonus += 4;
    }
  }

  return bonus;
}

function scoreVertex(state, playerIndex, vertexId) {
  return (
    vertexScore(state, vertexId) * vpUrgency(state, playerIndex) +
    blockingBonus(state, playerIndex, vertexId)
  );
}

function bestVertex(state, playerIndex, vertexIds) {
  let best = vertexIds[0];
  let bestScore = -Infinity;
  for (const vId of vertexIds) {
    const s = scoreVertex(state, playerIndex, vId);
    if (s > bestScore) {
      bestScore = s;
      best = vId;
    }
  }
  return best;
}

function withTempRoad(state, playerIndex, edgeId, fn) {
  state.roads[edgeId] = playerIndex;
  const result = fn();
  delete state.roads[edgeId];
  return result;
}

function scoreRoadEdge(state, playerIndex, edgeId) {
  const p = state.players[playerIndex];
  const beforeLen = longestRoadForPlayer(state, playerIndex);

  const directSettlement = withTempRoad(state, playerIndex, edgeId, () => {
    const verts = getValidSettlementVertices(state, playerIndex, false);
    if (verts.length === 0) return 0;
    return Math.max(...verts.map((vId) => scoreVertex(state, playerIndex, vId)));
  });

  const afterLen = withTempRoad(state, playerIndex, edgeId, () =>
    longestRoadForPlayer(state, playerIndex)
  );

  let score = directSettlement;
  if (directSettlement > 0) score += 8;

  if (afterLen > beforeLen) {
    score += afterLen - beforeLen;
    if (afterLen >= 5 && !p.hasLongestRoad) score += 5;
    if (p.hasLongestRoad) score += (afterLen - beforeLen) * 1.5;
  }

  const edge = state.board.edges[edgeId];
  for (const vId of edge.vertexIds) {
    score += blockingBonus(state, playerIndex, vId) * 0.4;
    score += Math.max(
      vertexScore(state, edge.vertexIds[0]),
      vertexScore(state, edge.vertexIds[1])
    ) * 0.15;
  }

  return score;
}

function bestRoadEdge(state, playerIndex, edges) {
  let best = edges[0];
  let bestScore = -Infinity;
  for (const eId of edges) {
    const s = scoreRoadEdge(state, playerIndex, eId);
    if (s > bestScore) {
      bestScore = s;
      best = eId;
    }
  }
  return best;
}

function buildOptions(state, playerIndex) {
  const p = state.players[playerIndex];
  const opts = [];

  if (p.citiesLeft > 0 && canAfford(p, BUILD_COSTS.city)) {
    const verts = getValidCityVertices(state, playerIndex);
    if (verts.length > 0) {
      opts.push({
        type: "city",
        cost: BUILD_COSTS.city,
        vp: 1,
        verts,
        score: 12 * vpUrgency(state, playerIndex),
      });
    }
  }

  if (p.settlementsLeft > 0 && canAfford(p, BUILD_COSTS.settlement)) {
    const verts = getValidSettlementVertices(state, playerIndex, false);
    if (verts.length > 0) {
      const best = Math.max(...verts.map((vId) => scoreVertex(state, playerIndex, vId)));
      opts.push({
        type: "settlement",
        cost: BUILD_COSTS.settlement,
        vp: 1,
        verts,
        score: 10 * vpUrgency(state, playerIndex) + best * 0.1,
      });
    }
  }

  if (p.roadsLeft > 0 && canAfford(p, BUILD_COSTS.road)) {
    const edges = getValidRoadEdges(state, playerIndex, false);
    if (edges.length > 0) {
      const best = Math.max(...edges.map((eId) => scoreRoadEdge(state, playerIndex, eId)));
      if (best > 2) {
        opts.push({
          type: "road",
          cost: BUILD_COSTS.road,
          vp: 0,
          edges,
          score: best,
        });
      }
    }
  }

  return opts.sort((a, b) => b.score - a.score);
}

function primaryGoal(state, playerIndex) {
  const opts = buildOptions(state, playerIndex);
  if (opts.length > 0) return opts[0].cost;

  const p = state.players[playerIndex];
  if (p.citiesLeft > 0 && getValidCityVertices(state, playerIndex).length > 0)
    return BUILD_COSTS.city;
  if (
    p.settlementsLeft > 0 &&
    getValidSettlementVertices(state, playerIndex, false).length > 0
  )
    return BUILD_COSTS.settlement;
  if (p.roadsLeft > 0) {
    const edges = getValidRoadEdges(state, playerIndex, false);
    if (edges.some((eId) => scoreRoadEdge(state, playerIndex, eId) > 2))
      return BUILD_COSTS.road;
  }
  if (state.devDeck.length > 0) return BUILD_COSTS.devCard;
  return BUILD_COSTS.settlement;
}

function missingForGoal(state, playerIndex, goal) {
  const p = state.players[playerIndex];
  const g = goal || primaryGoal(state, playerIndex);
  const need = {};
  for (const r of Object.keys(g)) {
    const deficit = g[r] - p.resources[r];
    if (deficit > 0) need[r] = deficit;
  }
  return need;
}

function surplusForGoal(p, goal) {
  const surplus = {};
  for (const r of RESOURCES) {
    const keep = (goal[r] || 0) + 1;
    const extra = p.resources[r] - keep;
    if (extra > 0) surplus[r] = extra;
  }
  return surplus;
}

function goalProgressScore(state, playerIndex, goal) {
  const need = missingForGoal(state, playerIndex, goal);
  const missing = Object.values(need).reduce((a, b) => a + b, 0);
  const vpGain =
    goal === BUILD_COSTS.city || goal === BUILD_COSTS.settlement ? 1 : 0;
  return vpGain * 20 - missing * 3;
}

function simulateTradeProgress(state, playerIndex, give, receive, goal) {
  const p = state.players[playerIndex];
  const before = goalProgressScore(state, playerIndex, goal);
  const saved = RESOURCES.map((r) => p.resources[r]);
  for (const r of Object.keys(give)) p.resources[r] -= give[r];
  for (const r of Object.keys(receive)) p.resources[r] += receive[r];
  const after = goalProgressScore(state, playerIndex, goal);
  RESOURCES.forEach((r, i) => {
    p.resources[r] = saved[i];
  });
  return after - before;
}

function addToBundle(bundle, resource, amount) {
  if (amount <= 0) return;
  bundle[resource] = (bundle[resource] || 0) + amount;
}

/** Build multi-resource give/receive bundles toward the current goal. */
function enumerateTradeBundles(need, surplus, maxGive = 3) {
  const offers = [];
  const needRes = Object.keys(need);
  const surRes = Object.keys(surplus);
  if (needRes.length === 0 || surRes.length === 0) return offers;

  for (let gTotal = 1; gTotal <= maxGive; gTotal++) {
    for (const giveRes of surRes) {
      if (surplus[giveRes] < gTotal) continue;
      for (const wantRes of needRes) {
        const give = { [giveRes]: gTotal };
        const receive = { [wantRes]: Math.min(need[wantRes], gTotal === 1 ? 1 : 2) };
        offers.push({ give, receive });
      }
    }
  }

  if (needRes.length >= 2) {
    for (let a = 0; a < surRes.length; a++) {
      for (let b = a; b < surRes.length; b++) {
        const r1 = surRes[a];
        const r2 = surRes[b];
        if (surplus[r1] < 1 || (r1 !== r2 && surplus[r2] < 1)) continue;
        const give = {};
        addToBundle(give, r1, 1);
        if (r1 !== r2) addToBundle(give, r2, 1);
        else if (surplus[r1] >= 2) addToBundle(give, r1, 2);
        else continue;

        if (bundleTotal(give) > maxGive) continue;

        const receive = {};
        addToBundle(receive, needRes[0], Math.min(need[needRes[0]], 1));
        if (needRes.length > 1)
          addToBundle(receive, needRes[1], Math.min(need[needRes[1]], 1));
        if (bundleTotal(receive) === 0) continue;
        offers.push({ give, receive });
      }
    }
  }

  if (needRes.length >= 2 && surRes.length >= 1) {
    for (const giveRes of surRes) {
      if (surplus[giveRes] < 2) continue;
      const give = { [giveRes]: 2 };
      const receive = {};
      addToBundle(receive, needRes[0], Math.min(need[needRes[0]], 1));
      if (needRes.length > 1)
        addToBundle(receive, needRes[1], Math.min(need[needRes[1]], 1));
      offers.push({ give, receive });
    }
  }

  return offers;
}

function tradeOfferKey(from, to, give, receive) {
  return `${from}|${to}|${JSON.stringify(give)}|${JSON.stringify(receive)}`;
}

function isRejectedTrade(state, from, to, give, receive) {
  return (state.tradeRejectKeys || []).includes(
    tradeOfferKey(from, to, give, receive)
  );
}

function targetPlayerOrder(state, playerIndex) {
  const order = [];
  for (let i = 0; i < state.players.length; i++) {
    if (i !== playerIndex) order.push(i);
  }
  order.sort((a, b) => {
    const ah = state.players[a].isAI ? 1 : 0;
    const bh = state.players[b].isAI ? 1 : 0;
    if (ah !== bh) return ah - bh;
    return totalVictoryPoints(state, b) - totalVictoryPoints(state, a);
  });
  return order;
}

// ---------- Public setup / discard / robber ----------

export function aiChooseSetupSettlement(state, playerIndex) {
  const valid = getValidSettlementVertices(state, playerIndex, true);
  return bestVertex(state, playerIndex, valid);
}

export function aiChooseSetupRoad(state, playerIndex, fromVertex) {
  const valid = getValidRoadEdges(state, playerIndex, true, fromVertex);
  return bestRoadEdge(state, playerIndex, valid);
}

export function aiChooseDiscard(state, playerIndex, count) {
  const p = state.players[playerIndex];
  const goal = primaryGoal(state, playerIndex);
  const pool = [];
  for (const r of RESOURCES) {
    for (let i = 0; i < p.resources[r]; i++) pool.push(r);
  }
  pool.sort((a, b) => {
    const keepA = goal[a] ? 1 : 0;
    const keepB = goal[b] ? 1 : 0;
    if (keepA !== keepB) return keepA - keepB;
    return p.resources[b] - p.resources[a];
  });
  const bundle = {};
  for (let i = 0; i < count; i++) {
    const r = pool[i];
    bundle[r] = (bundle[r] || 0) + 1;
  }
  return bundle;
}

export function aiChooseRobberHex(state, playerIndex) {
  const leader = leaderInfo(state);
  let best = null;
  let bestScore = -Infinity;

  for (const hex of state.board.hexes) {
    if (hex.hasRobber || !hex.resource || hex.resource === "desert") continue;
    let score = 0;
    let touchesSelf = false;

    for (const vId of hex.vertexIds) {
      const b = state.buildings[vId];
      if (!b) continue;
      if (b.playerIndex === playerIndex) {
        touchesSelf = true;
        continue;
      }
      const mult = b.type === "city" ? 2 : 1;
      const vp = totalVictoryPoints(state, b.playerIndex);
      score += numberPips(hex.number) * mult * (1 + vp * 0.5);
      if (b.playerIndex === leader.id && leader.vp >= BLOCK_THRESHOLD) score += 12;
      if (vp >= WIN_VP - 2) score += 15;
    }

    if (touchesSelf) score -= 120;
    if (score > bestScore) {
      bestScore = score;
      best = hex.id;
    }
  }

  return best ?? state.board.hexes.find((h) => !h.hasRobber).id;
}

export function aiChooseSteal(state, playerIndex, candidates) {
  let best = candidates[0];
  let bestScore = -Infinity;
  const leader = leaderInfo(state);

  for (const c of candidates) {
    const cards = totalResourceCards(state.players[c]);
    const vp = totalVictoryPoints(state, c);
    let score = cards + vp * 3;
    if (c === leader.id) score += 10;
    if (vp >= WIN_VP - 2) score += 20;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

export function aiChooseYearOfPlenty(state, playerIndex) {
  const need = missingForGoal(state, playerIndex);
  const picks = [];
  const sorted = Object.keys(need).sort((a, b) => need[b] - need[a]);
  for (const r of sorted) {
    for (let i = 0; i < need[r] && picks.length < 2; i++) picks.push(r);
  }
  while (picks.length < 2) {
    const fallback = sorted[0] || "wheat";
    picks.push(fallback);
  }
  return [picks[0], picks[1]];
}

export function aiChooseMonopoly(state, playerIndex) {
  const need = missingForGoal(state, playerIndex);
  let best = Object.keys(need)[0] || "wheat";
  let bestCount = -1;

  for (const r of RESOURCES) {
    let count = 0;
    for (const p of state.players) {
      if (p.id !== playerIndex) count += p.resources[r];
    }
    const weight = count + (need[r] ? 5 : 0);
    if (weight > bestCount) {
      bestCount = weight;
      best = r;
    }
  }
  return best;
}

export function aiShouldPlayKnight(state, playerIndex) {
  const p = state.players[playerIndex];
  const cards = totalResourceCards(p);
  const leader = leaderInfo(state);
  const robberHex = state.board.hexes[state.robberHexId];

  const blockingUs = robberHex.vertexIds.some((v) => {
    const b = state.buildings[v];
    return b && b.playerIndex === playerIndex;
  });
  if (blockingUs) return true;
  if (cards >= 8) return true;
  if (p.playedKnights >= 2 && !p.hasLargestArmy) return true;

  const leaderOnRobberHex = robberHex.vertexIds.some((v) => {
    const b = state.buildings[v];
    return b && b.playerIndex === leader.id && leader.vp >= BLOCK_THRESHOLD;
  });
  if (leaderOnRobberHex) return true;
  if (leader.id !== playerIndex && leader.vp >= BLOCK_THRESHOLD && cards >= 5)
    return true;

  return false;
}

export function aiShouldPlayYearOfPlenty(state, playerIndex) {
  const need = missingForGoal(state, playerIndex);
  return Object.values(need).reduce((a, b) => a + b, 0) > 0;
}

export function aiShouldPlayRoadBuilding(state, playerIndex) {
  const edges = getValidRoadEdges(state, playerIndex, false);
  return edges.some((eId) => scoreRoadEdge(state, playerIndex, eId) >= 4);
}

export function aiShouldPlayMonopoly(state, playerIndex, resource) {
  let pool = 0;
  for (const o of state.players) {
    if (o.id !== playerIndex) pool += o.resources[resource];
  }
  if (pool < 2) return false;
  const need = missingForGoal(state, playerIndex);
  return !!need[resource] || pool >= 4;
}

export function aiFindBankTrade(state, playerIndex) {
  const p = state.players[playerIndex];
  const goals = [
    BUILD_COSTS.city,
    BUILD_COSTS.settlement,
    BUILD_COSTS.road,
    BUILD_COSTS.devCard,
  ];

  let best = null;
  let bestGain = 0;

  for (const goal of goals) {
    if (goal === BUILD_COSTS.city && getValidCityVertices(state, playerIndex).length === 0)
      continue;
    if (
      goal === BUILD_COSTS.settlement &&
      (p.settlementsLeft === 0 ||
        getValidSettlementVertices(state, playerIndex, false).length === 0)
    )
      continue;
    if (goal === BUILD_COSTS.road && p.roadsLeft === 0) continue;

    const need = missingForGoal(state, playerIndex, goal);
    if (Object.keys(need).length === 0) continue;

    for (const wantRes of Object.keys(need)) {
      for (const give of RESOURCES) {
        if (goal[give] && p.resources[give] <= goal[give]) continue;
        if (!canBankTrade(state, playerIndex, give, wantRes)) continue;
        const receive = { [wantRes]: 1 };
        const giveBundle = {
          [give]: bankTradeRatio(state, playerIndex, give),
        };
        const gain = simulateTradeProgress(
          state,
          playerIndex,
          giveBundle,
          receive,
          goal
        );
        if (gain > bestGain) {
          bestGain = gain;
          best = { type: "bankTrade", give, receive: wantRes };
        }
      }
    }
  }

  if (bestGain > 0) return best;

  const handSize = totalResourceCards(p);
  if (handSize >= 8) {
    const goal = primaryGoal(state, playerIndex);
    const need = missingForGoal(state, playerIndex, goal);
    for (const give of RESOURCES) {
      if (p.resources[give] < 4) continue;
      for (const receive of Object.keys(need).length ? Object.keys(need) : RESOURCES) {
        if (receive === give) continue;
        if (canBankTrade(state, playerIndex, give, receive))
          return { type: "bankTrade", give, receive };
      }
    }
  }

  return null;
}

export function aiFindPlayerTrade(state, playerIndex) {
  const p = state.players[playerIndex];
  const goal = primaryGoal(state, playerIndex);
  const need = missingForGoal(state, playerIndex, goal);
  if (Object.keys(need).length === 0) return null;

  const surplus = surplusForGoal(p, goal);
  const handSize = totalResourceCards(p);
  const candidates = enumerateTradeBundles(need, surplus, handSize >= 7 ? 3 : 2);

  for (const giveRes of RESOURCES) {
    if (giveRes in surplus || p.resources[giveRes] < 2) continue;
    if (goal[giveRes] && p.resources[giveRes] <= goal[giveRes] + 1) continue;
    for (const wantRes of Object.keys(need)) {
      candidates.push({ give: { [giveRes]: 2 }, receive: { [wantRes]: 1 } });
      if (Object.keys(need).length > 1) {
        const receive = { [wantRes]: 1 };
        const other = Object.keys(need).find((r) => r !== wantRes);
        if (other) receive[other] = 1;
        candidates.push({ give: { [giveRes]: 2 }, receive });
      }
    }
  }

  let best = null;
  let bestGain = 0;

  for (const targetIdx of targetPlayerOrder(state, playerIndex)) {
    const target = state.players[targetIdx];

    for (const { give, receive } of candidates) {
      if (isRejectedTrade(state, playerIndex, targetIdx, give, receive)) continue;
      if (!canPlayerTrade(state, playerIndex, targetIdx, give, receive)) continue;

      const gain = simulateTradeProgress(state, playerIndex, give, receive, goal);
      if (gain <= 0) continue;

      if (!target.isAI) {
        if (gain > bestGain) {
          bestGain = gain;
          best = { targetIdx, give, receive };
        }
        continue;
      }

      if (aiEvaluateTrade(state, targetIdx, receive, give) && gain > bestGain) {
        bestGain = gain;
        best = { targetIdx, give, receive };
      }
    }
  }

  return best;
}

export function aiEvaluateTrade(state, playerIndex, offer, askFor) {
  const p = state.players[playerIndex];
  for (const r of Object.keys(askFor)) {
    if (p.resources[r] < askFor[r]) return false;
  }

  const goal = primaryGoal(state, playerIndex);
  const progress = simulateTradeProgress(state, playerIndex, askFor, offer, goal);
  if (progress <= 0) return false;

  const offerTotal = bundleTotal(offer);
  const askTotal = bundleTotal(askFor);
  if (offerTotal > askTotal + 1) return false;

  const leader = leaderInfo(state);
  if (playerIndex === leader.id && leader.vp >= WIN_VP - 1) {
    return progress >= 3;
  }

  return true;
}

export function aiActionStep(state, playerIndex) {
  const p = state.players[playerIndex];
  const handSize = totalResourceCards(p);

  if (state.freeRoads > 0 && p.roadsLeft > 0) {
    const edges = getValidRoadEdges(state, playerIndex, false);
    if (edges.length > 0) {
      const best = bestRoadEdge(state, playerIndex, edges);
      if (scoreRoadEdge(state, playerIndex, best) > 0)
        return { type: "buildRoad", edgeId: best };
    }
  }

  const opts = buildOptions(state, playerIndex);
  if (opts.length > 0) {
    const top = opts[0];
    if (top.type === "city")
      return {
        type: "buildCity",
        vertexId: bestVertex(state, playerIndex, top.verts),
      };
    if (top.type === "settlement")
      return {
        type: "buildSettlement",
        vertexId: bestVertex(state, playerIndex, top.verts),
      };
    if (top.type === "road" && top.score > 2)
      return {
        type: "buildRoad",
        edgeId: bestRoadEdge(state, playerIndex, top.edges),
      };
  }

  if (
    !state.skipPlayerTradeThisTurn &&
    (state.tradesThisTurn || 0) < (state.maxTradesPerTurn || 2)
  ) {
    const pt = aiFindPlayerTrade(state, playerIndex);
    if (pt) return { type: "playerTrade", ...pt };
  }

  if ((state.tradesThisTurn || 0) < (state.maxTradesPerTurn || 2)) {
    const bt = aiFindBankTrade(state, playerIndex);
    if (bt) return bt;
  }

  const goal = primaryGoal(state, playerIndex);
  const need = missingForGoal(state, playerIndex, goal);
  const missingTotal = Object.values(need).reduce((a, b) => a + b, 0);

  if (
    state.devDeck.length > 0 &&
    canAfford(p, BUILD_COSTS.devCard) &&
    missingTotal >= 2 &&
    (handSize >= 7 || p.playedKnights < 3)
  ) {
    return { type: "buyDev" };
  }

  if (handSize >= 8 && (state.tradesThisTurn || 0) < (state.maxTradesPerTurn || 2)) {
    for (const give of RESOURCES) {
      if (p.resources[give] >= 4) {
        for (const receive of RESOURCES) {
          if (receive === give) continue;
          if (canBankTrade(state, playerIndex, give, receive))
            return { type: "bankTrade", give, receive };
        }
      }
    }
  }

  return { type: "end" };
}
