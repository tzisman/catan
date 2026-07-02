// Central game controller: turn state machine, action methods, and the
// driver that runs AI players. UI and AI both call the same action methods.

import {
  createGameState,
  setupTurnOrder,
  drawTurnOrder,
  nextInPlayOrder,
  totalResourceCards,
  BUILD_COSTS,
} from "./gamestate.js";
import {
  canAfford,
  payToBank,
  canPlaceSettlement,
  canPlaceRoad,
  placeSettlement,
  placeCity,
  placeRoad,
  giveSetupResources,
  produceResources,
  moveRobber,
  playersToStealFrom,
  stealResource,
  discardCount,
  recalcLongestRoad,
  recalcLargestArmy,
  checkWinner,
  getValidCityVertices,
  getValidRoadEdges,
} from "./rules.js";
import {
  canBuyDevCard,
  buyDevCard,
  canPlayDevCard,
  playKnight,
  playRoadBuilding,
  playYearOfPlenty,
  playMonopoly,
  maturateDevCards,
} from "./devcards.js";
import {
  canBankTrade,
  executeBankTrade,
  executePlayerTrade,
  canPlayerTrade,
} from "./trade.js";
import * as AI from "./ai.js";

export class Game {
  constructor(playerConfigs, boardOptions, onUpdate) {
    this.state = createGameState(playerConfigs, boardOptions);
    this.onUpdate = onUpdate || (() => {});
    this.aiDelay = 650;
    this._aiTimer = null;
    this._aiSafety = 0;

    const N = this.state.players.length;
    const draw = drawTurnOrder(N);
    this.state.playOrder = draw.order;
    this.state.turnDrawRolls = draw.rolls;
    this.state.setupOrder = setupTurnOrder(draw.order);
    this.state.setupPos = 0;
    this.state.phase = "setup1";
    this.state.setupStep = "settlement";
    this.state.currentPlayerIndex = this.state.setupOrder[0];
    for (const { playerIndex, roll } of draw.rolls) {
      this.log(
        "logTurnDraw",
        { name: this.state.players[playerIndex].name, roll },
        playerIndex
      );
    }
    this.log("logTurnOrder", {
      order: draw.order.map((i) => this.state.players[i].name).join(" → "),
    });
    this.log("logSetupPlace", { name: this.cur().name });
  }

  cur() {
    return this.state.players[this.state.currentPlayerIndex];
  }

  log(key, params = {}, playerIndex = this.state.currentPlayerIndex) {
    this.state.log.push({ key, params, playerIndex });
    if (this.state.log.length > 200) this.state.log.shift();
  }

  notify() {
    this.onUpdate(this);
    this.scheduleAI();
  }

  // ---------------- Setup ----------------

  placeSetupSettlement(vertexId) {
    const s = this.state;
    if (s.phase !== "setup1" && s.phase !== "setup2") return false;
    if (s.setupStep !== "settlement") return false;
    const pi = s.currentPlayerIndex;
    if (!canPlaceSettlement(s, pi, vertexId, true)) return false;
    placeSettlement(s, pi, vertexId);
    s.lastSetupVertex = vertexId;
    this.log("logBuiltSettlement", { name: this.cur().name });
    if (s.phase === "setup2") {
      giveSetupResources(s, pi, vertexId);
    }
    s.setupStep = "road";
    this.notify();
    return true;
  }

  placeSetupRoad(edgeId) {
    const s = this.state;
    if (s.setupStep !== "road") return false;
    const pi = s.currentPlayerIndex;
    if (!canPlaceRoad(s, pi, edgeId, true, s.lastSetupVertex)) return false;
    placeRoad(s, pi, edgeId);
    recalcLongestRoad(s);
    this.advanceSetup();
    this.notify();
    return true;
  }

  advanceSetup() {
    const s = this.state;
    const N = s.players.length;
    s.setupPos++;
    if (s.setupPos >= 2 * N) {
      this.startPlay();
      return;
    }
    s.phase = s.setupPos < N ? "setup1" : "setup2";
    s.currentPlayerIndex = s.setupOrder[s.setupPos];
    s.setupStep = "settlement";
    this.log("logSetupPlace", { name: this.cur().name });
  }

