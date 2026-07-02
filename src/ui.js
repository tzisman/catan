// UI layer: renders the board and sidebar, wires user events, drives modals
// (trade, discard, dev cards, robber, steal) and connects to the Game engine.

import { Game } from "./game.js";
import { t, setLang, getLang } from "./i18n.js";
import { renderGame, RESOURCE_ICON } from "./render.js";
import { RESOURCES } from "./board.js";
import {
  renderResourceHand,
  renderDevHand,
  renderCardStack,
  renderDice,
  createResourceCard,
} from "./cards.js";
import {
  BUILD_COSTS,
  DEV_CARD_TYPES,
  totalResourceCards,
  totalDevCards,
} from "./gamestate.js";
import {
  getValidSettlementVertices,
  getValidRoadEdges,
  getValidCityVertices,
  canAfford,
  publicVictoryPoints,
  totalVictoryPoints,
  countBuildings,
} from "./rules.js";
import { bankTradeRatio, canBankTrade } from "./trade.js";
import { canPlayDevCard, canBuyDevCard } from "./devcards.js";

let game = null;
let ui = { mode: null }; // build modes: buildRoad/buildSettlement/buildCity

const $ = (id) => document.getElementById(id);

export function initGame(playerConfigs, boardOptions) {
  ui = { mode: null };
  game = new Game(playerConfigs, boardOptions, () => update());
  const setup = $("setup-screen");
  const gameScreen = $("game-screen");
  setup.classList.add("is-hidden");
  setup.style.display = "none";
  gameScreen.classList.remove("is-hidden");
  gameScreen.style.display = "flex";
  update();
  // Kick off the AI driver in case the first player is a computer.
  game.scheduleAI();
}

function isHumanTurn() {
  return !game.cur().isAI;
}

// ---------------- Highlights ----------------

function computeHighlights() {
  const s = game.state;
  const empty = { vertices: new Set(), edges: new Set(), hexes: new Set() };
  const pi = s.currentPlayerIndex;

  if (s.phase === "setup1" || s.phase === "setup2") {
    if (game.cur().isAI) return empty;
    if (s.setupStep === "settlement") {
      return { ...empty, vertices: new Set(getValidSettlementVertices(s, pi, true)) };
    }
    return {
      ...empty,
      edges: new Set(getValidRoadEdges(s, pi, true, s.lastSetupVertex)),
    };
  }

  if (s.phase === "play") {
    if (s.turnPhase === "moveRobber" && !game.cur().isAI) {
      const hexes = new Set();
      for (const hex of s.board.hexes) if (!hex.hasRobber) hexes.add(hex.id);
      return { ...empty, hexes };
    }
    if (s.turnPhase === "action" && !game.cur().isAI && ui.mode) {
      if (ui.mode === "buildRoad")
        return { ...empty, edges: new Set(getValidRoadEdges(s, pi, false)) };
      if (ui.mode === "buildSettlement")
        return { ...empty, vertices: new Set(getValidSettlementVertices(s, pi, false)) };
      if (ui.mode === "buildCity")
        return { ...empty, vertices: new Set(getValidCityVertices(s, pi)) };
    }
  }
  return empty;
}

const handlers = {
  onVertex(vId) {
    const s = game.state;
    if (s.phase === "setup1" || s.phase === "setup2") {
      game.placeSetupSettlement(vId);
    } else if (ui.mode === "buildSettlement") {
      if (game.buildSettlement(vId)) ui.mode = null;
    } else if (ui.mode === "buildCity") {
      if (game.buildCity(vId)) ui.mode = null;
    }
    update();
  },
  onEdge(eId) {
    const s = game.state;
    if (s.phase === "setup1" || s.phase === "setup2") {
      game.placeSetupRoad(eId);
    } else if (ui.mode === "buildRoad") {
      const built = game.buildRoad(eId);
      if (built && s.freeRoads <= 0) ui.mode = null;
    }
    update();
  },
  onHex(hexId) {
    game.moveRobberTo(hexId);
    update();
  },
};

// ---------------- Main update ----------------

export function update() {
  if (!game) return;
  const highlights = computeHighlights();
  renderGame($("board"), game.state, { highlights, handlers });
  renderTurnIndicator();
  renderDiceDisplay();
  renderSidebar();
  renderPlayerHand();
  renderControls();
  renderPromptBanner();
  autoModals();
  translateStaticGame();
}

