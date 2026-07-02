// Trading: with the bank (4:1), via ports (3:1 / 2:1) and between players.

import { RESOURCES } from "./board.js";

// The set of port types a player can use (based on their buildings).
export function getPlayerPorts(state, playerIndex) {
  const ports = new Set();
  for (const vId of Object.keys(state.buildings)) {
    const b = state.buildings[vId];
    if (b.playerIndex !== playerIndex) continue;
    const port = state.board.vertices[vId].port;
    if (port) ports.add(port);
  }
  return ports;
}

// Best exchange ratio for giving a specific resource.
export function bankTradeRatio(state, playerIndex, resource) {
  const ports = getPlayerPorts(state, playerIndex);
  if (ports.has(resource)) return 2;
  if (ports.has("any")) return 3;
  return 4;
}

export function canBankTrade(state, playerIndex, give, receive) {
  if (give === receive) return false;
  const p = state.players[playerIndex];
  const ratio = bankTradeRatio(state, playerIndex, give);
  return p.resources[give] >= ratio && state.bank[receive] > 0;
}

export function executeBankTrade(state, playerIndex, give, receive) {
  if (!canBankTrade(state, playerIndex, give, receive)) return false;
  const p = state.players[playerIndex];
  const ratio = bankTradeRatio(state, playerIndex, give);
  p.resources[give] -= ratio;
  state.bank[give] += ratio;
  p.resources[receive] += 1;
  state.bank[receive] -= 1;
  return true;
}

function hasResources(player, bundle) {
  return Object.keys(bundle).every((r) => player.resources[r] >= bundle[r]);
}

// A player-to-player trade: proposer gives `give` and receives `receive`.
export function canPlayerTrade(state, fromIndex, toIndex, give, receive) {
  const from = state.players[fromIndex];
  const to = state.players[toIndex];
  return hasResources(from, give) && hasResources(to, receive);
}

export function executePlayerTrade(state, fromIndex, toIndex, give, receive) {
  if (!canPlayerTrade(state, fromIndex, toIndex, give, receive)) return false;
  const from = state.players[fromIndex];
  const to = state.players[toIndex];
  for (const r of Object.keys(give)) {
    from.resources[r] -= give[r];
    to.resources[r] += give[r];
  }
  for (const r of Object.keys(receive)) {
    to.resources[r] -= receive[r];
    from.resources[r] += receive[r];
  }
  return true;
}

export function bundleTotal(bundle) {
  return Object.values(bundle).reduce((s, n) => s + n, 0);
}
