/*
 * Score — application de score locale et hors ligne.
 * Le fichier est volontairement autonome : aucun framework ni dépendance.
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Constantes et état
  // ---------------------------------------------------------------------------

  const CURRENT_KEY = "score.current.v1";
  const HISTORY_KEY = "score.history.v1";
  const MAX_HISTORY = 100;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const screens = [...document.querySelectorAll(".screen")];
  const els = {
    title: document.querySelector("#page-title"),
    back: document.querySelector("#back-button"),
    settings: document.querySelector("#settings-button"),
    resume: document.querySelector("#resume-card"),
    setupForm: document.querySelector("#setup-form"),
    gameName: document.querySelector("#game-name"),
    playerCount: document.querySelector("#player-count"),
    playerFields: document.querySelector("#player-fields"),
    setupError: document.querySelector("#setup-error"),
    gameHeading: document.querySelector("#game-heading"),
    ranking: document.querySelector("#ranking"),
    gameContent: document.querySelector("#game-content"),
    historyList: document.querySelector("#history-list"),
    historyDetail: document.querySelector("#history-detail"),
    historyCount: document.querySelector("#history-count"),
    voiceDialog: document.querySelector("#voice-dialog"),
    voiceTranscript: document.querySelector("#voice-transcript"),
    voiceValues: document.querySelector("#voice-values"),
    voiceError: document.querySelector("#voice-dialog-error"),
    manualVoiceDialog: document.querySelector("#manual-voice-dialog"),
    manualVoiceForm: document.querySelector("#manual-voice-form"),
    manualVoiceHelp: document.querySelector("#manual-voice-help"),
    manualTranscript: document.querySelector("#manual-transcript"),
    manualVoiceError: document.querySelector("#manual-voice-error"),
    toast: document.querySelector("#toast"),
    storageWarning: document.querySelector("#storage-warning"),
    storageMessage: document.querySelector("#storage-message")
  };

  let currentGame = readJSON(CURRENT_KEY, null);
  let history = readJSON(HISTORY_KEY, []);
  let activeScreen = "home-screen";
  let activeHistoryId = null;
  let setupDraft = null;
  let recognition = null;
  let cancelRecognition = null;
  let voiceContext = null;
  let pendingVoiceEntries = [];
  let pendingStorageRetry = null;
  let toastTimer = null;

  // ---------------------------------------------------------------------------
  // Utilitaires
  // ---------------------------------------------------------------------------

  function id() {
    return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn(`Lecture impossible pour ${key}`, error);
      return fallback;
    }
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function asScore(value) {
    if (value === "" || value === null || value === undefined) return 0;
    const number = Number(String(value).replace(",", "."));
    return Number.isFinite(number) ? number : 0;
  }

  function formatScore(value) {
    const number = asScore(value);
    return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100).replace(".", ",");
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(value));
  }

  function toast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }

  function normalizeText(value) {
    return String(value ?? "")
      .toLocaleLowerCase("fr")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, " ")
      .replace(/[^a-z0-9,;\-\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function totalFor(game, playerIndex) {
    if (game.mode === "cumulative") return asScore(game.totals[playerIndex]);
    return game.rounds.reduce((sum, round) => sum + asScore(round[playerIndex]), 0);
  }

  function totalsFor(game) {
    return game.players.map((_, index) => totalFor(game, index));
  }

  function sortedPlayers(game) {
    const totals = totalsFor(game);
    return game.players
      .map((player, index) => ({ ...player, index, score: totals[index] }))
      .sort((a, b) => {
        const difference = game.direction === "high" ? b.score - a.score : a.score - b.score;
        return difference || a.index - b.index;
      });
  }

  function winnerNames(game) {
    const ranking = sortedPlayers(game);
    if (!ranking.length) return "—";
    const best = ranking[0].score;
    return ranking.filter(item => item.score === best).map(item => item.name).join(" et ");
  }

  // ---------------------------------------------------------------------------
  // Persistance et gestion du quota
  // ---------------------------------------------------------------------------

  function writeJSON(key, value, retry) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Écriture impossible pour ${key}`, error);
      showStorageWarning(
        "La sauvegarde n’a pas pu être écrite. Votre partie reste ouverte : purgez l’historique pour libérer de la place, puis réessayez.",
        retry
      );
      return false;
    }
  }

  function persistCurrent() {
    if (!currentGame) return true;
    currentGame.updatedAt = new Date().toISOString();
    return writeJSON(CURRENT_KEY, currentGame, persistCurrent);
  }

  function persistHistory(nextHistory = history, retry = null) {
    const limited = nextHistory.slice(0, MAX_HISTORY);
    if (!writeJSON(HISTORY_KEY, limited, retry)) return false;
    history = limited;
    return true;
  }

  function showStorageWarning(message, retry) {
    pendingStorageRetry = retry || null;
    els.storageMessage.textContent = message;
    els.storageWarning.classList.remove("is-hidden");
  }

  function hideStorageWarning() {
    els.storageWarning.classList.add("is-hidden");
  }

  function purgeHistoryForStorage() {
    try {
      localStorage.removeItem(HISTORY_KEY);
      history = [];
      hideStorageWarning();
      const retry = pendingStorageRetry;
      pendingStorageRetry = null;
      if (retry) {
        const result = retry();
        if (result !== false) toast("Historique purgé et sauvegarde rétablie.");
      } else {
        toast("Historique purgé.");
      }
      renderHome();
    } catch (error) {
      els.storageMessage.textContent = "La purge a échoué. Vérifiez les réglages de stockage de Safari.";
    }
  }

  // ---------------------------------------------------------------------------
  // Navigation et écrans
  // ---------------------------------------------------------------------------

  function showScreen(name) {
    activeScreen = name;
    screens.forEach(screen => screen.classList.toggle("active", screen.id === name));
    const screen = document.getElementById(name);
    els.title.textContent = screen?.dataset.title || "Score";
    els.back.classList.toggle("is-hidden", name === "home-screen");
    els.settings.classList.toggle("is-hidden", name === "settings-screen" || name === "game-screen");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function goBack() {
    const destinations = {
      "setup-screen": "home-screen",
      "history-screen": "home-screen",
      "history-detail-screen": "history-screen",
      "settings-screen": "home-screen",
      "game-screen": "home-screen"
    };
    const destination = destinations[activeScreen] || "home-screen";
    if (destination === "home-screen") renderHome();
    if (destination === "history-screen") renderHistory();
    showScreen(destination);
  }

  function renderHome() {
    if (!currentGame) {
      els.resume.classList.add("is-hidden");
      els.resume.innerHTML = "";
      return;
    }
    els.resume.classList.remove("is-hidden");
    els.resume.innerHTML = `
      <div>
        <h2>Partie en cours</h2>
        <p>${escapeHTML(currentGame.gameName || "Partie sans nom")} · ${currentGame.players.length} joueurs · ${currentGame.mode === "rounds" ? "manches" : "cumul"}</p>
      </div>
      <button class="button primary" id="resume-game" type="button">Reprendre la partie</button>
    `;
    document.querySelector("#resume-game").addEventListener("click", openGame);
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  function defaultDraft() {
    return {
      gameName: "",
      playerNames: ["", "", "", ""],
      mode: "rounds",
      direction: "high"
    };
  }

  function openSetup(draft = null) {
    setupDraft = draft || defaultDraft();
    els.gameName.value = setupDraft.gameName || "";
    els.playerCount.value = String(Math.min(12, Math.max(2, setupDraft.playerNames?.length || 4)));
    document.querySelector(`input[name="mode"][value="${setupDraft.mode || "rounds"}"]`).checked = true;
    document.querySelector(`input[name="direction"][value="${setupDraft.direction || "high"}"]`).checked = true;
    els.setupError.textContent = "";
    renderPlayerFields(setupDraft.playerNames);
    showScreen("setup-screen");
  }

  function readVisiblePlayerNames() {
    return [...els.playerFields.querySelectorAll("input")].map(input => input.value);
  }

  function renderPlayerFields(names = []) {
    const count = Number(els.playerCount.value);
    const previous = names.length ? names : readVisiblePlayerNames();
    els.playerFields.innerHTML = Array.from({ length: count }, (_, index) => `
      <div class="player-input">
        <label for="player-${index}">Joueur ${index + 1}</label>
        <input id="player-${index}" data-player-index="${index}" type="text" maxlength="40" autocomplete="off" placeholder="Prénom" value="${escapeHTML(previous[index] || "")}" required>
      </div>
    `).join("");
  }

  function submitSetup(event) {
    event.preventDefault();
    const names = readVisiblePlayerNames().map(name => name.trim());
    const normalized = names.map(normalizeText);
    if (names.some(name => !name)) {
      els.setupError.textContent = "Donnez un nom à chaque joueur.";
      els.playerFields.querySelector("input[value='']")?.focus();
      return;
    }
    if (new Set(normalized).size !== normalized.length) {
      els.setupError.textContent = "Chaque joueur doit avoir un nom différent.";
      return;
    }

    const mode = document.querySelector('input[name="mode"]:checked').value;
    currentGame = {
      id: id(),
      gameName: els.gameName.value.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      mode,
      direction: document.querySelector('input[name="direction"]:checked').value,
      players: names.map(name => ({ id: id(), name })),
      rounds: mode === "rounds" ? [names.map(() => "")] : [],
      totals: mode === "cumulative" ? names.map(() => 0) : []
    };
    if (!persistCurrent()) return;
    openGame();
  }

  // ---------------------------------------------------------------------------
  // Partie et classement
  // ---------------------------------------------------------------------------

  function openGame() {
    if (!currentGame) return;
    renderGame();
    showScreen("game-screen");
  }

  function renderGame() {
    if (!currentGame) return;
    els.gameHeading.innerHTML = `
      <strong>${escapeHTML(currentGame.gameName || "Partie sans nom")}</strong>
      <span>${currentGame.mode === "rounds" ? "Score par manches" : "Score cumulé"} · ${currentGame.direction === "high" ? "le plus haut gagne" : "le plus bas gagne"}</span>
    `;
    renderRanking();
    if (currentGame.mode === "rounds") renderRounds();
    else renderCumulative();
  }

  function renderRanking() {
    if (!currentGame) return;
    const ranking = sortedPlayers(currentGame);
    let previousScore = null;
    let displayedRank = 0;
    els.ranking.innerHTML = ranking.map((item, index) => {
      if (previousScore === null || item.score !== previousScore) displayedRank = index + 1;
      previousScore = item.score;
      return `<div class="rank-chip"><span class="rank-position">${displayedRank}${displayedRank === 1 ? "er" : "e"}</span><strong>${escapeHTML(item.name)}</strong><span class="rank-score">${formatScore(item.score)}</span></div>`;
    }).join("");
  }

  function renderRounds() {
    const totals = totalsFor(currentGame);
    els.gameContent.innerHTML = `
      <div class="score-table-wrap" id="score-table-wrap">
        <table class="score-table">
          <thead><tr><th scope="col">#</th>${currentGame.players.map(player => `<th scope="col">${escapeHTML(player.name)}</th>`).join("")}</tr></thead>
          <tbody>
            ${currentGame.rounds.map((round, roundIndex) => `
              <tr>
                <th scope="row">${roundIndex + 1}</th>
                ${currentGame.players.map((player, playerIndex) => `
                  <td><input class="score-input" data-round="${roundIndex}" data-player="${playerIndex}" inputmode="numeric" type="text" aria-label="${escapeHTML(player.name)}, manche ${roundIndex + 1}" value="${escapeHTML(round[playerIndex] ?? "")}"></td>
                `).join("")}
              </tr>
            `).join("")}
          </tbody>
          <tfoot><tr><th scope="row">Total</th>${totals.map(total => `<td data-total>${formatScore(total)}</td>`).join("")}</tr></tfoot>
        </table>
      </div>
      <div class="round-actions">
        <button id="next-round" class="button secondary" type="button">Manche suivante</button>
        <button id="delete-round" class="round-delete" type="button" aria-label="Supprimer la dernière manche">⌫</button>
      </div>
    `;
    document.querySelector("#next-round").addEventListener("click", addRound);
    document.querySelector("#delete-round").addEventListener("click", deleteLastRound);
    els.gameContent.querySelectorAll(".score-input").forEach(input => {
      input.addEventListener("input", updateRoundScore);
      input.addEventListener("blur", normalizeScoreInput);
    });
  }

  function updateRoundScore(event) {
    const input = event.currentTarget;
    const roundIndex = Number(input.dataset.round);
    const playerIndex = Number(input.dataset.player);
    const cleaned = input.value.replace(/[^0-9,.-]/g, "").replace(/(?!^)-/g, "");
    if (cleaned !== input.value) input.value = cleaned;
    currentGame.rounds[roundIndex][playerIndex] = cleaned;
    persistCurrent();
    refreshLiveScores();
  }

  function normalizeScoreInput(event) {
    const input = event.currentTarget;
    if (!input.value) return;
    input.value = formatScore(input.value);
    currentGame.rounds[Number(input.dataset.round)][Number(input.dataset.player)] = input.value;
    persistCurrent();
  }

  function refreshLiveScores() {
    renderRanking();
    const totals = totalsFor(currentGame);
    els.gameContent.querySelectorAll("[data-total]").forEach((cell, index) => {
      cell.textContent = formatScore(totals[index]);
    });
    els.gameContent.querySelectorAll("[data-big-score]").forEach((cell, index) => {
      cell.textContent = formatScore(totals[index]);
    });
  }

  function addRound() {
    currentGame.rounds.push(currentGame.players.map(() => ""));
    persistCurrent();
    renderRounds();
    requestAnimationFrame(() => {
      const wrap = document.querySelector("#score-table-wrap");
      if (wrap) wrap.scrollTop = wrap.scrollHeight;
      const lastRound = currentGame.rounds.length - 1;
      document.querySelector(`[data-round="${lastRound}"][data-player="0"]`)?.focus();
    });
  }

  function deleteLastRound() {
    if (currentGame.rounds.length === 1) {
      if (!currentGame.rounds[0].some(value => value !== "")) return toast("La première manche est déjà vide.");
      if (!window.confirm("Effacer tous les scores de la première manche ?")) return;
      currentGame.rounds[0] = currentGame.players.map(() => "");
    } else {
      if (!window.confirm("Supprimer la dernière manche ?")) return;
      currentGame.rounds.pop();
    }
    persistCurrent();
    renderRounds();
    renderRanking();
  }

  function renderCumulative() {
    els.gameContent.innerHTML = `<div class="score-cards">
      ${currentGame.players.map((player, playerIndex) => `
        <article class="score-card">
          <h3>${escapeHTML(player.name)}</h3>
          <div class="big-score" data-big-score>${formatScore(currentGame.totals[playerIndex])}</div>
          <div class="quick-points">
            ${[-10, -5, -1, 1, 5, 10].map(delta => `<button class="point-button" type="button" data-player="${playerIndex}" data-delta="${delta}">${delta > 0 ? "+" : ""}${delta}</button>`).join("")}
          </div>
          <div class="custom-points">
            <button class="point-button custom-adjust" data-sign="-1" data-player="${playerIndex}" type="button" aria-label="Retirer la valeur">−</button>
            <input data-custom="${playerIndex}" inputmode="numeric" type="text" value="1" aria-label="Points pour ${escapeHTML(player.name)}">
            <button class="point-button custom-adjust" data-sign="1" data-player="${playerIndex}" type="button" aria-label="Ajouter la valeur">+</button>
          </div>
        </article>
      `).join("")}
    </div>`;
    els.gameContent.querySelectorAll("[data-delta]").forEach(button => button.addEventListener("click", adjustQuickScore));
    els.gameContent.querySelectorAll(".custom-adjust").forEach(button => button.addEventListener("click", adjustCustomScore));
  }

  function changeCumulativeScore(playerIndex, delta) {
    currentGame.totals[playerIndex] = asScore(currentGame.totals[playerIndex]) + asScore(delta);
    persistCurrent();
    refreshLiveScores();
  }

  function adjustQuickScore(event) {
    changeCumulativeScore(Number(event.currentTarget.dataset.player), Number(event.currentTarget.dataset.delta));
  }

  function adjustCustomScore(event) {
    const playerIndex = Number(event.currentTarget.dataset.player);
    const input = document.querySelector(`[data-custom="${playerIndex}"]`);
    const value = Math.abs(asScore(input.value));
    if (!value) return toast("Indiquez une valeur différente de zéro.");
    changeCumulativeScore(playerIndex, value * Number(event.currentTarget.dataset.sign));
  }

  function finishGame() {
    if (!currentGame) return;
    if (!window.confirm("Terminer et archiver cette partie ?")) return;
    const finishedGame = {
      ...currentGame,
      finishedAt: new Date().toISOString(),
      totals: totalsFor(currentGame),
      winner: winnerNames(currentGame),
      rounds: currentGame.mode === "rounds" ? currentGame.rounds.map(round => [...round]) : []
    };
    const nextHistory = [finishedGame, ...history].slice(0, MAX_HISTORY);
    const completeArchive = (archive = nextHistory) => {
      // Après une purge demandée pour libérer de la place, on ne réinjecte pas
      // les 100 anciennes entrées : seule la partie à sauver est réessayée.
      if (!persistHistory(archive, () => completeArchive([finishedGame]))) return false;
      try {
        localStorage.removeItem(CURRENT_KEY);
      } catch (error) {
        console.warn("Impossible de retirer la partie active", error);
      }
      currentGame = null;
      renderHome();
      showScreen("home-screen");
      toast("Partie archivée.");
      return true;
    };
    completeArchive();
  }

  // ---------------------------------------------------------------------------
  // Historique et réglages
  // ---------------------------------------------------------------------------

  function renderHistory() {
    if (!history.length) {
      els.historyList.innerHTML = '<div class="empty-state">Aucune partie terminée.<br>Votre prochain vainqueur apparaîtra ici.</div>';
      return;
    }
    els.historyList.innerHTML = history.map(game => `
      <article class="history-item">
        <button class="history-open" type="button" data-history-id="${game.id}">
          <strong>${escapeHTML(game.gameName || "Partie sans nom")}</strong>
          <span>${escapeHTML(game.winner || winnerNames(game))}</span>
          <small>${formatDate(game.finishedAt || game.updatedAt)} · ${game.mode === "rounds" ? `${game.rounds?.length || 0} manches` : "cumul"}</small>
        </button>
        <button class="delete-history" type="button" data-delete-id="${game.id}" aria-label="Supprimer ${escapeHTML(game.gameName || "cette partie")}">⌫</button>
      </article>
    `).join("");
  }

  function openHistoryDetail(gameId) {
    const game = history.find(item => item.id === gameId);
    if (!game) return;
    activeHistoryId = gameId;
    const totals = game.totals?.length ? game.totals : totalsFor(game);
    const roundsTable = game.mode === "rounds" ? `
      <div class="readonly-table"><table>
        <thead><tr><th>Manche</th>${game.players.map(player => `<th>${escapeHTML(player.name)}</th>`).join("")}</tr></thead>
        <tbody>${(game.rounds || []).map((round, index) => `<tr><th>${index + 1}</th>${game.players.map((_, playerIndex) => `<td>${formatScore(round[playerIndex])}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
    ` : "";
    els.historyDetail.innerHTML = `
      <div class="detail-hero"><h2>${escapeHTML(game.gameName || "Partie sans nom")}</h2><p>${formatDate(game.finishedAt || game.updatedAt)} · ${game.mode === "rounds" ? "manches" : "cumul"} · ${game.direction === "high" ? "plus haut" : "plus bas"}</p></div>
      <div class="winner-card"><small>${String(game.winner || winnerNames(game)).includes(" et ") ? "Ex æquo" : "Gagnant"}</small><strong>${escapeHTML(game.winner || winnerNames(game))}</strong></div>
      <div class="detail-scores">${game.players.map((player, index) => `<div class="detail-score"><span>${escapeHTML(player.name)}</span><strong>${formatScore(totals[index])}</strong></div>`).join("")}</div>
      ${roundsTable}
      <button id="replay-game" class="button primary" type="button">Rejouer avec les mêmes joueurs</button>
    `;
    document.querySelector("#replay-game").addEventListener("click", () => replayGame(game));
    showScreen("history-detail-screen");
  }

  function replayGame(game) {
    openSetup({
      gameName: game.gameName || "",
      playerNames: game.players.map(player => player.name),
      mode: game.mode,
      direction: game.direction
    });
  }

  function deleteHistoryItem(gameId) {
    const game = history.find(item => item.id === gameId);
    if (!game || !window.confirm(`Supprimer « ${game.gameName || "Partie sans nom"} » de l’historique ?`)) return;
    const next = history.filter(item => item.id !== gameId);
    if (!persistHistory(next)) return;
    renderHistory();
    toast("Partie supprimée.");
  }

  function renderSettings() {
    els.historyCount.textContent = history.length
      ? `${history.length} partie${history.length > 1 ? "s" : ""} archivée${history.length > 1 ? "s" : ""} sur 100 maximum.`
      : "Aucune partie archivée.";
  }

  function clearHistory() {
    if (!history.length) return toast("L’historique est déjà vide.");
    if (!window.confirm("Vider définitivement tout l’historique ? La partie en cours sera conservée.")) return;
    if (!persistHistory([])) return;
    renderSettings();
    toast("Historique vidé.");
  }

  // ---------------------------------------------------------------------------
  // Analyse des nombres et rapprochement des noms
  // ---------------------------------------------------------------------------

  const UNITS = {
    zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
    six: 6, sept: 7, huit: 8, neuf: 9
  };
  const TEENS = { dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16 };
  const TENS = { vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };
  const NUMBER_WORDS = new Set([
    ...Object.keys(UNITS), ...Object.keys(TEENS), ...Object.keys(TENS),
    "vingts", "cent", "cents", "moins", "et"
  ]);

  function parseFrenchNumber(value) {
    const normalized = normalizeText(value).replaceAll("-", " ");
    const digitMatch = normalized.match(/(?:moins\s+|-)?\d+(?:[.,]\d+)?/);
    if (digitMatch) return Number(digitMatch[0].replace(/moins\s+/, "-").replace(",", "."));

    const words = normalized.split(/\s+/).filter(Boolean);
    const negative = words.includes("moins");
    let result = 0;
    let found = false;
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index];
      const next = words[index + 1];
      const after = words[index + 2];
      if (word === "moins" || word === "et") continue;
      if (word === "cent" || word === "cents") {
        result = result ? result * 100 : 100;
        found = true;
        continue;
      }
      if (word === "quatre" && (next === "vingt" || next === "vingts")) {
        result += 80;
        found = true;
        index += 1;
        if (after === "dix") {
          result += 10;
          index += 1;
        } else if (after && TEENS[after] !== undefined) {
          result += TEENS[after];
          index += 1;
        }
        continue;
      }
      if (word === "soixante" && next && TEENS[next] !== undefined) {
        result += 60 + TEENS[next];
        found = true;
        index += 1;
        continue;
      }
      if (TENS[word] !== undefined) {
        result += TENS[word];
        found = true;
        continue;
      }
      if (TEENS[word] !== undefined) {
        result += TEENS[word];
        found = true;
        continue;
      }
      if (UNITS[word] !== undefined) {
        result += UNITS[word];
        found = true;
      }
    }
    return found ? (negative ? -result : result) : Number.NaN;
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const saved = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = saved;
      }
    }
    return row[b.length];
  }

  function findPlayerMentions(transcript, players) {
    const normalized = normalizeText(transcript).replace(/[,;\-]/g, " ");
    const words = normalized.split(/\s+/).filter(Boolean);
    const mentions = [];
    players.forEach((player, playerIndex) => {
      const playerName = normalizeText(player.name);
      const nameLength = playerName.split(" ").length;
      let best = null;
      for (let size = Math.max(1, nameLength - 1); size <= nameLength + 1; size += 1) {
        for (let start = 0; start <= words.length - size; start += 1) {
          const candidate = words.slice(start, start + size).join(" ");
          // Un mot de nombre ne doit jamais devenir un prénom par tolérance
          // (par exemple « trois » ressemble assez à « Thomas »).
          if (candidate.split(" ").every(word => NUMBER_WORDS.has(word) || /^\d+$/.test(word))) continue;
          const distance = levenshtein(playerName, candidate);
          // Une tolérance d’environ 40 % accepte notamment « Sofi » pour
          // « Sophie », sans confondre les prénoms courts les plus courants.
          const threshold = Math.max(2, Math.ceil(playerName.length * 0.4));
          if (distance <= threshold && (!best || distance < best.distance)) {
            best = { playerIndex, start, end: start + size, distance };
          }
        }
      }
      if (best) mentions.push(best);
    });
    return { words, mentions: mentions.sort((a, b) => a.start - b.start) };
  }

  function parseScoreTranscript(transcript, players) {
    const { words, mentions } = findPlayerMentions(transcript, players);
    return mentions.map((mention, index) => {
      const nextStart = mentions[index + 1]?.start ?? words.length;
      const scoreWords = words.slice(mention.end, nextStart).filter(word => word !== "et");
      const score = parseFrenchNumber(scoreWords.join(" "));
      return {
        playerIndex: mention.playerIndex,
        name: players[mention.playerIndex].name,
        value: score
      };
    }).filter(entry => Number.isFinite(entry.value));
  }

  function parsePlayerNamesTranscript(transcript) {
    const hasPunctuation = /[,;]/.test(transcript);
    let names = hasPunctuation
      ? transcript.split(/\s*(?:,|;|\bet\b)\s*/i)
      : transcript.replace(/\bet\b/gi, " ").split(/\s+/);
    return names
      .map(name => name.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map(name => name.charAt(0).toLocaleUpperCase("fr") + name.slice(1));
  }

  // ---------------------------------------------------------------------------
  // Reconnaissance vocale et confirmation
  // ---------------------------------------------------------------------------

  function configureVoiceSupport() {
    document.querySelectorAll(".voice-control").forEach(button => {
      button.dataset.directVoice = SpeechRecognition ? "true" : "false";
      if (!SpeechRecognition) {
        button.title = "Utiliser la dictée du clavier";
        const label = button.querySelector(".mic-label");
        if (label) label.textContent = "Dicter ou saisir les scores";
      }
    });
  }

  function startVoice(context, button) {
    if (!SpeechRecognition) {
      return openManualVoice(context, "La reconnaissance directe n’est pas disponible dans ce navigateur.");
    }
    // Un second appui arrête une écoute qui tarde et bascule vers la saisie sûre.
    if (cancelRecognition) return cancelRecognition("Écoute arrêtée.");

    voiceContext = context;
    const instance = new SpeechRecognition();
    recognition = instance;
    let settled = false;
    let timeout = null;
    instance.lang = "fr-FR";
    instance.interimResults = false;
    instance.continuous = false;
    instance.maxAlternatives = 1;
    button.classList.add("listening");
    const originalLabel = button.querySelector(".mic-label")?.textContent;
    if (button.querySelector(".mic-label")) button.querySelector(".mic-label").textContent = "J’écoute…";

    const cleanup = () => {
      clearTimeout(timeout);
      button.classList.remove("listening");
      if (originalLabel) button.querySelector(".mic-label").textContent = originalLabel;
      if (recognition === instance) recognition = null;
      if (cancelRecognition === cancel) cancelRecognition = null;
    };

    const cancel = message => {
      if (settled) return;
      settled = true;
      instance.abort();
      cleanup();
      openManualVoice(context, message);
    };
    cancelRecognition = cancel;

    instance.onresult = event => {
      if (settled) return;
      settled = true;
      const transcript = event.results[0][0].transcript.trim();
      cleanup();
      processVoiceResult(context, transcript);
    };
    instance.onerror = event => {
      if (settled) return;
      settled = true;
      cleanup();
      const denied = event.error === "not-allowed" || event.error === "service-not-allowed";
      voiceFallback(context, denied ? "L’accès au micro a été refusé." : "La dictée n’a pas abouti.");
    };
    instance.onend = () => {
      if (settled) return;
      settled = true;
      cleanup();
      voiceFallback(context, "Aucun mot n’a été reconnu.");
    };
    try {
      instance.start();
      timeout = setTimeout(() => cancel("L’écoute a expiré."), 15000);
    } catch (error) {
      settled = true;
      cleanup();
      voiceFallback(context, "Le micro n’a pas pu démarrer.");
    }
  }

  function processVoiceResult(context, transcript) {
    if (!transcript) return voiceFallback(context, "Aucun mot n’a été reconnu.");
    if (context === "game") {
      els.gameName.value = transcript.replace(/[.!?]+$/, "");
      toast("Nom du jeu ajouté.");
      return;
    }
    if (context === "players") {
      const names = parsePlayerNamesTranscript(transcript);
      if (names.length < 2) return voiceFallback(context, "Je n’ai pas reconnu au moins deux noms.");
      els.playerCount.value = String(names.length);
      renderPlayerFields(names);
      toast(`${names.length} joueurs reconnus. Vérifiez les noms.`);
      return;
    }
    if (context === "scores") {
      const entries = parseScoreTranscript(transcript, currentGame.players);
      if (!entries.length) return voiceFallback(context, "Je n’ai associé aucun score aux joueurs.");
      openVoiceConfirmation(transcript, entries);
    }
  }

  function voiceFallback(context, message) {
    toast(`${message} La saisie de secours est ouverte.`);
    openManualVoice(context, message);
  }

  function openManualVoice(context, message = "") {
    voiceContext = context;
    const examples = {
      game: "Dictez ou saisissez le nom du jeu.",
      players: "Exemple : Marie, Paul, Sophie et Thomas.",
      scores: currentGame
        ? `Exemple : ${currentGame.players.slice(0, 3).map((player, index) => `${player.name} ${["douze", "moins trois", "vingt-cinq"][index]}`).join(", ")}.`
        : "Dictez un prénom suivi de son score."
    };
    els.manualVoiceHelp.textContent = [message, examples[context]].filter(Boolean).join(" ");
    els.manualVoiceError.textContent = "";
    els.manualTranscript.value = "";
    els.manualTranscript.placeholder = context === "scores" ? "Marie douze, Paul moins trois…" : "Touchez ici pour dicter…";
    if (!els.manualVoiceDialog.open) els.manualVoiceDialog.showModal();
    requestAnimationFrame(() => els.manualTranscript.focus());
  }

  function submitManualVoice(event) {
    event.preventDefault();
    const transcript = els.manualTranscript.value.trim();
    if (!transcript) {
      els.manualVoiceError.textContent = "Dictez ou saisissez quelque chose avant d’analyser.";
      els.manualTranscript.focus();
      return;
    }
    els.manualVoiceDialog.close();
    processVoiceResult(voiceContext, transcript);
  }

  function openVoiceConfirmation(transcript, entries) {
    pendingVoiceEntries = entries;
    els.voiceTranscript.textContent = `« ${transcript} »`;
    els.voiceError.textContent = "";
    els.voiceValues.innerHTML = entries.map((entry, index) => `
      <div class="voice-row">
        <label for="voice-value-${index}">${escapeHTML(entry.name)}</label>
        <input id="voice-value-${index}" data-entry="${index}" type="text" inputmode="numeric" value="${formatScore(entry.value)}">
      </div>
    `).join("");
    els.voiceDialog.showModal();
  }

  function confirmVoiceScores(event) {
    event.preventDefault();
    const inputs = [...els.voiceValues.querySelectorAll("input")];
    const values = inputs.map(input => {
      const raw = input.value.trim().replace(",", ".");
      return raw === "" ? Number.NaN : Number(raw);
    });
    if (values.some(value => !Number.isFinite(value))) {
      els.voiceError.textContent = "Corrigez les valeurs non numériques avant de valider.";
      return;
    }
    if (currentGame.mode === "rounds") {
      const roundIndex = currentGame.rounds.length - 1;
      pendingVoiceEntries.forEach((entry, index) => {
        currentGame.rounds[roundIndex][entry.playerIndex] = formatScore(values[index]);
      });
      persistCurrent();
      renderRounds();
    } else {
      pendingVoiceEntries.forEach((entry, index) => {
        currentGame.totals[entry.playerIndex] = asScore(currentGame.totals[entry.playerIndex]) + values[index];
      });
      persistCurrent();
      renderCumulative();
    }
    renderRanking();
    els.voiceDialog.close();
    toast(currentGame.mode === "rounds" ? "Scores ajoutés à la manche." : "Points ajoutés aux totaux.");
  }

  // ---------------------------------------------------------------------------
  // Événements et initialisation
  // ---------------------------------------------------------------------------

  document.querySelector("#new-game-button").addEventListener("click", () => {
    if (currentGame && !window.confirm("Une partie est déjà en cours. La remplacer par une nouvelle partie ?")) return;
    openSetup();
  });
  document.querySelector("#history-button").addEventListener("click", () => {
    renderHistory();
    showScreen("history-screen");
  });
  els.back.addEventListener("click", goBack);
  els.settings.addEventListener("click", () => {
    renderSettings();
    showScreen("settings-screen");
  });
  els.playerCount.addEventListener("change", () => renderPlayerFields());
  els.setupForm.addEventListener("submit", submitSetup);
  document.querySelector("#finish-game").addEventListener("click", finishGame);
  document.querySelector("#clear-history").addEventListener("click", clearHistory);
  document.querySelector("#confirm-voice").addEventListener("click", confirmVoiceScores);
  els.manualVoiceForm.addEventListener("submit", submitManualVoice);
  document.querySelector("#close-manual-voice").addEventListener("click", () => els.manualVoiceDialog.close());
  document.querySelector("#cancel-manual-voice").addEventListener("click", () => els.manualVoiceDialog.close());
  document.querySelector("#manual-score-entry").addEventListener("click", () => {
    if (cancelRecognition) cancelRecognition("Dictée directe arrêtée.");
    else openManualVoice("scores");
  });
  document.querySelector("#purge-history").addEventListener("click", purgeHistoryForStorage);
  document.querySelector("#dismiss-storage").addEventListener("click", hideStorageWarning);

  els.historyList.addEventListener("click", event => {
    const openButton = event.target.closest("[data-history-id]");
    const deleteButton = event.target.closest("[data-delete-id]");
    if (openButton) openHistoryDetail(openButton.dataset.historyId);
    if (deleteButton) deleteHistoryItem(deleteButton.dataset.deleteId);
  });

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-voice]");
    if (button) startVoice(button.dataset.voice, button);
  });

  if (!Array.isArray(history)) history = [];
  history = history.slice(0, MAX_HISTORY);
  if (currentGame && (!Array.isArray(currentGame.players) || !currentGame.mode)) {
    currentGame = null;
    localStorage.removeItem(CURRENT_KEY);
  }

  configureVoiceSupport();
  renderHome();
  showScreen("home-screen");

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(error => console.warn("Service worker indisponible", error)));
  }

  // API minuscule utilisée par les tests manuels/automatisés, sans modifier l’UI.
  window.ScoreTest = { parseFrenchNumber, levenshtein, parseScoreTranscript, parsePlayerNamesTranscript, normalizeText };
})();