function translateStaticGame() {
  $("new-game-btn").textContent = t("newGame");
}

function renderTurnIndicator() {
  const s = game.state;
  const el = $("turn-indicator");
  if (s.phase === "gameover") {
    el.textContent = t("winnerAnnounce", { name: s.players[s.winner].name });
    el.style.color = s.players[s.winner].color;
    return;
  }
  const p = game.cur();
  el.textContent = t("playerTurn", { name: p.name });
  el.style.color = p.color;
}

// ---------------- Sidebar ----------------

function resIcon(r) {
  return RESOURCE_ICON[r] || "";
}

function renderDiceDisplay() {
  const el = $("dice-display");
  if (!el) return;
  renderDice(el, game.state.dice);
}

function renderPlayerHand() {
  const wrap = $("player-hand");
  if (!wrap) return;
  wrap.innerHTML = "";
  const s = game.state;
  if (s.phase === "gameover" || s.phase === "setup1" || s.phase === "setup2") {
    wrap.classList.add("is-hidden");
    wrap.style.display = "none";
    return;
  }
  // Find the human player
  const humanIdx = s.players.findIndex((p) => !p.isAI);
  if (humanIdx < 0) {
    wrap.classList.add("is-hidden");
    wrap.style.display = "none";
    return;
  }
  wrap.classList.remove("is-hidden");
  wrap.style.display = "block";
  const p = s.players[humanIdx];

  const title = document.createElement("div");
  title.className = "hand-title";
  title.textContent = t("resources") + " & " + t("developmentCards");
  wrap.appendChild(title);

  const zones = document.createElement("div");
  zones.className = "hand-zones";

  const resZone = document.createElement("div");
  resZone.className = "hand-zone";
  const resLabel = document.createElement("div");
  resLabel.className = "hand-zone-label";
  resLabel.textContent = t("resources");
  resZone.appendChild(resLabel);
  const resContainer = document.createElement("div");
  renderResourceHand(resContainer, p.resources);
  resZone.appendChild(resContainer);
  zones.appendChild(resZone);

  const devZone = document.createElement("div");
  devZone.className = "hand-zone";
  const devLabel = document.createElement("div");
  devLabel.className = "hand-zone-label";
  devLabel.textContent = t("developmentCards");
  devZone.appendChild(devLabel);
  const devContainer = document.createElement("div");
  renderDevHand(devContainer, p.devCards, p.newDevCards);
  devZone.appendChild(devContainer);
  zones.appendChild(devZone);

  wrap.appendChild(zones);
}

function renderSidebar() {
  renderPlayers();
  renderBank();
  renderLog();
}

function renderPlayers() {
  const s = game.state;
  const wrap = $("players-panel");
  wrap.innerHTML = "";
  s.players.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "player-card" + (i === s.currentPlayerIndex ? " active" : "");
    card.style.borderColor = p.color;

    const header = document.createElement("div");
    header.className = "player-header";
    const dot = document.createElement("span");
    dot.className = "player-dot";
    dot.style.background = p.color;
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = p.name + (p.isAI ? " 🤖" : "");
    const vp = document.createElement("span");
    vp.className = "player-vp";
    const isCurrentHuman = i === s.currentPlayerIndex && !p.isAI;
    const shownVP = isCurrentHuman
      ? totalVictoryPoints(s, i)
      : publicVictoryPoints(s, i);
    vp.textContent = `⭐ ${shownVP}`;
    header.append(dot, name, vp);
    card.appendChild(header);

    // badges
    const badges = document.createElement("div");
    badges.className = "player-badges";
    if (p.hasLongestRoad) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "🛣️ " + t("longestRoad") + " (" + p.longestRoadLength + ")";
      badges.appendChild(b);
    }
    if (p.hasLargestArmy) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "⚔️ " + t("largestArmy");
      badges.appendChild(b);
    }
    const kn = document.createElement("span");
    kn.className = "badge subtle";
    kn.textContent = "⚔️ " + p.playedKnights;
    badges.appendChild(kn);
    card.appendChild(badges);

    // Card stacks
    const cardsRow = document.createElement("div");
    cardsRow.className = "player-cards-row";

    const resStack = document.createElement("div");
    if (isCurrentHuman) {
      const miniFan = document.createElement("div");
      miniFan.className = "card-fan";
      for (const r of RESOURCES) {
        if (p.resources[r] > 0) {
          const c = createResourceCard(r, { mini: true });
          const cnt = document.createElement("span");
          cnt.className = "bank-count";
          cnt.textContent = "×" + p.resources[r];
          const grp = document.createElement("div");
          grp.className = "bank-resource";
          grp.style.position = "relative";
          grp.appendChild(c);
          grp.appendChild(cnt);
          miniFan.appendChild(grp);
        }
      }
      resStack.appendChild(miniFan);
    } else {
      renderCardStack(resStack, totalResourceCards(p), { kind: "resource" });
    }
    cardsRow.appendChild(resStack);

    const devStack = document.createElement("div");
    renderCardStack(devStack, totalDevCards(p), { kind: "dev" });
    cardsRow.appendChild(devStack);

    card.appendChild(cardsRow);

    wrap.appendChild(card);
  });
}

