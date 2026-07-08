(() => {
  "use strict";

  const PLAYERS = window.SQUAD_UP_PLAYERS || [];
  const POSITIONS = ["ST", "MID", "MID", "DEF", "GK"];
  const STORAGE_KEY = "squad-up-state-v1";
  const MATCH_DURATION_MS = 150000;
  const LOADING_BEAT_MS = 1800;
  const WINNER_REVEAL_MS = 5200;
  const COMMENTARY_MIN_MS = 4800;
  const COMMENTARY_MAX_MS = 10500;
  const COMMENTARY_WORDS_PER_MINUTE = 150;
  const LOADING_LINES = [
    "Buses arriving. Someone forgot the bibs.",
    "Warm-ups underway. Hamstrings negotiating.",
    "Keeper claims they meant that.",
    "Final team talk. Tactics remain classified.",
    "Tunnel ready. Main-character energy activated."
  ];
  const app = document.querySelector("#app");

  const emptyTeam = (side) => ({
    side,
    name: "",
    players: POSITIONS.map((position, index) => ({
      slotId: `${side}-${position}-${index}`,
      position,
      name: "",
      rating: null,
      attributes: [],
      known: false
    }))
  });

  const state = {
    screen: "home",
    home: emptyTeam("home"),
    away: emptyTeam("away"),
    match: null,
    activeField: null,
    query: "",
    paused: false,
    matchEntered: false,
    elapsedMs: 0,
    startedAt: null,
    timer: null,
    tick: null,
    loadingTick: null,
    transitionTick: null,
    loadingStep: 0,
    shareImage: ""
  };

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
  }

  function normalize(value = "") {
    return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, "");
  }

  function scoreMatch(query, player, position) {
    const q = normalize(query);
    const name = normalize(player.name);
    const words = name.split(" ");
    let score = 0;
    if (name === q) score += 100;
    if (name.startsWith(q)) score += 55;
    if (name.includes(q)) score += 35;
    if (words.some((word) => word.startsWith(q))) score += 25;
    const chars = q.split("");
    let cursor = 0;
    chars.forEach((char) => {
      const found = name.indexOf(char, cursor);
      if (found >= 0) { score += 2; cursor = found + 1; }
    });
    if (player.positions.includes(position)) score += 18;
    return score;
  }

  function findPlayer(name) {
    const target = normalize(name);
    return PLAYERS.find((player) => normalize(player.name) === target);
  }

  function getSuggestions(query, position) {
    if (!query.trim()) return PLAYERS
      .filter((player) => player.positions.includes(position))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 6);
    return PLAYERS
      .map((player) => ({ ...player, searchScore: scoreMatch(query, player, position) }))
      .filter((player) => player.searchScore > 4)
      .sort((a, b) => b.searchScore - a.searchScore || b.rating - a.rating)
      .slice(0, 6);
  }

  function firstName(name) {
    return name.split(" ")[0] || name;
  }

  function lastName(name) {
    const parts = name.trim().split(" ");
    return parts[parts.length - 1] || name;
  }

  function teamBySide(side) {
    return side === "home" ? state.home : state.away;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ home: state.home, away: state.away }));
    } catch {}
  }

  function restoreState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved?.home?.players?.length === 5 && saved?.away?.players?.length === 5) {
        state.home = saved.home;
        state.away = saved.away;
      }
    } catch {}
  }

  function toast(message) {
    const region = document.querySelector("#toast-region");
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => item.remove(), 2600);
  }

  function render() {
    clearTimers();
    if (state.screen === "home") renderHome();
    if (state.screen === "builder") renderBuilder();
    if (state.screen === "loading") renderLoading();
    if (state.screen === "match") renderMatch();
    if (state.screen === "fast-forward") renderFastForward();
    if (state.screen === "result-reveal") renderResultReveal();
    if (state.screen === "summary") renderSummary();
    bindGlobalEvents();
  }

  function renderHome() {
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen screen--enter home-screen" aria-labelledby="home-title">
          <div class="home-inner">
            <h1 class="brand" id="home-title">Squad Up</h1>
            <p class="home-copy">Build a five-a-side lineup, choose an opponent, and watch a simulated fixture unfold with live play-by-play drama.</p>
            <button class="button button--wide" data-action="new-game">New Game</button>
          </div>
        </section>
      </main>`;
  }

  function renderBuilder(animate = false) {
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen builder-screen ${animate ? "screen--enter" : ""}" aria-labelledby="builder-title">
          <div class="topline">
            <button class="text-button" data-action="home" aria-label="Return to home">← Home</button>
            <h1 class="brand brand--small" id="builder-title">Squad Up</h1>
            <span aria-hidden="true" style="width:64px"></span>
          </div>
          <div class="builder-grid">
            ${teamPanel(state.home)}
            ${pitchMarkup()}
            ${teamPanel(state.away)}
          </div>
          <div class="builder-footer">
            <button class="button button--wide" data-action="start-match" ${isReady() ? "" : "disabled"}>Start Match</button>
            <p class="builder-status">${builderStatus()}</p>
          </div>
        </section>
      </main>`;
    requestAnimationFrame(() => {
      if (state.activeField) {
        const input = document.querySelector(`[data-slot="${state.activeField}"]`);
        input?.focus();
        if (input) input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  }

  function teamPanel(team) {
    return `
      <section class="team-panel team-panel--${team.side}" aria-label="${team.side} team">
        <p class="eyebrow team-kicker ${team.side}">${team.side}</p>
        <input class="team-name-input" data-team-name="${team.side}" maxlength="28" aria-label="${team.side} team name" placeholder="Enter Team Name" value="${escapeHtml(team.name)}" />
        <div class="player-fields">
          ${team.players.map((slot) => playerField(team, slot)).join("")}
        </div>
        <div class="team-actions">
          <button class="button button--ghost button--small" data-action="randomise" data-side="${team.side}">Randomise</button>
          <button class="button button--ghost button--small" data-action="clear-team" data-side="${team.side}">Clear</button>
        </div>
      </section>`;
  }

  function playerField(team, slot) {
    const isActive = state.activeField === slot.slotId;
    const suggestions = isActive ? getSuggestions(state.query, slot.position) : [];
    const isExact = findPlayer(state.query);
    return `
      <div class="player-field">
        <div class="player-input-wrap ${isActive ? "is-active" : ""}">
          <span class="position-tag">${slot.position}</span>
          <input class="player-input" data-slot="${slot.slotId}" data-side="${team.side}" aria-label="${team.side} ${slot.position} player" autocomplete="off" placeholder="Search a player..." value="${escapeHtml(isActive ? state.query : slot.name)}" />
          ${slot.name ? `<span class="selected-rating" title="${slot.known ? slot.attributes.join(", ") : "Custom player"}">${slot.rating}</span>` : ""}
        </div>
        ${isActive ? `
          <div class="suggestions" role="listbox">
            ${suggestions.map((player) => `
              <button class="suggestion" role="option" data-action="select-player" data-name="${escapeHtml(player.name)}">
                <span class="suggestion-line"><span>${escapeHtml(player.name)}</span><span>${player.rating}</span></span>
                <span class="suggestion-meta">${escapeHtml(player.era)} · ${escapeHtml(player.attributes.slice(0, 2).join(" · "))}</span>
              </button>`).join("")}
            ${state.query.trim() && !isExact ? `
              <button class="suggestion custom-option" role="option" data-action="select-custom">
                <span class="suggestion-line"><span>Use “${escapeHtml(state.query.trim())}”</span><span>65</span></span>
                <span class="suggestion-meta">Custom player · default rating</span>
              </button>` : ""}
          </div>` : ""}
      </div>`;
  }

  function pitchMarkup() {
    const positions = {
      home: [[43,50],[33,32],[33,68],[21,50],[10,50]],
      away: [[57,50],[67,32],[67,68],[79,50],[90,50]]
    };
    const players = ["home", "away"].flatMap((side) =>
      teamBySide(side).players.map((player, index) => ({ ...player, side, coords: positions[side][index] }))
    );
    return `
      <div class="pitch-wrap">
        <div class="pitch" aria-label="Five-a-side pitch preview">
          <div class="penalty left"></div><div class="penalty right"></div>
          ${players.map((player) => `
            <button
              class="pitch-player ${player.side} ${player.name ? "is-selected" : "is-empty"} ${state.activeField === player.slotId ? "is-active" : ""}"
              style="left:${player.coords[0]}%;top:${player.coords[1]}%"
              data-action="focus-slot"
              data-slot="${player.slotId}"
              aria-label="${player.name ? `Edit ${escapeHtml(player.name)}` : `Select ${player.side} ${player.position}`}"
            >
              <span class="pitch-dot">${player.position}</span>
              <span class="pitch-label">${escapeHtml(player.name ? lastName(player.name) : "Select")}</span>
            </button>`).join("")}
        </div>
        <p class="pitch-helper">Players appear on the pitch as you build each five.</p>
      </div>`;
  }

  function builderStatus() {
    const missingNames = [state.home, state.away].filter((team) => !team.name.trim()).length;
    const missingPlayers = [...state.home.players, ...state.away.players].filter((player) => !player.name.trim()).length;
    if (!missingNames && !missingPlayers) return "Both squads are ready. Let’s play.";
    const parts = [];
    if (missingNames) parts.push(`${missingNames} team name${missingNames > 1 ? "s" : ""}`);
    if (missingPlayers) parts.push(`${missingPlayers} player${missingPlayers > 1 ? "s" : ""}`);
    return `Add ${parts.join(" and ")} to start the match.`;
  }

  function isReady() {
    return state.home.name.trim() && state.away.name.trim() &&
      [...state.home.players, ...state.away.players].every((player) => player.name.trim());
  }

  function selectPlayer(name, custom = false) {
    const slot = [...state.home.players, ...state.away.players].find((player) => player.slotId === state.activeField);
    if (!slot) return;
    const team = teamBySide(slot.slotId.startsWith("home") ? "home" : "away");
    if (team.players.some((player) => player.slotId !== slot.slotId && normalize(player.name) === normalize(name))) {
      toast(`${name} is already in this squad.`);
      return;
    }
    const known = custom ? null : findPlayer(name);
    slot.name = known?.name || name.trim();
    slot.rating = known?.rating || 65;
    slot.attributes = known?.attributes || ["determination", "teamwork"];
    slot.known = Boolean(known);
    state.activeField = null;
    state.query = "";
    saveState();
    renderBuilder(false);
  }

  function updatePlayerDraft(slotId, value) {
    const slot = [...state.home.players, ...state.away.players].find((player) => player.slotId === slotId);
    if (!slot) return;
    const cleanName = value.trim();
    const known = findPlayer(cleanName);
    slot.name = cleanName;
    slot.rating = cleanName ? known?.rating || 65 : null;
    slot.attributes = cleanName ? known?.attributes || ["determination", "teamwork"] : [];
    slot.known = Boolean(known);
    saveState();
  }

  function randomiseTeam(side) {
    const team = teamBySide(side);
    const used = new Set();
    team.players.forEach((slot) => {
      const pool = PLAYERS.filter((player) => player.positions.includes(slot.position) && !used.has(player.name));
      const pick = pool[Math.floor(Math.random() * pool.length)];
      used.add(pick.name);
      Object.assign(slot, { name: pick.name, rating: pick.rating, attributes: pick.attributes, known: true });
    });
    if (!team.name.trim()) {
      const first = ["Banger", "Ballerz", "Touchline", "Top Bin", "Five Star", "Nutmeg", "Sunday"];
      const second = ["United", "FC", "Athletic", "Rovers", "City", "Collective"];
      team.name = `${first[Math.floor(Math.random() * first.length)]} ${second[Math.floor(Math.random() * second.length)]}`;
    }
    saveState();
    renderBuilder(false);
  }

  function clearTeam(side) {
    const team = teamBySide(side);
    const replacement = emptyTeam(side);
    team.name = "";
    team.players = replacement.players;
    saveState();
    renderBuilder(false);
  }

  function focusPlayerSlot(slotId) {
    const slot = [...state.home.players, ...state.away.players].find((player) => player.slotId === slotId);
    if (!slot) return;
    state.activeField = slotId;
    state.query = slot.name || "";
    renderBuilder(false);
  }

  function closePlayerSearch() {
    if (!state.activeField) return;
    state.activeField = null;
    state.query = "";
    document.querySelector(".suggestions")?.remove();
    document.querySelector(".player-input-wrap.is-active")?.classList.remove("is-active");
    document.querySelector(".pitch-player.is-active")?.classList.remove("is-active");
  }

  function seeded(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function weightedPick(items, weight, rand) {
    const total = items.reduce((sum, item) => sum + Math.max(1, weight(item)), 0);
    let cursor = rand() * total;
    for (const item of items) {
      cursor -= Math.max(1, weight(item));
      if (cursor <= 0) return item;
    }
    return items[items.length - 1];
  }

  function teamStrength(team) {
    const base = team.players.reduce((sum, player) => sum + player.rating, 0) / 5;
    const balance = Math.min(...POSITIONS.map((position) =>
      team.players.filter((player) => player.position === position).length || 1
    ));
    return base + balance;
  }

  function chanceTeam(home, away, rand) {
    const homeWeight = teamStrength(home) + 2.2;
    const awayWeight = teamStrength(away);
    return rand() < homeWeight / (homeWeight + awayWeight) ? home : away;
  }

  function attackingPlayer(team, rand) {
    return weightedPick(team.players, (player) =>
      player.position === "GK" ? 2 :
        player.rating + (player.position === "ST" ? 28 : player.position === "MID" ? 16 : 3), rand);
  }

  function assistingPlayer(team, scorer, rand) {
    const outfield = team.players.filter((player) => player.slotId !== scorer.slotId && player.position !== "GK");
    return weightedPick(outfield.length ? outfield : team.players.filter((player) => player.slotId !== scorer.slotId), (player) =>
      player.rating + (player.position === "MID" ? 22 : player.position === "DEF" ? 8 : 0), rand);
  }

  function goalkeeper(team) {
    return team.players.find((player) => player.position === "GK") || team.players[4];
  }

  function commentaryReadingTime(event) {
    const wordCount = `${event.heading} ${event.text}`.trim().split(/\s+/).filter(Boolean).length;
    const readingMs = (wordCount / COMMENTARY_WORDS_PER_MINUTE) * 60000;
    return Math.max(COMMENTARY_MIN_MS, Math.min(COMMENTARY_MAX_MS, readingMs + 1500));
  }

  function scheduleCommentaryEvents(events) {
    const halftimeIndex = events.findIndex((event) => event.type === "halftime");
    const fulltimeIndex = events.findIndex((event) => event.type === "fulltime");
    const firstHalf = events.slice(0, halftimeIndex);
    const secondHalf = events.slice(halftimeIndex + 1, fulltimeIndex);

    const scheduleHalf = (items, startMs, endMs) => {
      if (!items.length) return;
      const durations = items.map(commentaryReadingTime);
      const total = durations.reduce((sum, duration) => sum + duration, 0);
      const scale = total ? (endMs - startMs) / total : 0;
      let cursor = startMs;
      items.forEach((event, index) => {
        event.atMs = Math.round(cursor);
        event.readingMs = durations[index];
        event.displayMs = Math.round(durations[index] * scale);
        const secondHalf = startMs >= MATCH_DURATION_MS / 2;
        const halfProgress = (event.atMs - startMs) / (endMs - startMs);
        event.displayMinute = secondHalf
          ? Math.min(29, Math.max(16, Math.round(15 + halfProgress * 15)))
          : Math.min(14, Math.max(0, Math.round(halfProgress * 15)));
        cursor += event.displayMs;
      });
    };

    scheduleHalf(firstHalf, 0, 71500);
    if (halftimeIndex >= 0) {
      events[halftimeIndex].atMs = 75000;
      events[halftimeIndex].displayMs = 5000;
      events[halftimeIndex].displayMinute = 15;
    }
    scheduleHalf(secondHalf, 79500, 146500);
    if (fulltimeIndex >= 0) {
      events[fulltimeIndex].atMs = MATCH_DURATION_MS;
      events[fulltimeIndex].displayMs = 0;
      events[fulltimeIndex].displayMinute = 30;
    }
  }

  function generateMatch() {
    const snapshot = JSON.stringify([state.home, state.away, Date.now()]);
    const seed = hash(snapshot);
    const rand = seeded(seed);
    const events = [];
    const contributions = {};
    const score = { home: 0, away: 0 };
    const key = (side, slotId) => `${side}:${slotId}`;
    const addContribution = (side, player, type) => {
      const id = key(side, player.slotId);
      contributions[id] ||= { goals: 0, assists: 0, saves: 0 };
      contributions[id][type] += 1;
    };
    const createEvent = (minute, type, team, player, other, goal = false) => {
      const opponent = team.side === "home" ? state.away : state.home;
      const attribute = player.attributes[Math.floor(rand() * player.attributes.length)] || "quality";
      const templates = {
        kickoff: `The whistle goes. ${state.home.name} get this five-a-side contest moving against ${state.away.name}.`,
        chance: `${player.name} uses that ${attribute} to make half a yard, but the finish whistles just past the post.`,
        save: `${player.name} lets fly after a sharp exchange with ${other.name}, but ${goalkeeper(opponent).name} reacts brilliantly to keep it out.`,
        block: `${player.name} drives into space. ${other.name} reads it early and throws in a vital block.`,
        skill: `${player.name} brings the crowd alive with a flash of ${attribute}, gliding away from the first challenge.`,
        goal: `${other.name} spots the run and slides a perfectly weighted pass into ${player.name}, whose ${attribute} does the rest. ${team.name} have their goal!`,
        soloGoal: `${player.name} takes responsibility, powers through with ${attribute}, and buries the finish. A sensational solo goal for ${team.name}!`,
        halftime: `Half-time. Both sides take a breath after a frantic opening 15 minutes.`,
        fulltime: `Full-time. The whistle ends a breathless five-a-side contest.`
      };
      const heading = type === "goal" || type === "soloGoal" ? "Goal!" :
        type === "save" ? "What a save!" : type === "halftime" ? "Half-time" :
        type === "fulltime" ? "Full-time" : type === "kickoff" ? "Kick-off" :
        type === "skill" ? "Silky stuff" : type === "block" ? "Big block" : "So close!";
      events.push({
        minute,
        displayMinute: Math.max(0, Math.ceil(minute)),
        atMs: Math.round((minute / 30) * MATCH_DURATION_MS), type, heading,
        side: team?.side || "neutral", text: templates[type], score: { ...score }, goal
      });
    };

    createEvent(0, "kickoff", state.home, state.home.players[0], state.home.players[1]);
    const goalExpectation = Math.max(2, Math.min(7,
      Math.round(2.2 + (teamStrength(state.home) + teamStrength(state.away) - 150) / 22 + rand() * 2)
    ));
    const goalMinutes = new Set();
    while (goalMinutes.size < goalExpectation) goalMinutes.add(3 + Math.floor(rand() * 25));
    const eventMinutes = new Set([
      ...goalMinutes,
      1.5, 3.5, 5.5, 7.5, 9.5, 11.5, 13.5, 15,
      16.5, 18.5, 20.5, 22.5, 24.5, 26.5, 28.5, 30
    ]);
    [...eventMinutes].sort((a, b) => a - b).forEach((minute) => {
      if (minute === 15) {
        createEvent(15, "halftime", state.home, state.home.players[0], state.away.players[0]);
        return;
      }
      if (minute === 30) {
        createEvent(30, "fulltime", state.home, state.home.players[0], state.away.players[0]);
        return;
      }
      const team = chanceTeam(state.home, state.away, rand);
      const opponent = team.side === "home" ? state.away : state.home;
      const attacker = attackingPlayer(team, rand);
      const assister = assistingPlayer(team, attacker, rand);
      if (goalMinutes.has(minute)) {
        const solo = rand() < .26;
        score[team.side] += 1;
        addContribution(team.side, attacker, "goals");
        if (!solo) addContribution(team.side, assister, "assists");
        createEvent(minute, solo ? "soloGoal" : "goal", team, attacker, assister, true);
      } else {
        const roll = rand();
        if (roll < .34) {
          addContribution(opponent.side, goalkeeper(opponent), "saves");
          createEvent(minute, "save", team, attacker, assister);
        } else if (roll < .58) {
          createEvent(minute, "chance", team, attacker, assister);
        } else if (roll < .78) {
          createEvent(minute, "skill", team, attacker, assister);
        } else {
          createEvent(minute, "block", team, attacker, weightedPick(opponent.players, (p) => p.position === "DEF" ? 130 : p.rating, rand));
        }
      }
    });

    events.sort((a, b) => a.minute - b.minute);
    scheduleCommentaryEvents(events);
    events.forEach((event) => {
      if (event.type === "fulltime") event.score = { ...score };
    });
    const winner = score.home === score.away ? null : score.home > score.away ? state.home : state.away;
    const loser = winner ? (winner.side === "home" ? state.away : state.home) : null;
    const allScorers = Object.entries(contributions)
      .filter(([, item]) => item.goals)
      .map(([id, item]) => {
        const [side, slotId] = id.split(":");
        const player = teamBySide(side).players.find((p) => p.slotId === slotId);
        return { player, side, ...item };
      })
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists);
    const top = allScorers[0];
    const headline = winner
      ? score[winner.side] - score[loser.side] >= 3 ? `${winner.name} run riot!` : `${winner.name} edge a five-a-side thriller!`
      : `${state.home.name} and ${state.away.name} can’t be separated!`;
    const description = winner
      ? `${winner.name} claimed a ${score.home}–${score.away} win in a game packed with quick combinations and brave goalkeeping.${top ? ` ${top.player.name} led the scoring with ${top.goals} goal${top.goals > 1 ? "s" : ""}.` : ""} ${loser.name} kept pushing until the final whistle, but the decisive moments belonged to ${winner.name}.`
      : `A breathless ${score.home}–${score.away} draw delivered chances at both ends and no shortage of drama.${top ? ` ${top.player.name} was central to the action with ${top.goals} goal${top.goals > 1 ? "s" : ""}.` : ""} Neither side could find the winner before the final whistle.`;

    return { seed, events, contributions, finalScore: score, headline, description };
  }

  function startMatch() {
    if (!isReady()) return;
    state.match = generateMatch();
    state.elapsedMs = 0;
    state.paused = false;
    state.matchEntered = false;
    state.loadingStep = 0;
    state.screen = "loading";
    render();
  }

  function renderLoading() {
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen loading-screen screen--enter" aria-labelledby="loading-title">
          <div class="loading-inner">
            <h1 class="brand brand--small">Squad Up</h1>
            <div class="loading-fixture" aria-label="${escapeHtml(state.home.name)} versus ${escapeHtml(state.away.name)}">
              <span>${escapeHtml(state.home.name)}</span>
              <strong>VS</strong>
              <span>${escapeHtml(state.away.name)}</span>
            </div>
            <div class="loading-ball" aria-hidden="true">⚽</div>
            <p class="loading-line" id="loading-title" aria-live="polite">${escapeHtml(LOADING_LINES[state.loadingStep])}</p>
            <div class="loading-dots" aria-hidden="true">
              ${LOADING_LINES.map((_, index) => `<span class="${index <= state.loadingStep ? "is-on" : ""}"></span>`).join("")}
            </div>
          </div>
        </section>
      </main>`;
    runLoadingSequence();
  }

  function runLoadingSequence() {
    if (state.loadingTick) clearInterval(state.loadingTick);
    state.loadingTick = setInterval(() => {
      state.loadingStep += 1;
      if (state.loadingStep >= LOADING_LINES.length) {
        clearInterval(state.loadingTick);
        state.loadingTick = null;
        state.elapsedMs = 0;
        state.startedAt = Date.now();
        state.screen = "match";
        render();
        return;
      }
      const line = document.querySelector(".loading-line");
      if (line) {
        line.classList.remove("is-changing");
        void line.offsetWidth;
        line.textContent = LOADING_LINES[state.loadingStep];
        line.classList.add("is-changing");
      }
      document.querySelectorAll(".loading-dots span").forEach((dot, index) => {
        dot.classList.toggle("is-on", index <= state.loadingStep);
      });
    }, LOADING_BEAT_MS);
  }

  function currentEvents() {
    return state.match.events.filter((event) => event.atMs <= state.elapsedMs);
  }

  function currentScore() {
    const goals = currentEvents().filter((event) => event.goal);
    return goals.reduce((score, event) => {
      score[event.side] += 1;
      return score;
    }, { home: 0, away: 0 });
  }

  function renderScoreBug(score, compact = false, showClock = false, statusText = "") {
    if (showClock) {
      const status = scoreBugStatus();
      return `
        <div class="live-score-stack">
          <div class="score-bug score-bug--live">
            <div class="score-team home">
              <p class="score-label">Home</p>
              <p class="score-name">${escapeHtml(state.home.name)}</p>
            </div>
            <div class="score-centre">
              <div class="scoreline">
                <span class="score-num" data-score-side="home">${score.home}</span>
                <span>–</span>
                <span class="score-num" data-score-side="away">${score.away}</span>
              </div>
            </div>
            <div class="score-team away">
              <p class="score-label">Away</p>
              <p class="score-name">${escapeHtml(state.away.name)}</p>
            </div>
          </div>
          <div class="score-status ${status.kind === "paused" ? "score-status--paused" : ""}">
            <time class="score-status-text" aria-label="Match status">${escapeHtml(status.text)}</time>
          </div>
        </div>`;
    }
    const scoreMarkup = `
      <div class="score-bug score-bug--final ${compact ? "compact" : ""}">
          <div class="score-team home">
            <p class="score-label">Home</p><p class="score-name">${escapeHtml(state.home.name)}</p>
          </div>
          <div class="score-centre">
            <div class="scoreline"><span class="score-num">${score.home}</span><span>–</span><span class="score-num">${score.away}</span></div>
          </div>
          <div class="score-team away">
            <p class="score-label">Away</p><p class="score-name">${escapeHtml(state.away.name)}</p>
          </div>
        </div>`;
    if (!statusText) return scoreMarkup;
    return `
      <div class="final-score-stack">
        ${scoreMarkup}
        <div class="score-status">
          <span class="score-status-text">${escapeHtml(statusText)}</span>
        </div>
      </div>`;
  }

  function renderMatch() {
    const events = currentEvents();
    const featured = events[events.length - 1] || state.match.events[0];
    const score = currentScore();
    const animate = !state.matchEntered;
    state.matchEntered = true;
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen ${animate ? "screen--enter" : ""} match-screen" aria-labelledby="match-title">
          <h1 class="brand brand--small" id="match-title">Squad Up</h1>
          ${renderScoreBug(score, false, true)}
          <div class="match-controls">
            <button class="icon-button" data-action="pause">${state.paused ? "Play" : "Pause"}</button>
            <button class="icon-button" data-action="skip" aria-label="Skip to full-time">Skip</button>
          </div>
          <div class="commentary-stage" aria-live="polite">
            ${eventCard(featured, true)}
            <div class="commentary-history">
              ${events.slice(0, -1).reverse().slice(0, 4).map((event) => eventCard(event, false)).join("")}
            </div>
          </div>
        </section>
      </main>`;
    if (!state.paused) runClock();
  }

  function eventCard(event, featured) {
    const sideClass = event.goal ? `event-card--${event.side}` : "event-card--neutral";
    return `
      <article
        class="${featured ? "featured-event" : "history-card"} ${sideClass}"
        data-event="${event.minute}-${event.type}"
        data-dwell-ms="${event.displayMs || 0}"
        data-reading-ms="${event.readingMs || 0}"
      >
        <h2 class="${featured ? "event-heading" : "history-title"}">${event.displayMinute}’ ${escapeHtml(event.heading)}</h2>
        <p class="${featured ? "event-copy" : "history-copy"}">${escapeHtml(event.text)}</p>
      </article>`;
  }

  function formatMatchClock(elapsed) {
    const halfDuration = MATCH_DURATION_MS / 2;
    const stoppageWindow = 5000;
    const regulationWindow = halfDuration - stoppageWindow;
    const inSecondHalf = elapsed >= halfDuration;
    const halfElapsed = inSecondHalf ? elapsed - halfDuration : elapsed;
    const baseSeconds = inSecondHalf ? 15 * 60 : 0;
    if (halfElapsed < regulationWindow) {
      const matchSeconds = baseSeconds + Math.floor((halfElapsed / regulationWindow) * 15 * 60);
      const minutes = Math.floor(matchSeconds / 60);
      const seconds = matchSeconds % 60;
      return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    const regulationMinute = inSecondHalf ? 30 : 15;
    const addedSeconds = Math.min(59, Math.floor(((halfElapsed - regulationWindow) / stoppageWindow) * 60));
    return `${regulationMinute}:00 +0:${String(addedSeconds).padStart(2, "0")}`;
  }

  function scoreBugStatus() {
    if (state.paused) return { kind: "paused", text: "Paused" };
    const halfDuration = MATCH_DURATION_MS / 2;
    if (state.elapsedMs >= halfDuration && state.elapsedMs < halfDuration + 1800) {
      return { kind: "half-time", text: "Half Time" };
    }
    return { kind: "live", text: formatMatchClock(state.elapsedMs) };
  }

  function updateScoreStatus() {
    const status = scoreBugStatus();
    const statusText = document.querySelector(".score-status-text");
    const statusTab = document.querySelector(".score-status");
    if (statusText) statusText.textContent = status.text;
    if (statusTab) statusTab.classList.toggle("score-status--paused", status.kind === "paused");
  }

  function runClock() {
    clearTimers();
    state.startedAt = Date.now() - state.elapsedMs;
    state.tick = setInterval(() => {
      const previousEventCount = currentEvents().length;
      state.elapsedMs = Math.min(MATCH_DURATION_MS, Date.now() - state.startedAt);
      const nextEventCount = currentEvents().length;
      if (state.elapsedMs >= MATCH_DURATION_MS) {
        finishMatch();
      } else if (nextEventCount !== previousEventCount) {
        renderMatch();
      } else {
        updateScoreStatus();
      }
    }, 100);
  }

  function clearTimers() {
    if (state.tick) clearInterval(state.tick);
    if (state.timer) clearTimeout(state.timer);
    if (state.loadingTick) clearInterval(state.loadingTick);
    if (state.transitionTick) clearInterval(state.transitionTick);
    state.tick = null;
    state.timer = null;
    state.loadingTick = null;
    state.transitionTick = null;
  }

  function togglePause() {
    if (state.paused) {
      state.paused = false;
      state.startedAt = Date.now() - state.elapsedMs;
      renderMatch();
    } else {
      state.elapsedMs = Math.min(MATCH_DURATION_MS, Date.now() - state.startedAt);
      state.paused = true;
      clearTimers();
      renderMatch();
    }
  }

  function finishMatch() {
    clearTimers();
    state.elapsedMs = MATCH_DURATION_MS;
    state.screen = "result-reveal";
    render();
  }

  function skipMatch() {
    clearTimers();
    state.screen = "fast-forward";
    render();
  }

  function renderFastForward() {
    const score = currentScore();
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen fast-forward-screen" aria-labelledby="fast-forward-title">
          <div class="fast-forward-match">
            ${renderScoreBug(score, false, true)}
            <div class="fast-forward-track"><span></span></div>
            <div class="fast-forward-ghosts" aria-hidden="true">
              ${[1,2,3,4,5].map(() => "<i>»</i>").join("")}
            </div>
            <h1 id="fast-forward-title">Racing to full-time</h1>
            <p>Compressing the drama. Keeping the goals.</p>
          </div>
        </section>
      </main>`;
    runFastForward();
  }

  function runFastForward() {
    const duration = 2200;
    const initialElapsed = state.elapsedMs;
    const started = Date.now();
    state.transitionTick = setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      state.elapsedMs = initialElapsed + (MATCH_DURATION_MS - initialElapsed) * eased;
      const score = currentScore();
      const homeScore = document.querySelector('[data-score-side="home"]');
      const awayScore = document.querySelector('[data-score-side="away"]');
      const track = document.querySelector(".fast-forward-track span");
      updateScoreStatus();
      if (homeScore) homeScore.textContent = score.home;
      if (awayScore) awayScore.textContent = score.away;
      if (track) track.style.width = `${progress * 100}%`;
      if (progress >= 1) {
        clearInterval(state.transitionTick);
        state.transitionTick = null;
        state.elapsedMs = MATCH_DURATION_MS;
        state.screen = "result-reveal";
        render();
      }
    }, 50);
  }

  function revealResult() {
    const score = state.match.finalScore;
    if (score.home === score.away) {
      return { title: "Honours Even!" };
    }
    const winner = score.home > score.away ? state.home : state.away;
    return { title: `${winner.name} Win!` };
  }

  function renderResultReveal() {
    const result = revealResult();
    const score = state.match.finalScore;
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen result-reveal-screen screen--enter" aria-labelledby="result-reveal-title">
          <div class="result-reveal-inner">
            <div class="winner-score-bug">${renderScoreBug(score, true)}</div>
            <h1 id="result-reveal-title">${escapeHtml(result.title)}</h1>
          </div>
        </section>
      </main>`;
    state.timer = setTimeout(() => {
      state.timer = null;
      state.screen = "summary";
      render();
    }, WINNER_REVEAL_MS);
  }

  function contributionsFor(side, player) {
    return state.match.contributions[`${side}:${player.slotId}`] || { goals: 0, assists: 0, saves: 0 };
  }

  function lineupMarkup(team) {
    return `
      <div class="lineup ${team.side}">
        ${team.players.map((player) => {
          const item = contributionsFor(team.side, player);
          return `
            <div class="lineup-player">
              <span class="lineup-position">${player.position}</span>
              <span class="lineup-name">${escapeHtml(player.name)}</span>
              <span class="contributions" aria-label="${item.goals} goals, ${item.assists} assists, ${item.saves} saves">${"⚽".repeat(item.goals)}${"🎯".repeat(item.assists)}${item.saves ? ` 🧤${item.saves}` : ""}</span>
            </div>`;
        }).join("")}
      </div>`;
  }

  function renderSummary() {
    const score = state.match.finalScore;
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen screen--enter summary-screen" aria-labelledby="summary-title">
          <h1 class="brand brand--small">Squad Up</h1>
          <div class="summary-wrap">
            <h2 class="summary-headline" id="summary-title">${escapeHtml(state.match.headline)}</h2>
            <p class="summary-copy">${escapeHtml(state.match.description)}</p>
            <div class="summary-card">
              ${renderScoreBug(score, true, false, "Full Time")}
              <div class="lineups">${lineupMarkup(state.home)}${lineupMarkup(state.away)}</div>
            </div>
            <div class="summary-actions">
              <button class="button" data-action="share">Share Match Results</button>
              <button class="button button--ghost" data-action="play-again">Play Again</button>
            </div>
          </div>
        </section>
      </main>`;
  }

  function buildShareImage() {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 900;
    const ctx = canvas.getContext("2d");
    const score = state.match.finalScore;
    ctx.fillStyle = "#111fa3";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createRadialGradient(0, 900, 0, 0, 900, 850);
    gradient.addColorStop(0, "rgba(241,199,47,.22)");
    gradient.addColorStop(1, "rgba(241,199,47,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ececf8";
    ctx.font = "92px Anton, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("SQUAD UP", 600, 106);
    ctx.font = "700 30px Inter, Arial";
    wrapCanvasText(ctx, state.match.headline, 600, 150, 960, 38);
    roundedRect(ctx, 145, 205, 910, 120, 20, "#ececf8");
    ctx.fillStyle = "#db1b13";
    ctx.font = "800 16px Inter, Arial";
    ctx.textAlign = "left";
    ctx.fillText("HOME", 185, 244);
    ctx.fillStyle = "#111fa3";
    ctx.font = "800 25px Inter, Arial";
    fitCanvasText(ctx, state.home.name, 185, 282, 285, 25);
    ctx.fillStyle = "#b68b00";
    ctx.font = "800 16px Inter, Arial";
    ctx.textAlign = "right";
    ctx.fillText("AWAY", 1015, 244);
    ctx.fillStyle = "#111fa3";
    ctx.font = "800 25px Inter, Arial";
    fitCanvasText(ctx, state.away.name, 1015, 282, 285, 25, "right");
    ctx.textAlign = "center";
    ctx.font = "800 64px Inter, Arial";
    ctx.fillText(`${score.home} – ${score.away}`, 600, 287);

    drawShareLineup(ctx, state.home, 145, 365, 430);
    drawShareLineup(ctx, state.away, 625, 365, 430);

    ctx.fillStyle = "rgba(236,236,248,.78)";
    ctx.font = "500 18px Inter, Arial";
    ctx.textAlign = "center";
    wrapCanvasText(ctx, state.match.description, 600, 745, 900, 27, 3);
    ctx.fillStyle = "#f1c72f";
    ctx.font = "800 18px Inter, Arial";
    ctx.textAlign = "center";
    ctx.fillText("THINK YOUR FIVE CAN BEAT THIS? BUILD YOURS ON SQUAD UP.", 600, 855);
    return canvas.toDataURL("image/png");
  }

  function drawShareLineup(ctx, team, x, y, width) {
    team.players.forEach((player, index) => {
      const item = contributionsFor(team.side, player);
      const rowY = y + index * 62;
      roundedRect(ctx, x, rowY, width, 48, 24, "rgba(236,236,248,.09)");
      ctx.textAlign = "left";
      ctx.fillStyle = team.side === "home" ? "#f08a86" : "#f1c72f";
      ctx.font = "800 13px Inter, Arial";
      ctx.fillText(player.position, x + 18, rowY + 30);
      ctx.fillStyle = "#ececf8";
      ctx.font = "600 17px Inter, Arial";
      fitCanvasText(ctx, player.name, x + 64, rowY + 31, width - 155, 17);
      const marks = `${"⚽".repeat(item.goals)}${"🎯".repeat(item.assists)}${item.saves ? `🧤${item.saves > 1 ? item.saves : ""}` : ""}`;
      ctx.textAlign = "right";
      ctx.fillStyle = "#ececf8";
      ctx.font = "16px Inter, Arial";
      ctx.fillText(marks, x + width - 18, rowY + 30);
    });
  }

  function fitCanvasText(ctx, text, x, y, maxWidth, startSize, align = "left") {
    let size = startSize;
    ctx.textAlign = align;
    while (size > 12 && ctx.measureText(text).width > maxWidth) {
      size -= 1;
      ctx.font = ctx.font.replace(/\d+px/, `${size}px`);
    }
    ctx.fillText(text, x, y);
  }

  function roundedRect(ctx, x, y, width, height, radius, fill) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
    const words = text.split(" ");
    const lines = [];
    let line = "";
    words.forEach((word) => {
      const test = `${line}${word} `;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line.trim());
        line = `${word} `;
      } else line = test;
    });
    if (line && lines.length < maxLines) lines.push(line.trim());
    lines.slice(0, maxLines).forEach((item, index) => ctx.fillText(item, x, y + index * lineHeight));
  }

  function openShareModal() {
    state.shareImage = buildShareImage();
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.dataset.modal = "share";
    modal.innerHTML = `
      <section class="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div class="modal-top">
          <h2 class="modal-title" id="share-title">Share the result</h2>
          <button class="close-button" data-action="close-share" aria-label="Close share dialog">×</button>
        </div>
        <img class="share-preview" src="${state.shareImage}" alt="Share card showing ${escapeHtml(state.home.name)} ${state.match.finalScore.home}, ${escapeHtml(state.away.name)} ${state.match.finalScore.away}" />
        <div class="share-actions">
          <button class="button" data-action="native-share">Share result</button>
          <button class="button button--ghost" data-action="download-share">Download</button>
          <button class="button button--ghost" data-action="copy-result">Copy caption</button>
        </div>
        <p class="share-note">“Share result” sends the match card and a ready-made challenge caption through your standard share sheet.</p>
      </section>`;
    document.body.appendChild(modal);
    modal.querySelector(".close-button").focus();
  }

  function resultCaption() {
    return `${state.home.name} ${state.match.finalScore.home}–${state.match.finalScore.away} ${state.away.name}\n\n${state.match.headline}\n\nThink your five can beat this? Build your squad, run the match and share the result on Squad Up. #SquadUp #FiveASide`;
  }

  async function nativeShare() {
    const blob = await (await fetch(state.shareImage)).blob();
    const file = new File([blob], "squad-up-result.png", { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ title: "Squad Up result", text: resultCaption(), files: [file] }); } catch {}
    } else {
      downloadShare();
      toast("Sharing isn’t supported here, so the image was downloaded.");
    }
  }

  function downloadShare() {
    const link = document.createElement("a");
    link.href = state.shareImage;
    link.download = "squad-up-result.png";
    link.click();
  }

  function closeShare() {
    document.querySelector('[data-modal="share"]')?.remove();
  }

  function bindGlobalEvents() {
    app.onclick = (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      if (action === "new-game") { state.screen = "builder"; renderBuilder(true); bindGlobalEvents(); }
      if (action === "home") { state.screen = "home"; render(); }
      if (action === "randomise") randomiseTeam(target.dataset.side);
      if (action === "clear-team") clearTeam(target.dataset.side);
      if (action === "focus-slot") focusPlayerSlot(target.dataset.slot);
      if (action === "select-player") selectPlayer(target.dataset.name);
      if (action === "select-custom") selectPlayer(state.query, true);
      if (action === "start-match") startMatch();
      if (action === "pause") togglePause();
      if (action === "skip") skipMatch();
      if (action === "share") openShareModal();
      if (action === "play-again") { state.match = null; state.screen = "builder"; renderBuilder(true); bindGlobalEvents(); }
    };

    app.oninput = (event) => {
      if (event.target.matches("[data-team-name]")) {
        teamBySide(event.target.dataset.teamName).name = event.target.value;
        saveState();
        const button = document.querySelector('[data-action="start-match"]');
        if (button) button.disabled = !isReady();
        const status = document.querySelector(".builder-status");
        if (status) status.textContent = builderStatus();
      }
      if (event.target.matches("[data-slot]")) {
        state.activeField = event.target.dataset.slot;
        state.query = event.target.value;
        updatePlayerDraft(state.activeField, state.query);
        renderBuilder(false);
      }
    };

    app.onfocusin = (event) => {
      if (event.target.matches("[data-slot]")) {
        if (state.activeField === event.target.dataset.slot) return;
        const slot = [...state.home.players, ...state.away.players].find((player) => player.slotId === event.target.dataset.slot);
        state.activeField = event.target.dataset.slot;
        state.query = slot?.name || "";
        renderBuilder(false);
      }
    };

    app.onkeydown = (event) => {
      if (event.key === "Escape" && state.activeField) {
        state.activeField = null;
        state.query = "";
        renderBuilder(false);
      }
      if (event.key === "Enter" && event.target.matches("[data-slot]") && state.query.trim()) {
        const exact = findPlayer(state.query);
        selectPlayer(exact?.name || state.query, !exact);
      }
    };

    document.onclick = async (event) => {
      const actionTarget = event.target.closest("[data-action]");
      if (
        state.screen === "builder" &&
        state.activeField &&
        !event.target.closest(".player-field") &&
        !event.target.closest('[data-action="focus-slot"]')
      ) {
        closePlayerSearch();
      }
      if (actionTarget?.dataset.action === "close-share" || event.target.matches(".modal-backdrop")) closeShare();
      if (actionTarget?.dataset.action === "download-share") downloadShare();
      if (actionTarget?.dataset.action === "native-share") nativeShare();
      if (actionTarget?.dataset.action === "copy-result") {
        try { await navigator.clipboard.writeText(resultCaption()); toast("Result caption copied."); } catch { toast(resultCaption()); }
      }
    };
  }

  restoreState();
  render();
})();
