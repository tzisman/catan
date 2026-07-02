// Entry point: builds the setup screen (players, human/AI, board type, language)
// and launches the game.

import { t, setLang, getLang, LANGS } from "./i18n.js";
import { initGame, update } from "./ui.js";

const setupState = {
  numPlayers: 3,
  players: [
    { name: "", isAI: false },
    { name: "", isAI: true },
    { name: "", isAI: true },
    { name: "", isAI: true },
  ],
  boardType: "random",
};

function defaultName(i) {
  return `${t("player")} ${i + 1}`;
}

const $ = (id) => document.getElementById(id);

function renderSetup() {
  setLang(getLang());
  const root = $("setup-screen");
  root.innerHTML = "";

  const card = document.createElement("div");
  card.className = "setup-card";

  const h1 = document.createElement("h1");
  h1.textContent = "🎲 " + t("title");
  const sub = document.createElement("p");
  sub.className = "subtitle";
  sub.textContent = t("subtitle");
  card.append(h1, sub);

  // Language
  card.appendChild(fieldLabel(t("language")));
  const langRow = document.createElement("div");
  langRow.className = "lang-switch";
  for (const lang of LANGS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = lang === "he" ? "עברית" : "English";
    b.className = "toggle" + (getLang() === lang ? " active" : "");
    b.addEventListener("click", () => {
      setLang(lang);
      renderSetup();
    });
    langRow.appendChild(b);
  }
  card.appendChild(langRow);

  // Number of players
  card.appendChild(fieldLabel(t("numPlayers")));
  const numRow = document.createElement("div");
  numRow.className = "toggle-group";
  for (const n of [2, 3, 4]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = String(n);
    b.className = "toggle" + (setupState.numPlayers === n ? " active" : "");
    b.addEventListener("click", () => {
      setupState.numPlayers = n;
      renderSetup();
    });
    numRow.appendChild(b);
  }
  card.appendChild(numRow);

  // Player configs
  card.appendChild(fieldLabel(t("player")));
  const playersWrap = document.createElement("div");
  playersWrap.className = "players-config";
  for (let i = 0; i < setupState.numPlayers; i++) {
    const cfg = setupState.players[i];
    const row = document.createElement("div");
    row.className = "player-config-row";

    const dot = document.createElement("span");
    dot.className = "player-dot";
    dot.style.background = ["#d64545", "#2f6fb0", "#e08a1e", "#e8e6df"][i];
    row.appendChild(dot);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = defaultName(i);
    input.value = cfg.name;
    input.addEventListener("input", (e) => {
      cfg.name = e.target.value;
    });
    row.appendChild(input);

    const typeGroup = document.createElement("div");
    typeGroup.className = "toggle-group";
    const humanBtn = document.createElement("button");
    humanBtn.type = "button";
    humanBtn.textContent = t("human");
    humanBtn.className = "toggle" + (!cfg.isAI ? " active" : "");
    const aiBtn = document.createElement("button");
    aiBtn.type = "button";
    aiBtn.textContent = t("ai");
    aiBtn.className = "toggle" + (cfg.isAI ? " active" : "");
    humanBtn.addEventListener("click", () => {
      cfg.isAI = false;
      renderSetup();
    });
    aiBtn.addEventListener("click", () => {
      cfg.isAI = true;
      renderSetup();
    });
    typeGroup.append(humanBtn, aiBtn);
    row.appendChild(typeGroup);

    playersWrap.appendChild(row);
  }
  card.appendChild(playersWrap);

  // Board type
  card.appendChild(fieldLabel(t("boardType")));
  const boardRow = document.createElement("div");
  boardRow.className = "toggle-group";
  for (const [key, label] of [
    ["random", t("boardRandom")],
    ["fixed", t("boardFixed")],
  ]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.className = "toggle" + (setupState.boardType === key ? " active" : "");
    b.addEventListener("click", () => {
      setupState.boardType = key;
      renderSetup();
    });
    boardRow.appendChild(b);
  }
  card.appendChild(boardRow);

  // Start
  const start = document.createElement("button");
  start.className = "start-btn";
  start.textContent = t("startGame");
  start.addEventListener("click", startGame);
  card.appendChild(start);

  root.appendChild(card);
}

function fieldLabel(text) {
  const l = document.createElement("label");
  l.className = "field-label";
  l.textContent = text;
  return l;
}

function startGame() {
  const configs = [];
  for (let i = 0; i < setupState.numPlayers; i++) {
    const cfg = setupState.players[i];
    configs.push({
      name: cfg.name.trim() || defaultName(i),
      isAI: cfg.isAI,
    });
  }
  const boardOptions = { random: setupState.boardType === "random" };
  wireGameHeader();
  initGame(configs, boardOptions);
}

// In-game header controls (language switch + new game).
function wireGameHeader() {
  const langWrap = $("game-lang");
  langWrap.innerHTML = "";
  for (const lang of LANGS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = lang === "he" ? "עב" : "EN";
    b.className = "toggle" + (getLang() === lang ? " active" : "");
    b.addEventListener("click", () => {
      setLang(lang);
      wireGameHeader();
      update();
    });
    langWrap.appendChild(b);
  }
  $("new-game-btn").onclick = () => location.reload();
}

setLang("he");

// ES modules require a local server — warn if opened as a file:// URL.
if (location.protocol === "file:") {
  document.body.innerHTML =
    '<div style="max-width:520px;margin:40px auto;padding:24px;font-family:sans-serif;text-align:center">' +
    "<h1>קטאן / Catan</h1>" +
    "<p>יש להריץ את המשחק דרך שרת מקומי, לא לפתוח את index.html ישירות.</p>" +
    "<p>Run: <code>python -m http.server 8000</code></p>" +
    "<p>Then open: <a href=\"http://localhost:8000\">http://localhost:8000</a></p>" +
    "</div>";
} else {
  renderSetup();
}