function renderBank() {
  const s = game.state;
  const wrap = $("bank-panel");
  wrap.innerHTML = `<h3>${t("bank")}</h3>`;
  const row = document.createElement("div");
  row.className = "bank-cards";
  for (const r of RESOURCES) {
    const grp = document.createElement("div");
    grp.className = "bank-resource";
    grp.appendChild(createResourceCard(r, { mini: true }));
    const cnt = document.createElement("span");
    cnt.className = "bank-count";
    cnt.textContent = String(s.bank[r]);
    grp.appendChild(cnt);
    row.appendChild(grp);
  }
  const devGrp = document.createElement("div");
  devGrp.className = "bank-resource";
  const devCard = document.createElement("div");
  devCard.className = "game-card mini face-down dev-back";
  devGrp.appendChild(devCard);
  const devCnt = document.createElement("span");
  devCnt.className = "bank-count";
  devCnt.textContent = String(s.devDeck.length);
  devGrp.appendChild(devCnt);
  row.appendChild(devGrp);
  wrap.appendChild(row);
}

function renderLog() {
  const s = game.state;
  const wrap = $("log-panel");
  wrap.innerHTML = `<h3>${t("log")}</h3>`;
  const list = document.createElement("div");
  list.className = "log-list";
  const recent = s.log.slice(-40).reverse();
  for (const entry of recent) {
    const line = document.createElement("div");
    line.className = "log-line";
    const params = { ...entry.params };
    if (params.res) params.res = t(params.res);
    line.textContent = t(entry.key, params);
    if (entry.playerIndex != null) {
      line.style.borderInlineStartColor = s.players[entry.playerIndex].color;
    }
    list.appendChild(line);
  }
  wrap.appendChild(list);
}

// ---------------- Controls ----------------

function btn(label, onClick, opts = {}) {
  const b = document.createElement("button");
  b.textContent = label;
  b.className = "ctrl-btn" + (opts.primary ? " primary" : "");
  if (opts.disabled) b.disabled = true;
  if (opts.active) b.classList.add("active");
  b.addEventListener("click", onClick);
  return b;
}

