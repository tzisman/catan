// Game state: players, resources, buildings, robber, scoring and the dev deck.

import { createBoard, RESOURCES } from "./board.js";

export const PLAYER_COLORS = ["#d64545", "#2f6fb0", "#e08a1e", "#e8e6df"];
export const PLAYER_TEXT_ON = ["#fff", "#fff", "#fff", "#333"];

export const BUILD_COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 },
};

export const DEV_CARD_TYPES = [
  "knight",
  "victoryPoint",
  "roadBuilding",
  "yearOfPlenty",
  "monopoly",
];

function buildDevDeck() {
  const deck = [];
  for (let i = 0; i < 14; i++) deck.push("knight");
  for (let i = 0; i < 5; i++) deck.push("victoryPoint");
  for (let i = 0; i < 2; i++) deck.push("roadBuilding");
  for (let i = 0; i < 2; i++) deck.push("yearOfPlenty");
  for (let i = 0; i < 2; i++) deck.push("monopoly");
  // shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function emptyResources() {
  return { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 };
}

function emptyDevCards() {
  return {
    knight: 0,
    victoryPoint: 0,
    roadBuilding: 0,
    yearOfPlenty: 0,
    monopoly: 0,
  };
}

// playerConfigs: [{ name, isAI }]
export function createGameState(playerConfigs, boardOptions) {
  const board = createBoard(boardOptions);

  const players = playerConfigs.map((cfg, i) => ({
    id: i,
    name: cfg.name,
    color: PLAYER_COLORS[i],
    textColor: PLAYER_TEXT_ON[i],
    isAI: !!cfg.isAI,
    resources: emptyResources(),
    devCards: emptyDevCards(), // playable dev cards
    newDevCards: emptyDevCards(), // bought this turn (not yet playable)
    playedKnights: 0,
    settlementsLeft: 5,
    citiesLeft: 4,
    roadsLeft: 15,
    hasLongestRoad: false,
    hasLargestArmy: false,
    longestRoadLength: 0,
  }));

  return {
    board,
    players,
    buildings: {}, // vertexId -> { playerIndex, type: 'settlement'|'city' }
    roads: {}, // edgeId -> playerIndex
    devDeck: buildDevDeck(),
    bank: (() => {
      const b = {};
      for (const r of RESOURCES) b[r] = 19;
      return b;
    })(),
    currentPlayerIndex: 0,
    phase: "setup1", // setup1 -> setup2 -> play
    turnPhase: "build", // build | roll | action | discard | moveRobber | steal
    dice: null,
    hasRolled: false,
    devCardPlayedThisTurn: false,
    robberHexId: board.robberHexId,
    longestRoadOwner: null,
    largestArmyOwner: null,
    setupIndex: 0, // progress index used in setup snake order
    lastSetupVertex: null, // vertex placed in current setup step (to attach road)
    pendingDiscards: [], // player indices that must discard
    freeRoads: 0, // free roads to place (road building card / setup)
    playOrder: [],
    turnDrawRolls: [],
    pendingTradeOffer: null,
    tradeRejectKeys: [],
    tradesThisTurn: 0,
    maxTradesPerTurn: 2,
    humanTradeOffersThisTurn: 0,
    maxHumanTradeOffers: 1,
    skipPlayerTradeThisTurn: false,
    winner: null,
    log: [],
  };
}

export function currentPlayer(state) {
  return state.players[state.currentPlayerIndex];
}

// Snake order for setup using a shuffled play order.
export function setupTurnOrder(playOrder) {
  const order = playOrder.slice();
  for (let i = playOrder.length - 1; i >= 0; i--) order.push(playOrder[i]);
  return order;
}

/** Roll d6 per player; highest first, reroll ties until resolved. */
export function drawTurnOrder(numPlayers) {
  const entries = Array.from({ length: numPlayers }, (_, i) => ({
    playerIndex: i,
    roll: 1 + Math.floor(Math.random() * 6),
  }));

  for (let attempt = 0; attempt < 50; attempt++) {
    entries.sort((a, b) => b.roll - a.roll);
    const groups = new Map();
    for (const e of entries) {
      if (!groups.has(e.roll)) groups.set(e.roll, []);
      groups.get(e.roll).push(e);
    }
    let tied = false;
    for (const group of groups.values()) {
      if (group.length > 1) {
        tied = true;
        for (const e of group) e.roll = 1 + Math.floor(Math.random() * 6);
      }
    }
    if (!tied) break;
  }

  entries.sort((a, b) => b.roll - a.roll);
  return {
    order: entries.map((e) => e.playerIndex),
    rolls: entries.map((e) => ({ playerIndex: e.playerIndex, roll: e.roll })),
  };
}

/** Next player in cyclic play order. */
export function nextInPlayOrder(state) {
  const { playOrder, currentPlayerIndex } = state;
  const idx = playOrder.indexOf(currentPlayerIndex);
  return playOrder[(idx + 1) % playOrder.length];
}

export function totalResourceCards(player) {
  return RESOURCES.reduce((sum, r) => sum + player.resources[r], 0);
}

export function totalDevCards(player) {
  return DEV_CARD_TYPES.reduce(
    (sum, t) => sum + player.devCards[t] + player.newDevCards[t],
    0
  );
}
