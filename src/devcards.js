// Development cards: buying, playability and card effects.

import { BUILD_COSTS, DEV_CARD_TYPES } from "./gamestate.js";
import { canAfford, payToBank, takeFromBank } from "./rules.js";
import { RESOURCES } from "./board.js";

export function canBuyDevCard(state, playerIndex) {
  const p = state.players[playerIndex];
  return state.devDeck.length > 0 && canAfford(p, BUILD_COSTS.devCard);
}

export function buyDevCard(state, playerIndex) {
  if (!canBuyDevCard(state, playerIndex)) return null;
  const p = state.players[playerIndex];
  payToBank(state, p, BUILD_COSTS.devCard);
  const card = state.devDeck.pop();
  p.newDevCards[card]++;
  return card;
}

// A card is playable if held (not bought this turn), no dev card played yet
// this turn, and it isn't a victory point card.
export function canPlayDevCard(state, playerIndex, type) {
  if (type === "victoryPoint") return false;
  if (state.devCardPlayedThisTurn) return false;
  const p = state.players[playerIndex];
  return p.devCards[type] > 0;
}

export function playKnight(state, playerIndex) {
  const p = state.players[playerIndex];
  p.devCards.knight--;
  p.playedKnights++;
  state.devCardPlayedThisTurn = true;
}

export function playRoadBuilding(state, playerIndex) {
  const p = state.players[playerIndex];
  p.devCards.roadBuilding--;
  state.devCardPlayedThisTurn = true;
  state.freeRoads = Math.min(2, p.roadsLeft);
}

export function playYearOfPlenty(state, playerIndex, res1, res2) {
  const p = state.players[playerIndex];
  p.devCards.yearOfPlenty--;
  state.devCardPlayedThisTurn = true;
  const gains = {};
  gains[res1] = (gains[res1] || 0) + 1;
  gains[res2] = (gains[res2] || 0) + 1;
  takeFromBank(state, p, gains);
}

export function playMonopoly(state, playerIndex, resource) {
  const p = state.players[playerIndex];
  p.devCards.monopoly--;
  state.devCardPlayedThisTurn = true;
  let taken = 0;
  for (const other of state.players) {
    if (other.id === playerIndex) continue;
    taken += other.resources[resource];
    other.resources[resource] = 0;
  }
  p.resources[resource] += taken;
  return taken;
}

// Move cards bought this turn into the playable pile (called at end of turn).
export function maturateDevCards(state, playerIndex) {
  const p = state.players[playerIndex];
  for (const type of DEV_CARD_TYPES) {
    p.devCards[type] += p.newDevCards[type];
    p.newDevCards[type] = 0;
  }
}