function renderControls() {
  const s = game.state;
  const wrap = $("controls");
  wrap.innerHTML = "";

  if (s.phase === "gameover") {
    wrap.appendChild(
      btn(t("playAgain"), () => location.reload(), { primary: true })
    );
    return;
  }

  if (!isHumanTurn()) {
    const span = document.createElement("span");
    span.className = "ctrl-hint";
    span.textContent = t("aiThinking", { name: game.cur().name });
    wrap.appendChild(span);
    return;
  }

  // Human turn.
  if (s.phase === "setup1" || s.phase === "setup2") return;

  if (s.turnPhase === "roll") {
    wrap.appendChild(btn(t("rollDice"), () => game.rollDice(), { primary: true }));
    if (canPlayDevCard(s, s.currentPlayerIndex, "knight")) {
      wrap.appendChild(btn(t("knight"), () => game.playKnightCard()));
    }
    return;
  }

  if (s.turnPhase === "moveRobber" || s.turnPhase === "steal" || s.turnPhase === "discard") {
    // Handled via banner/board/modal (discard modal even when not your turn).
    return;
  }

  if (s.turnPhase === "action") {
    const p = game.cur();
    const freeRoad = s.freeRoads > 0;
    wrap.appendChild(
      btn(
        t("buildRoad") + (freeRoad ? ` (${t("freeBuild")} ×${s.freeRoads})` : ""),
        () => toggleMode("buildRoad"),
        {
          active: ui.mode === "buildRoad",
          disabled: !freeRoad && !canAfford(p, BUILD_COSTS.road),
        }
      )
    );
    wrap.appendChild(
      btn(t("buildSettlement"), () => toggleMode("buildSettlement"), {
        active: ui.mode === "buildSettlement",
        disabled:
          !canAfford(p, BUILD_COSTS.settlement) ||
          p.settlementsLeft <= 0 ||
          getValidSettlementVertices(s, s.currentPlayerIndex, false).length === 0,
      })
    );
    wrap.appendChild(
      btn(t("buildCity"), () => toggleMode("buildCity"), {
        active: ui.mode === "buildCity",
        disabled:
          !canAfford(p, BUILD_COSTS.city) ||
          p.citiesLeft <= 0 ||
          getValidCityVertices(s, s.currentPlayerIndex).length === 0,
      })
    );
    wrap.appendChild(
      btn(t("buyDevCard"), () => game.buyDevCard(), {
        disabled: !canBuyDevCard(s, s.currentPlayerIndex),
      })
    );
    const hasPlayable = DEV_CARD_TYPES.some((type) =>
      canPlayDevCard(s, s.currentPlayerIndex, type)
    );
    wrap.appendChild(
      btn(t("playDevCard"), () => openDevCardModal(), { disabled: !hasPlayable })
    );
    wrap.appendChild(btn(t("trade"), () => openTradeModal()));
    wrap.appendChild(
      btn(t("endTurn"), () => {
        ui.mode = null;
        game.endTurn();
      }, { primary: true })
    );
  }
}

function toggleMode(mode) {
  ui.mode = ui.mode === mode ? null : mode;
  update();
}

// ---------------- Prompt banner ----------------

function renderPromptBanner() {
  const s = game.state;
  const el = $("prompt-banner");
  let text = "";
  if (s.phase === "setup1" || s.phase === "setup2") {
    if (isHumanTurn()) {
      text =
        s.setupStep === "settlement"
          ? t("placeInitialSettlement")
          : t("placeInitialRoad");
    }
  } else if (s.phase === "play") {
    const humanDiscard = humanPendingDiscard();
    if (humanDiscard) {
      text = t("mustDiscard", { n: humanDiscard.count });
    } else if (isHumanTurn()) {
      if (s.turnPhase === "moveRobber") text = t("selectHexForRobber");
      else if (ui.mode === "buildRoad") text = t("selectEdge");
      else if (ui.mode === "buildSettlement") text = t("selectVertex");
      else if (ui.mode === "buildCity") text = t("selectVertexCity");
    }
  }
  el.textContent = text;
  el.hidden = !text;
}

// ---------------- Auto modals ----------------

let modalOpen = false;

function humanPendingDiscard() {
  const s = game.state;
  if (s.turnPhase !== "discard") return null;
  return s.pendingDiscards.find((d) => !s.players[d.playerIndex].isAI) || null;
}

function autoModals() {
  const s = game.state;
  // Discard takes priority — also when a trade modal is open.
  const humanDiscard = humanPendingDiscard();
  if (humanDiscard) {
    if (modalOpen) closeModal();
    if (!modalOpen) {
      openDiscardModal(humanDiscard.playerIndex, humanDiscard.count);
    }
    return;
  }
  if (modalOpen) return;
  // Incoming trade offer from AI (can appear during AI's turn).
  if (s.pendingTradeOffer) {
    const offer = s.pendingTradeOffer;
    const target = s.players[offer.to];
    if (!target.isAI) {
      openIncomingTradeModal(offer);
      return;
    }
  }
  // Steal choice for a human current player.
  if (s.turnPhase === "steal" && isHumanTurn()) {
    openStealModal(s.stealCandidates);
  }
}

// ---------------- Modal framework ----------------

