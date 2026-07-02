// Visual card components for resource and development cards.

import { t } from "./i18n.js";
import { RESOURCE_ICON } from "./render.js";
import { RESOURCES } from "./board.js";
import { DEV_CARD_TYPES } from "./gamestate.js";

export const DEV_CARD_ICON = {
  knight: "⚔️",
  victoryPoint: "⭐",
  roadBuilding: "🛣️",
  yearOfPlenty: "🌾",
  monopoly: "👑",
};

export const DEV_CARD_COLOR = {
  knight: "#5b6abf",
  victoryPoint: "#d4a017",
  roadBuilding: "#3d8b5a",
  yearOfPlenty: "#c47a2a",
  monopoly: "#8b3a62",
};

/** Single resource card element. */
export function createResourceCard(resource, { mini = false, faceDown = false } = {}) {
  const card = document.createElement("div");
  card.className = "game-card resource-card" + (mini ? " mini" : "") + (faceDown ? " face-down" : "");
  card.dataset.resource = resource;
  if (faceDown) {
    card.innerHTML = '<span class="card-back-pattern"></span>';
    return card;
  }
  card.innerHTML = `
    <span class="card-corner top">${RESOURCE_ICON[resource] || ""}</span>
    <span class="card-art">${RESOURCE_ICON[resource] || ""}</span>
    <span class="card-label">${t(resource)}</span>
    <span class="card-corner bottom">${RESOURCE_ICON[resource] || ""}</span>
  `;
  return card;
}

/** Single development card element. */
export function createDevCard(type, { mini = false, faceDown = false, unplayable = false } = {}) {
  const card = document.createElement("div");
  card.className =
    "game-card dev-card" +
    (mini ? " mini" : "") +
    (faceDown ? " face-down" : "") +
    (unplayable ? " unplayable" : "");
  card.dataset.type = type;
  card.style.setProperty("--dev-color", DEV_CARD_COLOR[type] || "#5b6abf");
  if (faceDown) {
    card.innerHTML = '<span class="card-back-pattern dev-back"></span>';
    return card;
  }
  card.innerHTML = `
    <span class="card-corner top">${DEV_CARD_ICON[type] || "📜"}</span>
    <span class="card-art">${DEV_CARD_ICON[type] || "📜"}</span>
    <span class="card-label">${t(type)}</span>
  `;
  return card;
}

/** Fan of resource cards for a player. */
export function renderResourceHand(container, resources, { mini = false, faceDown = false, maxShow = 20 } = {}) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "card-fan resource-fan";
  let shown = 0;
  for (const r of RESOURCES) {
    for (let i = 0; i < resources[r]; i++) {
      if (shown >= maxShow) break;
      wrap.appendChild(createResourceCard(r, { mini, faceDown }));
      shown++;
    }
  }
  const total = RESOURCES.reduce((s, r) => s + resources[r], 0);
  if (total > maxShow) {
    const more = document.createElement("span");
    more.className = "card-more";
    more.textContent = `+${total - maxShow}`;
    wrap.appendChild(more);
  }
  container.appendChild(wrap);
  return total;
}

/** Fan of dev cards (expanded list). */
export function renderDevHand(container, devCards, newDevCards, { mini = false, faceDown = false } = {}) {
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "card-fan dev-fan";
  for (const type of DEV_CARD_TYPES) {
    const playable = devCards[type] || 0;
    const fresh = newDevCards[type] || 0;
    for (let i = 0; i < playable; i++) {
      wrap.appendChild(createDevCard(type, { mini, faceDown }));
    }
    for (let i = 0; i < fresh; i++) {
      wrap.appendChild(createDevCard(type, { mini, faceDown, unplayable: true }));
    }
  }
  container.appendChild(wrap);
}

/** Compact stack of face-down cards with count badge. */
export function renderCardStack(container, count, { label = "", kind = "resource" } = {}) {
  container.innerHTML = "";
  if (count <= 0) return;
  const stack = document.createElement("div");
  stack.className = "card-stack " + kind;
  const visible = Math.min(count, 3);
  for (let i = 0; i < visible; i++) {
    const c = document.createElement("div");
    c.className = "game-card mini face-down stack-card";
    c.style.setProperty("--stack-i", i);
    stack.appendChild(c);
  }
  const badge = document.createElement("span");
  badge.className = "stack-count";
  badge.textContent = String(count);
  stack.appendChild(badge);
  if (label) {
    const lab = document.createElement("span");
    lab.className = "stack-label";
    lab.textContent = label;
    stack.appendChild(lab);
  }
  container.appendChild(stack);
}

/** Dice face with dot pattern. */
export function createDiceFace(value) {
  const d = document.createElement("div");
  d.className = "dice die-" + value;
  const dots = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("span");
    cell.className = "die-cell" + (dots[value].includes(i) ? " on" : "");
    d.appendChild(cell);
  }
  return d;
}

export function renderDice(container, dice) {
  container.innerHTML = "";
  if (!dice) return;
  const wrap = document.createElement("div");
  wrap.className = "dice-pair";
  wrap.appendChild(createDiceFace(dice.d1));
  wrap.appendChild(createDiceFace(dice.d2));
  const sum = document.createElement("span");
  sum.className = "dice-sum";
  sum.textContent = "= " + dice.sum;
  wrap.appendChild(sum);
  container.appendChild(wrap);
}
