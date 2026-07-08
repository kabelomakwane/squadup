(() => {
  "use strict";

  const PLAYERS = window.SQUAD_UP_PLAYERS || [];
  const POSITIONS = ["ST", "MID", "MID", "DEF", "GK"];
  const STORAGE_KEY = "squad-up-state-v1";
  const AGE_KEY = "squad-up-age-ok-v1";
  const MATCH_DURATION_MS = 150000;
  const LOADING_BEAT_MS = 1800;
  const WINNER_REVEAL_MS = 5200;
  const COMMENTARY_MIN_MS = 4800;
  const COMMENTARY_MAX_MS = 10500;
  const COMMENTARY_WORDS_PER_MINUTE = 150;
  const LOADING_LINES = [
    "Loading screen text talking about the game.",
    "Players preparing, fans are getting excited.",
    "Commentators are getting ready.",
    "Kick off time is coming.",
    "Buses arriving. Someone forgot the bibs."
  ];
  const BACKGROUND_LINES = ["FIVE-A-SIDE ONE V ONE FOOTBALL COMPETE", "THIRTY MINUTES ONE WINNER GAME TIME", "FOOTBALL COMPETE FIVE A SIDE ONE V ONE"];
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
    screen: "age-check",
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
    try {
      if (localStorage.getItem(AGE_KEY) === "yes") state.screen = "landing";
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

  function logoMark(size = "") {
    return `<img class="brand-logo ${size}" src="assets/logo.svg" alt="SuperSportBET Squad Up" />`;
  }

  function backgroundText() {
    return `
      <div class="bg-text bg-text--top" aria-hidden="true">${BACKGROUND_LINES.map((line) => `<span>${line}</span>`).join("")}</div>
      <div class="bg-text bg-text--bottom" aria-hidden="true">${BACKGROUND_LINES.map((line) => `<span>${line}</span>`).join("")}</div>`;
  }

  function betResponsibly() {
    return `
      <div class="bet-responsibly">
        <p class="bet-responsibly-logo"><span class="s-mark">S</span>BET RESPONSIBLY</p>
        <p class="bet-responsibly-copy">SuperSportBet is licenced by the Western Cape Gambling and Racing Board. Bookmaker licence: 10191097. No persons under the age of 18 are permitted to gamble. Winners know when to stop. National Responsible Gambling Programme toll free counselling line 0800 006 008 or WHATSAPP HELP 076 675 0710. T&amp;C's Apply.</p>
      </div>`;
  }

  function render() {
    clearTimers();
    if (state.screen === "age-check") renderAgeCheck();
    if (state.screen === "not-18") renderNot18();
    if (state.screen === "landing") renderLanding();
    if (state.screen === "how-to-play") renderHowToPlay();
    if (state.screen === "builder") renderBuilder();
    if (state.screen === "sign-in") renderSignIn();
    if (state.screen === "loading") renderLoading();
    if (state.screen === "match") renderMatch();
    if (state.screen === "fast-forward") renderFastForward();
    if (state.screen === "result-reveal") renderResultReveal();
    if (state.screen === "summary") renderSummary();
    bindGlobalEvents();
  }

  function confirmAge(isOver18) {
    try { localStorage.setItem(AGE_KEY, isOver18 ? "yes" : "no"); } catch {}
    state.screen = isOver18 ? "landing" : "not-18";
    render();
  }

  function renderAgeCheck() {
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen screen--enter age-screen" aria-labelledby="age-title">
          <div class="age-inner">
            <h1 class="headline headline--primary" id="age-title">Confirm you are 18 or over</h1>
            <p class="age-copy">Squad Up is a online game by SuperSport Bet. In order to play, we need to confirm whether you are over the age of 18. Include any other information related to ages and sports betting that would relate to this section here.</p>
            <div class="age-actions">
              <button class="button" data-action="age-yes">Yes</button>
              <button class="button" data-action="age-no">No</button>
            </div>
          </div>
          ${betResponsibly()}
        </section>
      </main>`;
  }

  function renderNot18() {
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen screen--enter age-screen" aria-labelledby="not18-title">
          <div class="age-inner">
            <h1 class="headline headline--primary" id="not18-title">Sorry, you must be 18 or over</h1>
            <p class="age-copy">Squad Up is a SuperSport Bet product and is only available to players aged 18 and over. Come back and build your five-a-side once you're of legal age.</p>
            <div class="age-actions">
              <button class="button button--ghost" data-action="back-to-age">Go Back</button>
            </div>
          </div>
          ${betResponsibly()}
        </section>
      </main>`;
  }

  function renderLanding() {
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen screen--enter landing-screen" aria-labelledby="landing-title">
          ${backgroundText()}
          <div class="landing-inner">
            ${logoMark("logo--hero")}
            <h1 class="sr-only" id="landing-title">Squad Up</h1>
            <p class="landing-copy">Build a five-a-side lineup, choose an opponent, and watch a simulated fixture unfold with live play-by-play drama.</p>
            <div class="landing-actions">
              <button class="button" data-action="how-to-play">How To Play</button>
              <button class="button" data-action="new-game">New Game</button>
            </div>
          </div>
        </section>
      </main>`;
  }

  function renderHowToPlay() {
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen screen--enter howto-screen" aria-labelledby="howto-title">
          <div class="topline">
            <button class="text-button" data-action="home" aria-label="Return to home">← Home</button>
            ${logoMark("logo--small")}
            <span aria-hidden="true" style="width:64px"></span>
          </div>
          <h1 class="headline headline--secondary" id="howto-title">How To Play</h1>
          <div class="howto-body">
            <div class="howto-pitch-wrap">
              ${pitchMarkup(true)}
            </div>
            <ul class="howto-notes">
              <li>Select a team of five players to start. Your players' names will appear on the pitch once you've selected them.</li>
              <li>Once you click play, it will take you to the match commentary page where you can watch the live play-by-play of the match.</li>
              <li>When the match is done, you'll then be taken to the match summary where you can export an image of the result and statistics. Have fun!</li>
            </ul>
          </div>
          <div class="howto-footer">
            <button class="button" data-action="new-game">Let's Play</button>
          </div>
        </section>
      </main>`;
  }

  function renderSignIn() {
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen screen--enter signin-screen" aria-labelledby="signin-title">
          <div class="signin-inner">
            <h1 class="headline headline--primary" id="signin-title"><em class="accent">Wait!</em> Just before<br />we <em class="accent">kick off…</em></h1>
            <p class="signin-copy">We notice that you aren't signed in yet. Signing up allows for you to keep a record of your matches, and you'll get notifications from SuperSport Bet straight to your email.</p>
            <div class="signin-actions">
              <button class="oauth-button" data-action="continue-signin">Continue with Google${oauthIcon("google")}</button>
              <button class="oauth-button" data-action="continue-signin">Continue with Microsoft${oauthIcon("microsoft")}</button>
              <button class="oauth-button" data-action="continue-signin">Continue with Apple${oauthIcon("apple")}</button>
            </div>
            <button class="text-button signin-manual" data-action="continue-signin">Or sign-in manually</button>
          </div>
        </section>
      </main>`;
  }

  function oauthIcon(provider) {
    if (provider === "google") return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81Z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.88-3c-1.08.72-2.46 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.62H1.27a12 12 0 0 0 0 10.76Z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.62l4 3.11C6.22 6.86 8.87 4.75 12 4.75Z"/></svg>`;
    if (provider === "microsoft") return `<svg viewBox="0 0 23 23" width="20" height="20" aria-hidden="true"><rect width="10" height="10" x="1" y="1" fill="#F35325"/><rect width="10" height="10" x="12" y="1" fill="#81BC06"/><rect width="10" height="10" x="1" y="12" fill="#05A6F0"/><rect width="10" height="10" x="12" y="12" fill="#FFBA08"/></svg>`;
    return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="#000"><path d="M16.365 1.43c0 1.14-.468 2.166-1.223 2.918-.83.83-2.13 1.47-3.198 1.386-.136-1.09.44-2.234 1.185-2.965.83-.87 2.267-1.518 3.236-1.34Zm3.585 15.297c-.08.19-.42.926-1.343 1.838-.79.777-1.615 1.554-2.897 1.578-1.257.024-1.66-.744-3.09-.744-1.43 0-1.878.72-3.066.768-1.234.048-2.176-.84-2.976-1.61C4.99 16.887 3.58 13.13 5.415 10.55c.91-1.283 2.53-2.096 4.297-2.12 1.21-.024 2.35.816 3.09.816.74 0 2.128-1.008 3.59-.86.612.024 2.33.246 3.436 1.86-.088.056-2.052 1.2-2.03 3.576.024 2.838 2.49 3.786 2.516 3.798-.02.066-.4 1.35-1.323 2.67-.004.001-.014.011-.04.037Z"/></svg>`;
  }

  function renderBuilder(animate = false) {
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen builder-screen ${animate ? "screen--enter" : ""}" aria-labelledby="builder-title">
          <div class="topline">
            <button class="text-button" data-action="home" aria-label="Return to home">← Home</button>
            ${logoMark("logo--small")}
            <span aria-hidden="true" style="width:64px"></span>
          </div>
          <div class="builder-grid">
            ${teamPanel(state.home)}
            ${pitchMarkup()}
            ${teamPanel(state.away)}
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
        <div class="player-fields">
          ${team.players.map((slot) => playerField(team, slot)).join("")}
        </div>
        <div class="team-actions">
          <button class="button button--ghost button--small" data-action="randomise" data-side="${team.side}">Randomise</button>
          <button class="button button--ghost button--small" data-action="clear-team" data-side="${team.side}">Clear</button>
        </div>
        <p class="team-panel-title">Select Your Team</p>
      </section>`;
  }

  function playerField(team, slot, readOnly = false) {
    const isActive = !readOnly && state.activeField === slot.slotId;
    const suggestions = isActive ? getSuggestions(state.query, slot.position) : [];
    const isExact = findPlayer(state.query);
    return `
      <div class="player-field">
        <div class="player-input-wrap ${isActive ? "is-active" : ""}">
          <span class="position-tag">${slot.position}</span>
          ${readOnly
            ? `<span class="player-input player-input--static">${escapeHtml(slot.name || "Player")}</span>`
            : `<input class="player-input" data-slot="${slot.slotId}" data-side="${team.side}" aria-label="${team.side} ${slot.position} player" autocomplete="off" placeholder="Search a player..." value="${escapeHtml(isActive ? state.query : slot.name)}" />`}
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

  function pitchMarkup(demo = false) {
    const positions = {
      home: [[43,50],[33,32],[33,68],[21,50],[10,50]],
      away: [[57,50],[67,32],[67,68],[79,50],[90,50]]
    };
    const players = demo
      ? ["home", "away"].flatMap((side) => POSITIONS.map((position, index) => ({ position, side, name: "", slotId: `${side}-demo-${index}`, coords: positions[side][index] })))
      : ["home", "away"].flatMap((side) =>
          teamBySide(side).players.map((player, index) => ({ ...player, side, coords: positions[side][index] }))
        );
    return `
      <div class="pitch-wrap">
        <p class="pitch-kicker home">Home</p>
        <p class="pitch-kicker away">Away</p>
        <div class="pitch" aria-label="Five-a-side pitch preview">
          <div class="penalty left"></div><div class="penalty right"></div>
          ${players.map((player) => `
            <button
              class="pitch-player ${player.side} ${player.name ? "is-selected" : "is-empty"} ${state.activeField === player.slotId ? "is-active" : ""}"
              style="left:${player.coords[0]}%;top:${player.coords[1]}%"
              data-action="${demo ? "" : "focus-slot"}"
              data-slot="${player.slotId}"
              ${demo ? "tabindex=\"-1\"" : ""}
              aria-label="${player.name ? `Edit ${escapeHtml(player.name)}` : `Select ${player.side} ${player.position}`}"
            >
              <span class="pitch-dot">${player.position}</span>
              <span class="pitch-label">${escapeHtml(player.name ? lastName(player.name) : "Player")}</span>
            </button>`).join("")}
        </div>
        ${demo ? "" : `
          <button class="button button--wide pitch-play" data-action="start-match" ${isReady() ? "" : "disabled"}>Play</button>
          <p class="builder-status">${builderStatus()}</p>`}
      </div>`;
  }

  function builderStatus() {
    const missingPlayers = [...state.home.players, ...state.away.players].filter((player) => !player.name.trim()).length;
    if (!missingPlayers) return "Both squads are ready. Let’s play.";
    return `Add ${missingPlayers} player${missingPlayers > 1 ? "s" : ""} to start the match.`;
  }

  function isReady() {
    return [...state.home.players, ...state.away.players].every((player) => player.name.trim());
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
      const heading = type === "goal" || type === "soloGoal" ? "Goooooooooooal!" :
        type === "save" ? "What a save!" : type === "halftime" ? "Half-time" :
        type === "fulltime" ? "Full-time" : type === "kickoff" ? "Kick-off" :
        type === "skill" ? "Silky stuff" : type === "block" ? "Big block" : "So close!";
      events.push({
        minute,
        displayMinute: Math.max(0, Math.ceil(minute)),
        atMs: Math.round((minute / 30) * MATCH_DURATION_MS), type, heading,
        side: team?.side || "neutral", scorer: player, assist: type === "goal" ? other : null,
        text: templates[type], score: { ...score }, goal
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
    let passRunningTotal = { home: 0, away: 0 };
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
      passRunningTotal[team.side] += 6 + Math.floor(rand() * 9);
      passRunningTotal[opponent.side] += 3 + Math.floor(rand() * 6);
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

    const homeStrength = teamStrength(state.home);
    const awayStrength = teamStrength(state.away);
    const possessionHome = Math.round(Math.min(72, Math.max(28,
      50 + (homeStrength - awayStrength) * 1.4 + (rand() - 0.5) * 10
    )));
    const saves = { home: 0, away: 0 };
    Object.entries(contributions).forEach(([id, item]) => {
      const [side] = id.split(":");
      saves[side] += item.saves;
    });
    const xg = {
      home: Math.max(0.2, (score.home * 0.62 + rand() * 1.4)).toFixed(2),
      away: Math.max(0.2, (score.away * 0.62 + rand() * 1.4)).toFixed(2)
    };
    const stats = {
      possession: { home: possessionHome, away: 100 - possessionHome },
      xg,
      saves,
      passes: { home: Math.round(passRunningTotal.home), away: Math.round(passRunningTotal.away) }
    };
    const potmEntry = Object.entries(contributions)
      .map(([id, item]) => {
        const [side, slotId] = id.split(":");
        const player = teamBySide(side).players.find((p) => p.slotId === slotId);
        return { player, side, weight: item.goals * 3 + item.assists * 2 + item.saves };
      })
      .sort((a, b) => b.weight - a.weight)[0];
    const playerOfMatch = potmEntry?.player?.name || (winner ? winner.players[0].name : state.home.players[0].name);

    return { seed, events, contributions, finalScore: score, headline, description, stats, playerOfMatch };
  }

  function startMatch() {
    if (!isReady()) return;
    if (!state.home.name.trim()) state.home.name = "Home";
    if (!state.away.name.trim()) state.away.name = "Away";
    saveState();
    state.screen = "sign-in";
    render();
  }

  function beginLoading() {
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
          <div class="topline topline--center">${logoMark("logo--small")}</div>
          <div class="bleed-row">
            <h2 class="bleed-text">Home</h2>
            <input class="team-name-pill home" data-team-name="home" maxlength="24" aria-label="Home team name" placeholder="Enter Team Name" value="${escapeHtml(state.home.name)}" />
          </div>
          <div class="bleed-row">
            <h2 class="bleed-text">Away</h2>
            <input class="team-name-pill away" data-team-name="away" maxlength="24" aria-label="Away team name" placeholder="Enter Team Name" value="${escapeHtml(state.away.name)}" />
          </div>
          <p class="loading-line" id="loading-title" aria-live="polite">${escapeHtml(LOADING_LINES[state.loadingStep])}</p>
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

  function scorePill(score, { showClock = false, showSkip = false, staticStatus = "" } = {}) {
    const status = showClock ? scoreBugStatus() : null;
    return `
      <div class="score-pill-stack">
        <div class="score-pill">
          <div class="score-pill-inner">
            <span class="score-pill-name home">${escapeHtml(state.home.name)}</span>
            <span class="score-pill-num" data-score-side="home">${score.home}</span>
            <span class="score-pill-brand" aria-hidden="true"><span class="s-mark">S</span>BET</span>
            <span class="score-pill-num" data-score-side="away">${score.away}</span>
            <span class="score-pill-name away">${escapeHtml(state.away.name)}</span>
          </div>
        </div>
        <div class="score-pill-below">
          ${showClock ? `<div class="clock-chip ${status.kind === "paused" ? "clock-chip--paused" : ""}"><time class="clock-chip-text">${escapeHtml(status.text)}</time></div>` : ""}
          ${staticStatus ? `<div class="clock-chip"><span class="clock-chip-text">${escapeHtml(staticStatus)}</span><span class="clock-chip-extra">+1</span></div>` : ""}
          ${showSkip ? `<button class="button button--small skip-button" data-action="skip">Skip to final result</button>` : ""}
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
          <div class="topline topline--center">${logoMark("logo--small")}</div>
          <h1 class="sr-only" id="match-title">Live match</h1>
          ${scorePill(score, { showClock: true, showSkip: true })}
          <button class="icon-button pause-button" data-action="pause">${state.paused ? "Resume" : "Pause"}</button>
          <div class="commentary-stage" aria-live="polite">
            ${eventCard(featured, true)}
            <div class="commentary-history">
              ${events.slice(0, -1).reverse().slice(0, 8).map((event) => eventCard(event, false)).join("")}
            </div>
          </div>
        </section>
      </main>`;
    if (!state.paused) runClock();
  }

  function eventCard(event, featured) {
    if (event.goal) {
      return `
        <article
          class="goal-card goal-card--${event.side}"
          data-event="${event.minute}-${event.type}"
          data-dwell-ms="${event.displayMs || 0}"
          data-reading-ms="${event.readingMs || 0}"
        >
          <span class="goal-card-minute">${event.displayMinute}’</span>
          <div class="goal-card-body">
            <h2 class="goal-card-heading">${escapeHtml(event.heading)}</h2>
            <p class="goal-card-copy">${escapeHtml(event.text)}</p>
            <div class="goal-card-credits">
              <span class="goal-credit">⚽ ${escapeHtml(event.scorer?.name || "")}</span>
              ${event.assist ? `<span class="goal-credit">👟 ${escapeHtml(event.assist.name)}</span>` : ""}
            </div>
          </div>
        </article>`;
    }
    return `
      <article
        class="commentary-row"
        data-event="${event.minute}-${event.type}"
        data-dwell-ms="${event.displayMs || 0}"
        data-reading-ms="${event.readingMs || 0}"
      >
        <span class="commentary-minute">${event.displayMinute}’</span>
        <p class="commentary-pill">${escapeHtml(event.text)}</p>
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
    const statusText = document.querySelector(".clock-chip-text");
    const statusTab = document.querySelector(".clock-chip");
    if (statusText) statusText.textContent = status.text;
    if (statusTab) statusTab.classList.toggle("clock-chip--paused", status.kind === "paused");
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
          <div class="topline topline--center">${logoMark("logo--small")}</div>
          <div class="fast-forward-match">
            ${scorePill(score, { showClock: true })}
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

  function renderResultReveal() {
    const score = state.match.finalScore;
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen result-reveal-screen screen--enter" aria-labelledby="result-reveal-title">
          <div class="topline topline--center">${logoMark("logo--small")}</div>
          <h1 class="sr-only" id="result-reveal-title">Final score</h1>
          <div class="bleed-row">
            <h2 class="bleed-text">Home</h2>
            <span class="team-name-pill home team-name-pill--static">${escapeHtml(state.home.name)}</span>
            <span class="bleed-score">${score.home}</span>
          </div>
          <div class="bleed-row">
            <h2 class="bleed-text">Away</h2>
            <span class="team-name-pill away team-name-pill--static">${escapeHtml(state.away.name)}</span>
            <span class="bleed-score">${score.away}</span>
          </div>
          <p class="final-score-label">Final Score</p>
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

  function summaryLineup(team) {
    return `
      <div class="summary-lineup ${team.side}">
        ${team.players.map((player) => playerField(team, player, true)).join("")}
      </div>`;
  }

  function statBar(label, home, away, max, suffix = "") {
    const homePct = Math.min(100, (home / max) * 100);
    const awayPct = Math.min(100, (away / max) * 100);
    return `
      <div class="stat-row">
        <p class="stat-label">${label}</p>
        <div class="stat-tracks">
          <div class="stat-track home"><span style="width:${homePct}%"></span></div>
          <div class="stat-track away"><span style="width:${awayPct}%"></span></div>
        </div>
        <div class="stat-values"><span>${home}${suffix}</span><span>${away}${suffix}</span></div>
      </div>`;
  }

  function renderSummary() {
    const score = state.match.finalScore;
    const stats = state.match.stats;
    app.innerHTML = `
      <main class="app-shell">
        <section class="screen screen--enter summary-screen" aria-labelledby="summary-title">
          <div class="topline topline--center">${logoMark("logo--small")}</div>
          ${scorePill(score, { staticStatus: "30:00" })}
          <div class="summary-card">
            <h2 class="headline headline--secondary summary-headline" id="summary-title">${escapeHtml(state.match.headline)}</h2>
            <div class="summary-body">
              ${summaryLineup(state.home)}
              <div class="stat-block">
                <div class="stat-row stat-row--possession">
                  <p class="stat-label">Possession</p>
                  <div class="possession-track">
                    <span class="possession-home" style="width:${stats.possession.home}%"></span>
                    <span class="possession-away" style="width:${stats.possession.away}%"></span>
                  </div>
                  <div class="stat-values"><span>${stats.possession.home}%</span><span>${stats.possession.away}%</span></div>
                </div>
                ${statBar("xG", stats.xg.home, stats.xg.away, Math.max(2, stats.xg.home, stats.xg.away))}
                ${statBar("Goalkeeper Saves", stats.saves.home, stats.saves.away, Math.max(4, stats.saves.home, stats.saves.away))}
                ${statBar("Passes", stats.passes.home, stats.passes.away, Math.max(50, stats.passes.home, stats.passes.away))}
              </div>
              ${summaryLineup(state.away)}
            </div>
            <p class="potm-label">Player of the Match <strong>${escapeHtml(state.match.playerOfMatch)}</strong></p>
            <p class="summary-copy">${escapeHtml(state.match.description)}</p>
          </div>
          <div class="summary-actions">
            <button class="button" data-action="share">Share Results</button>
            <button class="button" data-action="play-again">New Game</button>
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
    ctx.fillStyle = "#ffffff";
    ctx.font = "italic 900 92px SuperSport, Impact, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("SQUAD UP", 600, 106);
    ctx.font = "700 30px Inter, Arial";
    wrapCanvasText(ctx, state.match.headline, 600, 150, 960, 38);
    roundedRect(ctx, 145, 205, 910, 120, 20, "#ffffff");
    ctx.fillStyle = "#f1c72f";
    ctx.font = "800 16px Inter, Arial";
    ctx.textAlign = "left";
    ctx.fillText("HOME", 185, 244);
    ctx.fillStyle = "#111fa3";
    ctx.font = "800 25px Inter, Arial";
    fitCanvasText(ctx, state.home.name, 185, 282, 285, 25);
    ctx.fillStyle = "#db1b13";
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

    ctx.fillStyle = "rgba(255,255,255,.78)";
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
      roundedRect(ctx, x, rowY, width, 48, 24, "rgba(255,255,255,.09)");
      ctx.textAlign = "left";
      ctx.fillStyle = team.side === "home" ? "#f1c72f" : "#f08a86";
      ctx.font = "800 13px Inter, Arial";
      ctx.fillText(player.position, x + 18, rowY + 30);
      ctx.fillStyle = "#ffffff";
      ctx.font = "600 17px Inter, Arial";
      fitCanvasText(ctx, player.name, x + 64, rowY + 31, width - 155, 17);
      const marks = `${"⚽".repeat(item.goals)}${"🎯".repeat(item.assists)}${item.saves ? `🧤${item.saves > 1 ? item.saves : ""}` : ""}`;
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffffff";
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
      if (action === "age-yes") confirmAge(true);
      if (action === "age-no") confirmAge(false);
      if (action === "back-to-age") { state.screen = "age-check"; render(); }
      if (action === "how-to-play") { state.screen = "how-to-play"; render(); }
      if (action === "new-game") { state.screen = "builder"; renderBuilder(true); bindGlobalEvents(); }
      if (action === "home") { state.screen = "landing"; render(); }
      if (action === "randomise") randomiseTeam(target.dataset.side);
      if (action === "clear-team") clearTeam(target.dataset.side);
      if (action === "focus-slot") focusPlayerSlot(target.dataset.slot);
      if (action === "select-player") selectPlayer(target.dataset.name);
      if (action === "select-custom") selectPlayer(state.query, true);
      if (action === "start-match") startMatch();
      if (action === "continue-signin") beginLoading();
      if (action === "pause") togglePause();
      if (action === "skip") skipMatch();
      if (action === "share") openShareModal();
      if (action === "play-again") { state.match = null; state.screen = "builder"; renderBuilder(true); bindGlobalEvents(); }
    };

    app.oninput = (event) => {
      if (event.target.matches("[data-team-name]")) {
        teamBySide(event.target.dataset.teamName).name = event.target.value;
        saveState();
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