function openModal(title, contentBuilder, { closable = true } = {}) {
  modalOpen = true;
  const overlay = $("modal-overlay");
  overlay.classList.remove("is-hidden");
  overlay.style.display = "flex";
  const modal = $("modal");
  modal.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = title;
  modal.appendChild(h);
  const body = document.createElement("div");
  body.className = "modal-body";
  modal.appendChild(body);
  contentBuilder(body, () => closeModal());
  if (closable) {
    const footer = document.createElement("div");
    footer.className = "modal-footer";
    footer.appendChild(btn(t("close"), () => closeModal()));
    modal.appendChild(footer);
  }
}

function closeModal() {
  modalOpen = false;
  const overlay = $("modal-overlay");
  overlay.classList.add("is-hidden");
  overlay.style.display = "none";
  $("modal").innerHTML = "";
  update();
}

// ---------------- Discard modal ----------------

function openDiscardModal(playerIndex, count) {
  const s = game.state;
  const p = s.players[playerIndex];
  const selection = {};
  for (const r of RESOURCES) selection[r] = 0;

  openModal(
    t("discardCards"),
    (body) => {
      const info = document.createElement("p");
      info.textContent = t("mustDiscard", { n: count });
      body.appendChild(info);
      const status = document.createElement("p");
      status.className = "status";
      body.appendChild(status);

      const grid = document.createElement("div");
      grid.className = "res-picker";
      body.appendChild(grid);

      const confirm = btn(
        t("confirm"),
        () => {
          const bundle = {};
          for (const r of RESOURCES) if (selection[r] > 0) bundle[r] = selection[r];
          game.discard(playerIndex, bundle);
          closeModal();
        },
        { primary: true }
      );

      function refresh() {
        const total = RESOURCES.reduce((a, r) => a + selection[r], 0);
        status.textContent = t("selectedToDiscard", { n: total, total: count });
        confirm.disabled = total !== count;
      }

      for (const r of RESOURCES) {
        const row = makeStepper(
          `${resIcon(r)} ${t(r)}`,
          () => selection[r],
          (v) => {
            selection[r] = Math.max(0, Math.min(p.resources[r], v));
            refresh();
          },
          p.resources[r]
        );
        grid.appendChild(row);
      }
      refresh();

      const footer = document.createElement("div");
      footer.className = "modal-footer";
      footer.appendChild(confirm);
      body.appendChild(footer);
    },
    { closable: false }
  );
}

// ---------------- Steal modal ----------------

function openStealModal(candidates) {
  openModal(
    t("stealFrom"),
    (body) => {
      const row = document.createElement("div");
      row.className = "btn-column";
      for (const c of candidates) {
        const p = game.state.players[c];
        const b = btn(`${p.name} (🎴 ${totalResourceCards(p)})`, () => {
          game.stealFrom(c);
          closeModal();
        });
        b.style.borderColor = p.color;
        row.appendChild(b);
      }
      body.appendChild(row);
    },
    { closable: false }
  );
}

// ---------------- Dev card modal ----------------

function openDevCardModal() {
  const s = game.state;
  const pi = s.currentPlayerIndex;
  openModal(t("playDevCard"), (body) => {
    const col = document.createElement("div");
    col.className = "btn-column";
    const items = [
      { type: "knight", fn: () => { game.playKnightCard(); closeModal(); } },
      { type: "roadBuilding", fn: () => { game.playRoadBuildingCard(); ui.mode = "buildRoad"; closeModal(); } },
      { type: "yearOfPlenty", fn: () => openYearOfPlentyModal() },
      { type: "monopoly", fn: () => openMonopolyModal() },
    ];
    let any = false;
    for (const item of items) {
      const playable = canPlayDevCard(s, pi, item.type);
      const count = s.players[pi].devCards[item.type];
      if (count <= 0) continue;
      any = true;
      col.appendChild(
        btn(`${t(item.type)} ×${count}`, item.fn, { disabled: !playable })
      );
    }
    if (!any) {
      const p = document.createElement("p");
      p.textContent = t("devCardHint");
      body.appendChild(p);
    }
    body.appendChild(col);
  });
}