  startPlay() {
    const s = this.state;
    s.phase = "play";
    s.currentPlayerIndex = s.playOrder[0];
    s.turnPhase = "roll";
    s.hasRolled = false;
    s.devCardPlayedThisTurn = false;
    s.freeRoads = 0;
    this.log("playerTurn", { name: this.cur().name });
  }

  // ---------------- Play: rolling ----------------

  rollDice() {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "roll") return false;
    const d1 = 1 + Math.floor(Math.random() * 6);
    const d2 = 1 + Math.floor(Math.random() * 6);
    s.dice = { d1, d2, sum: d1 + d2 };
    s.hasRolled = true;
    this.log("logRolled", { name: this.cur().name, roll: d1 + d2 });
    if (d1 + d2 === 7) {
      this.beginRobber("action", true);
    } else {
      produceResources(s, d1 + d2);
      s.turnPhase = "action";
    }
    this.notify();
    return true;
  }

  beginRobber(returnPhase, withDiscards = false) {
    const s = this.state;
    s.robberReturnPhase = returnPhase;
    s.pendingTradeOffer = null;
    s.pendingDiscards = [];
    if (withDiscards) {
      for (const p of s.players) {
        const n = discardCount(p);
        if (n > 0) s.pendingDiscards.push({ playerIndex: p.id, count: n });
      }
    }
    if (s.pendingDiscards.length > 0) s.turnPhase = "discard";
    else s.turnPhase = "moveRobber";
  }

  discard(playerIndex, bundle) {
    const s = this.state;
    if (s.turnPhase !== "discard") return false;
    const entry = s.pendingDiscards.find((d) => d.playerIndex === playerIndex);
    if (!entry) return false;
    const total = Object.values(bundle).reduce((a, b) => a + b, 0);
    if (total !== entry.count) return false;
    const p = s.players[playerIndex];
    for (const r of Object.keys(bundle)) {
      if (p.resources[r] < bundle[r]) return false;
    }
    for (const r of Object.keys(bundle)) {
      p.resources[r] -= bundle[r];
      s.bank[r] += bundle[r];
    }
    this.log("logDiscarded", { name: p.name, n: entry.count }, playerIndex);
    s.pendingDiscards = s.pendingDiscards.filter(
      (d) => d.playerIndex !== playerIndex
    );
    if (s.pendingDiscards.length === 0) s.turnPhase = "moveRobber";
    this.notify();
    return true;
  }

  moveRobberTo(hexId) {
    const s = this.state;
    if (s.turnPhase !== "moveRobber") return false;
    if (hexId === s.robberHexId) return false;
    moveRobber(s, hexId);
    this.log("logMovedRobber", { name: this.cur().name });
    const candidates = playersToStealFrom(s, hexId, s.currentPlayerIndex);
    if (candidates.length === 0) {
      this.finishRobber();
    } else if (candidates.length === 1) {
      this.doSteal(candidates[0]);
    } else {
      s.turnPhase = "steal";
      s.stealCandidates = candidates;
    }
    this.notify();
    return true;
  }

  stealFrom(playerIndex) {
    const s = this.state;
    if (s.turnPhase !== "steal") return false;
    if (!s.stealCandidates || !s.stealCandidates.includes(playerIndex))
      return false;
    this.doSteal(playerIndex);
    this.notify();
    return true;
  }

  doSteal(victimIndex) {
    const s = this.state;
    stealResource(s, victimIndex, s.currentPlayerIndex);
    this.log("logStole", {
      name: this.cur().name,
      from: s.players[victimIndex].name,
    });
    s.stealCandidates = [];
    this.finishRobber();
  }

  finishRobber() {
    const s = this.state;
    s.turnPhase = s.robberReturnPhase || "action";
  }

  // ---------------- Play: building ----------------

  buildRoad(edgeId) {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "action") return false;
    const pi = s.currentPlayerIndex;
    const p = this.cur();
    if (p.roadsLeft <= 0) return false;
    if (!canPlaceRoad(s, pi, edgeId, false)) return false;
    const free = s.freeRoads > 0;
    if (!free && !canAfford(p, BUILD_COSTS.road)) return false;
    if (free) s.freeRoads--;
    else payToBank(s, p, BUILD_COSTS.road);
    placeRoad(s, pi, edgeId);
    this.log("logBuiltRoad", { name: p.name });
    if (recalcLongestRoad(s) && s.longestRoadOwner === pi) {
      this.log("logGotLongestRoad", { name: p.name });
    }
    this.checkWin();
    this.notify();
    return true;
  }

  buildSettlement(vertexId) {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "action") return false;
    const pi = s.currentPlayerIndex;
    const p = this.cur();
    if (p.settlementsLeft <= 0) return false;
    if (!canPlaceSettlement(s, pi, vertexId, false)) return false;
    if (!canAfford(p, BUILD_COSTS.settlement)) return false;
    payToBank(s, p, BUILD_COSTS.settlement);
    placeSettlement(s, pi, vertexId);
    this.log("logBuiltSettlement", { name: p.name });
    // A new settlement can break an opponent's road.
    recalcLongestRoad(s);
    this.checkWin();
    this.notify();
    return true;
  }

  buildCity(vertexId) {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "action") return false;
    const pi = s.currentPlayerIndex;
    const p = this.cur();
    if (p.citiesLeft <= 0) return false;
    const b = s.buildings[vertexId];
    if (!b || b.playerIndex !== pi || b.type !== "settlement") return false;
    if (!canAfford(p, BUILD_COSTS.city)) return false;
    payToBank(s, p, BUILD_COSTS.city);
    placeCity(s, pi, vertexId);
    this.log("logBuiltCity", { name: p.name });
    this.checkWin();
    this.notify();
    return true;
  }

  buyDevCard() {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "action") return false;
    if (!canBuyDevCard(s, s.currentPlayerIndex)) return false;
    buyDevCard(s, s.currentPlayerIndex);
    this.log("logBoughtDev", { name: this.cur().name });
    this.checkWin();
    this.notify();
    return true;
  }

  // ---------------- Play: dev cards ----------------

  playKnightCard() {
    const s = this.state;
    if (s.phase !== "play") return false;
    if (s.turnPhase !== "action" && s.turnPhase !== "roll") return false;
    if (!canPlayDevCard(s, s.currentPlayerIndex, "knight")) return false;
    playKnight(s, s.currentPlayerIndex);
    this.log("logPlayedKnight", { name: this.cur().name });
    if (recalcLargestArmy(s) && s.largestArmyOwner === s.currentPlayerIndex) {
      this.log("logGotLargestArmy", { name: this.cur().name });
    }
    this.checkWin();
    if (s.phase === "gameover") {
      this.notify();
      return true;
    }
    this.beginRobber(s.turnPhase, false);
    this.notify();
    return true;
  }

  playRoadBuildingCard() {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "action") return false;
    if (!canPlayDevCard(s, s.currentPlayerIndex, "roadBuilding")) return false;
    playRoadBuilding(s, s.currentPlayerIndex);
    this.log("logPlayedRoadBuilding", { name: this.cur().name });
    this.notify();
    return true;
  }

  playYearOfPlentyCard(res1, res2) {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "action") return false;
    if (!canPlayDevCard(s, s.currentPlayerIndex, "yearOfPlenty")) return false;
    playYearOfPlenty(s, s.currentPlayerIndex, res1, res2);
    this.log("logPlayedYearOfPlenty", { name: this.cur().name });
    this.notify();
    return true;
  }

  playMonopolyCard(res) {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "action") return false;
    if (!canPlayDevCard(s, s.currentPlayerIndex, "monopoly")) return false;
    const n = playMonopoly(s, s.currentPlayerIndex, res);
    this.log("logPlayedMonopoly", { name: this.cur().name, res });
    this.log("logMonopolyGain", { name: this.cur().name, n, res });
    this.notify();
    return true;
  }

  // ---------------- Play: trading ----------------

  bankTrade(give, receive) {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "action") return false;
    if (s.tradesThisTurn >= s.maxTradesPerTurn) return false;
    if (!canBankTrade(s, s.currentPlayerIndex, give, receive)) return false;
    executeBankTrade(s, s.currentPlayerIndex, give, receive);
    s.tradesThisTurn++;
    this.log("logTradeBank", { name: this.cur().name });
    this.notify();
    return true;
  }

  // Human proposes a trade to opponents; AI opponents auto-evaluate.
  // give/receive are bundles from the proposer's perspective.
  proposePlayerTrade(give, receive) {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "action") return { accepted: false };
    if (s.tradesThisTurn >= s.maxTradesPerTurn) return { accepted: false };
    const proposer = s.currentPlayerIndex;
    for (let i = 0; i < s.players.length; i++) {
      if (i === proposer) continue;
      const target = s.players[i];
      if (!target.isAI) continue; // human targets respond via incoming-offer flow
      if (AI.aiEvaluateTrade(s, i, give, receive)) {
        if (executePlayerTrade(s, proposer, i, give, receive)) {
          s.tradesThisTurn++;
          this.log("logTradePlayer", {
            name: this.cur().name,
            other: target.name,
          });
          this.notify();
          return { accepted: true, playerIndex: i };
        }
      }
    }
    return { accepted: false };
  }

  /** AI (or any player) offers a trade; human target must confirm. */
  offerPlayerTrade(fromIndex, toIndex, give, receive) {
    const s = this.state;
    if (s.tradesThisTurn >= s.maxTradesPerTurn) return false;
    if (!canPlayerTrade(s, fromIndex, toIndex, give, receive)) return false;
    const target = s.players[toIndex];
    if (!target.isAI) {
      if (s.humanTradeOffersThisTurn >= s.maxHumanTradeOffers) return false;
      if (s.skipPlayerTradeThisTurn) return false;
      s.humanTradeOffersThisTurn++;
      s.pendingTradeOffer = { from: fromIndex, to: toIndex, give, receive };
      this.notify();
      return true;
    }
    if (executePlayerTrade(s, fromIndex, toIndex, give, receive)) {
      s.tradesThisTurn++;
      this.log("logTradePlayer", {
        name: s.players[fromIndex].name,
        other: target.name,
      });
      this.notify();
      return true;
    }
    return false;
  }

  acceptPendingTrade() {
    const s = this.state;
    const offer = s.pendingTradeOffer;
    if (!offer) return false;
    if (!executePlayerTrade(s, offer.from, offer.to, offer.give, offer.receive)) {
      s.pendingTradeOffer = null;
      this.notify();
      return false;
    }
    s.pendingTradeOffer = null;
    s.tradesThisTurn++;
    this.log("logTradePlayer", {
      name: s.players[offer.from].name,
      other: s.players[offer.to].name,
    });
    this.notify();
    return true;
  }

  rejectPendingTrade() {
    const s = this.state;
    const offer = s.pendingTradeOffer;
    if (!offer) return false;
    s.tradeRejectKeys.push(
      `${offer.from}|${offer.to}|${JSON.stringify(offer.give)}|${JSON.stringify(offer.receive)}`
    );
    s.skipPlayerTradeThisTurn = true;
    this.log("logTradeRejected", {
      name: s.players[offer.to].name,
      other: s.players[offer.from].name,
    });
    s.pendingTradeOffer = null;
    this.notify();
    return true;
  }

  // ---------------- End turn ----------------

  endTurn() {
    const s = this.state;
    if (s.phase !== "play" || s.turnPhase !== "action") return false;
    maturateDevCards(s, s.currentPlayerIndex);
    s.freeRoads = 0;
    s.devCardPlayedThisTurn = false;
    s.currentPlayerIndex = nextInPlayOrder(s);
    s.turnPhase = "roll";
    s.hasRolled = false;
    s.dice = null;
    s.tradeRejectKeys = [];
    s.tradesThisTurn = 0;
    s.humanTradeOffersThisTurn = 0;
    s.skipPlayerTradeThisTurn = false;
    this._aiSafety = 0;
    this.log("playerTurn", { name: this.cur().name });
    this.notify();
    return true;
  }

  checkWin() {
    const s = this.state;
    const w = checkWinner(s);
    if (w != null) {
      s.phase = "gameover";
      s.winner = w;
      this.log("logWon", { name: s.players[w].name }, w);
    }
  }

  // ---------------- AI driver ----------------

  scheduleAI() {
    if (this._aiTimer) return;
    const action = this.nextAIAction();
    if (!action) return;
    this._aiTimer = setTimeout(() => {
      this._aiTimer = null;
      this.runAIAction();
    }, this.aiDelay);
  }

  // Determine if some AI action is pending; returns a descriptor or null.
  nextAIAction() {
    const s = this.state;
    if (s.phase === "gameover") return null;

    // Wait for human to respond to an incoming trade offer.
    if (s.pendingTradeOffer) return null;

    // Discards can involve any AI regardless of whose turn it is.
    if (s.turnPhase === "discard") {
      const entry = s.pendingDiscards.find(
        (d) => s.players[d.playerIndex].isAI
      );
      if (entry) return { kind: "discard", entry };
      return null; // waiting on a human discard
    }

    const actor = this.cur();
    if (!actor.isAI) return null;

    if (s.phase === "setup1" || s.phase === "setup2") {
      return { kind: s.setupStep === "settlement" ? "setupSettlement" : "setupRoad" };
    }
    if (s.phase === "play") {
      if (s.turnPhase === "roll") return { kind: "roll" };
      if (s.turnPhase === "moveRobber") return { kind: "moveRobber" };
      if (s.turnPhase === "steal") return { kind: "steal" };
      if (s.turnPhase === "action") return { kind: "action" };
    }
    return null;
  }

  runAIAction() {
    const s = this.state;
    const action = this.nextAIAction();
    if (!action) return;
    this._aiSafety++;
    if (this._aiSafety > 200) {
      // Safety valve: force end of turn.
      if (s.turnPhase === "action") this.endTurn();
      return;
    }
    const pi = s.currentPlayerIndex;

    switch (action.kind) {
      case "discard": {
        const { entry } = action;
        const bundle = AI.aiChooseDiscard(s, entry.playerIndex, entry.count);
        this.discard(entry.playerIndex, bundle);
        break;
      }
      case "setupSettlement": {
        const vId = AI.aiChooseSetupSettlement(s, pi);
        this.placeSetupSettlement(vId);
        break;
      }
      case "setupRoad": {
        const eId = AI.aiChooseSetupRoad(s, pi, s.lastSetupVertex);
        this.placeSetupRoad(eId);
        break;
      }
      case "roll":
        this.rollDice();
        break;
      case "moveRobber": {
        const hexId = AI.aiChooseRobberHex(s, pi);
        this.moveRobberTo(hexId);
        break;
      }
      case "steal": {
        const victim = AI.aiChooseSteal(s, pi, s.stealCandidates);
        this.stealFrom(victim);
        break;
      }
      case "action":
        this.runAIActionPhase();
        break;
    }
  }

  runAIActionPhase() {
    const s = this.state;
    const pi = s.currentPlayerIndex;
    const p = this.cur();

    if (!s.devCardPlayedThisTurn) {
      if (canPlayDevCard(s, pi, "monopoly")) {
        const res = AI.aiChooseMonopoly(s, pi);
        if (AI.aiShouldPlayMonopoly(s, pi, res)) return this.playMonopolyCard(res);
      }
      if (canPlayDevCard(s, pi, "yearOfPlenty") && AI.aiShouldPlayYearOfPlenty(s, pi)) {
        const [r1, r2] = AI.aiChooseYearOfPlenty(s, pi);
        return this.playYearOfPlentyCard(r1, r2);
      }
      if (
        canPlayDevCard(s, pi, "roadBuilding") &&
        p.roadsLeft > 0 &&
        AI.aiShouldPlayRoadBuilding(s, pi)
      ) {
        return this.playRoadBuildingCard();
      }
      if (canPlayDevCard(s, pi, "knight") && AI.aiShouldPlayKnight(s, pi)) {
        return this.playKnightCard();
      }
    }

    const step = AI.aiActionStep(s, pi);
    switch (step.type) {
      case "buildCity":
        return this.buildCity(step.vertexId);
      case "buildSettlement":
        return this.buildSettlement(step.vertexId);
      case "buildRoad":
        return this.buildRoad(step.edgeId);
      case "buyDev":
        return this.buyDevCard();
      case "bankTrade":
        if (this.bankTrade(step.give, step.receive)) return true;
        return this.endTurn();
      case "playerTrade":
        if (this.offerPlayerTrade(pi, step.targetIdx, step.give, step.receive)) {
          if (s.pendingTradeOffer) return true;
          return true;
        }
        s.skipPlayerTradeThisTurn = true;
        return this.endTurn();
      case "end":
      default:
        return this.endTurn();
    }
  }
}