function openYearOfPlentyModal() {
  const picks = [];
  openModal(
    t("yearOfPlenty"),
    (body) => {
      const info = document.createElement("p");
      info.textContent = t("chooseTwoResources");
      body.appendChild(info);
      const status = document.createElement("p");
      status.className = "status";
      body.appendChild(status);
      const grid = document.createElement("div");
      grid.className = "res-buttons";
      body.appendChild(grid);
      const confirm = btn(
        t("confirm"),
        () => {
          game.playYearOfPlentyCard(picks[0], picks[1]);
          closeModal();
        },
        { primary: true, disabled: true }
      );
      function refresh() {
        status.textContent = picks.map((r) => resIcon(r) + t(r)).join(", ");
        confirm.disabled = picks.length !== 2;
      }
      for (const r of RESOURCES) {
        const b = btn(`${resIcon(r)} ${t(r)}`, () => {
          if (picks.length < 2) picks.push(r);
          else picks.length = 0;
          refresh();
        });
        grid.appendChild(b);
      }
      const footer = document.createElement("div");
      footer.className = "modal-footer";
      footer.appendChild(confirm);
      body.appendChild(footer);
    },
    { closable: true }
  );
}

function openMonopolyModal() {
  openModal(
    t("monopoly"),
    (body) => {
      const info = document.createElement("p");
      info.textContent = t("chooseMonopolyResource");
      body.appendChild(info);
      const grid = document.createElement("div");
      grid.className = "res-buttons";
      body.appendChild(grid);
      for (const r of RESOURCES) {
        grid.appendChild(
          btn(`${resIcon(r)} ${t(r)}`, () => {
            game.playMonopolyCard(r);
            closeModal();
          })
        );
      }
    },
    { closable: true }
  );
}

// ---------------- Incoming trade offer (AI → human) ----------------

function renderBundle(container, bundle) {
  container.innerHTML = "";
  const fan = document.createElement("div");
  fan.className = "card-fan";
  for (const r of Object.keys(bundle)) {
    for (let i = 0; i < bundle[r]; i++) {
      fan.appendChild(createResourceCard(r));
    }
  }
  if (fan.childNodes.length === 0) {
    container.textContent = "—";
  } else {
    container.appendChild(fan);
  }
}

function openIncomingTradeModal(offer) {
  const s = game.state;
  const from = s.players[offer.from];

  openModal(
    t("tradeOffer"),
    (body) => {
      const intro = document.createElement("p");
      intro.textContent = t("tradeOfferFrom", { name: from.name });
      intro.style.fontWeight = "600";
      body.appendChild(intro);

      const recvLabel = document.createElement("div");
      recvLabel.className = "trade-label";
      recvLabel.textContent = t("tradeYouReceive");
      body.appendChild(recvLabel);
      const recvCards = document.createElement("div");
      renderBundle(recvCards, offer.give);
      body.appendChild(recvCards);

      const giveLabel = document.createElement("div");
      giveLabel.className = "trade-label";
      giveLabel.textContent = t("tradeYouGive");
      body.appendChild(giveLabel);
      const giveCards = document.createElement("div");
      renderBundle(giveCards, offer.receive);
      body.appendChild(giveCards);

      const footer = document.createElement("div");
      footer.className = "modal-footer";
      footer.appendChild(
        btn(t("rejectTrade"), () => {
          game.rejectPendingTrade();
          closeModal();
        })
      );
      footer.appendChild(
        btn(
          t("acceptTrade"),
          () => {
            game.acceptPendingTrade();
            closeModal();
          },
          { primary: true }
        )
      );
      body.appendChild(footer);
    },
    { closable: false }
  );
}

// ---------------- Trade modal ----------------

function openTradeModal() {
  const s = game.state;
  const pi = s.currentPlayerIndex;
  const p = s.players[pi];

  openModal(t("trade"), (body) => {
    // Bank trade section
    const bankSec = document.createElement("div");
    bankSec.className = "trade-section";
    const bh = document.createElement("h3");
    bh.textContent = t("tradeBank");
    bankSec.appendChild(bh);

    let giveRes = null;
    let recvRes = null;
    const giveRow = document.createElement("div");
    giveRow.className = "res-buttons";
    const recvRow = document.createElement("div");
    recvRow.className = "res-buttons";
    const bankBtn = btn(
      t("tradeWithBank"),
      () => {
        if (giveRes && recvRes) {
          game.bankTrade(giveRes, recvRes);
          closeModal();
        }
      },
      { primary: true, disabled: true }
    );

    function refreshBank() {
      bankBtn.disabled = !(
        giveRes &&
        recvRes &&
        canBankTrade(s, pi, giveRes, recvRes)
      );
    }

    const giveLabel = document.createElement("div");
    giveLabel.className = "trade-label";
    giveLabel.textContent = t("give");
    const recvLabel = document.createElement("div");
    recvLabel.className = "trade-label";
    recvLabel.textContent = t("receive");

    for (const r of RESOURCES) {
      const ratio = bankTradeRatio(s, pi, r);
      const gb = btn(`${resIcon(r)} ${p.resources[r]} (${ratio}:1)`, () => {
        giveRes = giveRes === r ? null : r;
        [...giveRow.children].forEach((c) => c.classList.remove("active"));
        if (giveRes) gb.classList.add("active");
        refreshBank();
      });
      giveRow.appendChild(gb);

      const rb = btn(`${resIcon(r)} ${t(r)}`, () => {
        recvRes = recvRes === r ? null : r;
        [...recvRow.children].forEach((c) => c.classList.remove("active"));
        if (recvRes) rb.classList.add("active");
        refreshBank();
      });
      recvRow.appendChild(rb);
    }
    bankSec.append(giveLabel, giveRow, recvLabel, recvRow, bankBtn);
    body.appendChild(bankSec);

    // Player trade section (offer to AI opponents).
    const playerSec = document.createElement("div");
    playerSec.className = "trade-section";
    const ph = document.createElement("h3");
    ph.textContent = t("tradePlayers");
    playerSec.appendChild(ph);

    const give = {};
    const receive = {};
    for (const r of RESOURCES) {
      give[r] = 0;
      receive[r] = 0;
    }
    const resultMsg = document.createElement("p");
    resultMsg.className = "status";

    const giveGrid = document.createElement("div");
    giveGrid.className = "res-picker";
    const gLabel = document.createElement("div");
    gLabel.className = "trade-label";
    gLabel.textContent = t("give");
    for (const r of RESOURCES) {
      giveGrid.appendChild(
        makeStepper(
          `${resIcon(r)} ${t(r)}`,
          () => give[r],
          (v) => (give[r] = Math.max(0, Math.min(p.resources[r], v))),
          p.resources[r]
        )
      );
    }
    const recvGrid = document.createElement("div");
    recvGrid.className = "res-picker";
    const rLabel = document.createElement("div");
    rLabel.className = "trade-label";
    rLabel.textContent = t("receive");
    for (const r of RESOURCES) {
      recvGrid.appendChild(
        makeStepper(
          `${resIcon(r)} ${t(r)}`,
          () => receive[r],
          (v) => (receive[r] = Math.max(0, Math.min(9, v)))
        )
      );
    }

    const propose = btn(
      t("proposeTrade"),
      () => {
        const g = {};
        const rc = {};
        for (const r of RESOURCES) {
          if (give[r] > 0) g[r] = give[r];
          if (receive[r] > 0) rc[r] = receive[r];
        }
        if (Object.keys(g).length === 0 && Object.keys(rc).length === 0) return;
        const res = game.proposePlayerTrade(g, rc);
        if (res.accepted) {
          closeModal();
        } else {
          resultMsg.textContent = t("noProposals");
        }
      },
      { primary: true }
    );

    playerSec.append(gLabel, giveGrid, rLabel, recvGrid, propose, resultMsg);
    body.appendChild(playerSec);
  });
}

// ---------------- Stepper widget ----------------

function makeStepper(label, get, set, max) {
  const row = document.createElement("div");
  row.className = "stepper";
  const lab = document.createElement("span");
  lab.className = "stepper-label";
  lab.textContent = label;
  const minus = document.createElement("button");
  minus.textContent = "−";
  const val = document.createElement("span");
  val.className = "stepper-val";
  const plus = document.createElement("button");
  plus.textContent = "+";
  function refresh() {
    val.textContent = String(get());
  }
  minus.addEventListener("click", () => {
    set(get() - 1);
    refresh();
  });
  plus.addEventListener("click", () => {
    if (max === undefined || get() < max) set(get() + 1);
    refresh();
  });
  refresh();
  row.append(lab, minus, val, plus);
  return row;
}
