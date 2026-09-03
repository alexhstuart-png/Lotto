/* Work Lotto Syndicate — frontend app (vanilla JS, hash router).
   All data comes from /api/* Netlify Functions; this file holds no secrets
   and makes no direct Supabase/Resend calls. */

(() => {
  'use strict';

  const app = document.getElementById('app');
  const nav = document.getElementById('bottomNav');
  const navAdmin = document.getElementById('navAdmin');

  let me = null; // { id, name, email, role, notifications_enabled }

  // ---------- utilities ----------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const money = (cents) => {
    const sign = cents < 0 ? '-' : '';
    return sign + '$' + (Math.abs(cents) / 100).toLocaleString('en-AU', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  };

  // Compact money for tight spaces: whole dollars drop the cents ("-$25").
  const moneyShort = (cents) => {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(cents);
    return sign + '$' + (abs % 100 === 0 ? (abs / 100).toString() : (abs / 100).toFixed(2));
  };

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  };

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 401 && path !== '/login') {
      me = null;
      route('#/login');
      throw new Error('Not authenticated');
    }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  const header = () => `
    <header class="app-header">
      <div class="brand display">Work Lotto Syndicate</div>
      <div class="tagline">Thursday Night Powerball</div>
    </header>`;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- login draw-reveal sequence ----------
  // Plays only after a successful login (never on navigation or refresh),
  // skipped entirely under prefers-reduced-motion, skippable with one tap,
  // total run under 4 seconds. Transform/opacity animations only.

  const reveal = { active: false, el: null, spinStart: 0, failsafe: 0 };

  // Glass-sphere lottery machine: glossy globe on a gold pedestal, wire loop
  // track behind, delivery chute with drawn balls, vivid 3D balls tumbling
  // inside. Pure SVG + CSS transform animations.
  const BALL_SHADES = {
    red:    ['#ff8a7e', '#e8402f', '#7e150b'],
    orange: ['#ffc072', '#f07f1f', '#8a3d05'],
    gold:   ['#ffe9a8', '#e9b93a', '#8a6410'],
    green:  ['#8ce8ac', '#2fae5f', '#0c5c2b'],
    blue:   ['#9ccdff', '#3f8fe8', '#123f7e'],
    purple: ['#c6adff', '#7a4fd0', '#3a1e78'],
    pink:   ['#ffb0dc', '#e0559f', '#7e1b52'],
    teal:   ['#9cf4e7', '#2fb9a5', '#0c5a4e'],
  };

  function glossBall(cx, cy, r, shade, num, cls = '') {
    const [, , dark] = BALL_SHADES[shade];
    return `<g class="${cls}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#bg-${shade})"/>
      <ellipse cx="${cx - r * 0.36}" cy="${cy - r * 0.46}" rx="${r * 0.30}" ry="${r * 0.17}"
               fill="rgba(255,255,255,0.75)" transform="rotate(-28 ${cx - r * 0.36} ${cy - r * 0.46})"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 0.52}" fill="#ffffff"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 0.52}" fill="none" stroke="rgba(0,0,0,0.10)"/>
      <text x="${cx}" y="${cy}" font-family="Anton, Arial Black, sans-serif" font-size="${r * 0.66}"
            fill="${dark}" text-anchor="middle" dominant-baseline="central">${num}</text>
    </g>`;
  }

  function drumMarkup() {
    const defs = Object.entries(BALL_SHADES).map(([k, [light, mid, dark]]) => `
      <radialGradient id="bg-${k}" cx="35%" cy="28%" r="80%">
        <stop offset="0%" stop-color="${light}"/>
        <stop offset="55%" stop-color="${mid}"/>
        <stop offset="100%" stop-color="${dark}"/>
      </radialGradient>`).join('');

    const insideBalls = [
      [128, 88, 15, 'red', 7], [190, 84, 14, 'blue', 23], [160, 122, 16, 'gold', 31],
      [126, 128, 14, 'green', 12], [196, 124, 13, 'purple', 4], [160, 68, 13, 'pink', 17],
      [140, 150, 14, 'orange', 28], [184, 150, 13, 'teal', 9],
    ].map((b, i) => glossBall(b[0], b[1], b[2], b[3], b[4], `drum-ball b${i}`)).join('');

    const chuteBalls = [
      [44, 199, 14, 'orange', 12], [80, 189, 14, 'purple', 5], [114, 179, 14, 'teal', 34],
    ].map((b, i) => glossBall(b[0], b[1], b[2], b[3], b[4], `chute-ball c${i}`)).join('');

    const sparks = Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const d = 90 + Math.random() * 80;
      return `<span class="spark" style="--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d)}px"></span>`;
    }).join('');

    return `
      <div class="reveal-inner">
        <div class="drum-wrap">
          <svg viewBox="0 0 320 250" aria-hidden="true">
            <defs>
              ${defs}
              <radialGradient id="glassGrad" cx="38%" cy="30%" r="85%">
                <stop offset="0%" stop-color="rgba(255,255,255,0.16)"/>
                <stop offset="60%" stop-color="rgba(255,255,255,0.06)"/>
                <stop offset="100%" stop-color="rgba(255,255,255,0.02)"/>
              </radialGradient>
              <linearGradient id="rimGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#f6dd96"/>
                <stop offset="50%" stop-color="#e9c46a"/>
                <stop offset="100%" stop-color="#a8841c"/>
              </linearGradient>
              <linearGradient id="tubeGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="rgba(255,255,255,0.04)"/>
                <stop offset="50%" stop-color="rgba(255,255,255,0.20)"/>
                <stop offset="100%" stop-color="rgba(255,255,255,0.04)"/>
              </linearGradient>
              <linearGradient id="pedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#e9c46a"/>
                <stop offset="100%" stop-color="#7c6115"/>
              </linearGradient>
              <radialGradient id="specGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="rgba(255,255,255,0.55)"/>
                <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
              </radialGradient>
            </defs>

            <!-- wire loop track behind the globe -->
            <circle cx="215" cy="98" r="100" fill="none" stroke="rgba(233,196,106,0.30)" stroke-width="9"/>
            <circle cx="215" cy="98" r="100" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="3"/>
            <circle cx="215" cy="98" r="112" fill="none" stroke="rgba(233,196,106,0.16)" stroke-width="6"/>

            <!-- ground shadow + pedestal -->
            <ellipse cx="160" cy="226" rx="72" ry="9" fill="rgba(0,0,0,0.40)"/>
            <rect x="142" y="178" width="36" height="30" rx="7" fill="url(#pedGrad)"/>
            <ellipse cx="160" cy="212" rx="48" ry="11" fill="url(#pedGrad)"/>
            <ellipse cx="160" cy="209" rx="48" ry="10" fill="#3a2e08"/>
            <ellipse cx="160" cy="208" rx="44" ry="8" fill="url(#pedGrad)"/>

            <!-- glass sphere (back) -->
            <circle cx="160" cy="105" r="80" fill="url(#glassGrad)"/>
            <rect x="152" y="30" width="16" height="150" rx="8" fill="url(#tubeGrad)"/>

            <!-- tumbling balls -->
            <g class="drum-accel">
              <g class="drum-spin">
                <circle cx="160" cy="105" r="62" fill="none"/>
                ${insideBalls}
              </g>
            </g>

            <!-- glass sphere (front): rim, inner line, speculars, top cap -->
            <circle cx="160" cy="105" r="80" fill="none" stroke="url(#rimGrad)" stroke-width="6"/>
            <circle cx="160" cy="105" r="73" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="2"/>
            <ellipse cx="128" cy="60" rx="36" ry="20" fill="url(#specGrad)"
                     transform="rotate(-30 128 60)"/>
            <ellipse cx="196" cy="152" rx="20" ry="10" fill="url(#specGrad)" opacity="0.5"
                     transform="rotate(-30 196 152)"/>
            <rect x="146" y="16" width="28" height="14" rx="5" fill="url(#rimGrad)"/>

            <!-- delivery chute with drawn balls -->
            <path d="M12 214 L140 174" stroke="url(#rimGrad)" stroke-width="5" stroke-linecap="round"/>
            ${chuteBalls}
            <path d="M12 228 L146 186" stroke="url(#rimGrad)" stroke-width="5" stroke-linecap="round"/>
          </svg>
        </div>
        <div class="reveal-stage"></div>
      </div>
      <div class="reveal-flash"></div>
      ${sparks}`;
  }

  function startReveal() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (reveal.active) return;
    const el = document.createElement('div');
    el.className = 'reveal-overlay';
    el.innerHTML = drumMarkup();
    document.body.appendChild(el);
    reveal.active = true;
    reveal.el = el;
    reveal.spinStart = Date.now();
    el.addEventListener('pointerdown', endReveal); // single tap anywhere skips
    reveal.failsafe = setTimeout(endReveal, 8000); // never trap the user
  }

  function endReveal() {
    if (!reveal.active) return;
    reveal.active = false;
    clearTimeout(reveal.failsafe);
    const el = reveal.el;
    reveal.el = null;
    el.classList.add('reveal-fade');
    setTimeout(() => el.remove(), 320);
  }

  /** Burst the drum and fly this week's numbers (or the kitty) in. */
  async function revealSequence(homeData) {
    if (!reveal.active) return;
    const el = reveal.el;
    // Let the drum spin ~2s total, counting from login.
    await sleep(Math.max(0, reveal.spinStart + 2000 - Date.now()));
    if (!reveal.active) return;
    el.classList.add('burst');
    await sleep(280);
    if (!reveal.active) return;

    const stage = el.querySelector('.reveal-stage');
    const d = homeData.current;
    let holdMs;
    if (d && d.ticket && d.games.length) {
      const matchById = new Map();
      if (d.matching) for (const m of d.matching.matches) matchById.set(m.gameIndex, m);
      const lines = d.games.map((g, i) => {
        const line = gameLine(g, matchById.get(g.game_index) || null);
        return line.replace('class="game-line"', `class="game-line" style="animation-delay:${i * 60}ms"`);
      }).join('');
      stage.innerHTML = `<div class="reveal-title display">This week's numbers</div>${lines}`;
      holdMs = d.games.length * 60 + 420;
    } else {
      stage.innerHTML = `<div class="reveal-kitty">
        <div class="label">In the kitty</div>
        <div class="figure">${money(homeData.kitty_cents)}</div>
      </div>`;
      holdMs = 900;
    }
    el.classList.add('show-numbers');
    await sleep(holdMs);
    endReveal();
  }

  // ---------- shared render pieces ----------

  const STATUS_LABELS = {
    upcoming: ['Upcoming', 'draft'],
    waiting_results: ['Waiting for Results', 'waiting'],
    results_pending_failed: ['Results pending — auto retrieve failed', 'failed'],
    results_available: ['Results Available', 'results'],
    checked: ['Checked', 'results'],
    winner: ['Winner!', 'winner'],
  };

  const statusChip = (status) => {
    const [label, cls] = STATUS_LABELS[status] || [status, ''];
    return `<span class="chip ${cls}">${esc(label)}</span>`;
  };

  /** One game line: balls with green matched mains / gold matched powerball. */
  function gameLine(game, match, { mini = false } = {}) {
    const matched = new Set(match ? match.matchedNumbers : []);
    const balls = game.numbers.map((n) =>
      `<span class="ball${matched.has(n) ? ' matched' : ''}">${n}</span>`
    ).join('');
    const pb = game.powerhit
      ? `<span class="ball pb ph${match && match.powerballMatched ? ' matched' : ''}">PH</span>`
      : `<span class="ball pb${match && match.powerballMatched ? ' matched' : ''}">${game.powerball}</span>`;
    const count = match
      ? `<span class="match-count${match.matchCount >= 3 || match.isWinner ? ' hot' : ''}">${match.matchCount}${match.powerballMatched ? '+PB' : ''}</span>`
      : '';
    const sys = game.numbers.length > 7 ? ' sys' : ''; // System entry: smaller balls to fit
    return `<div class="game-line${sys}${mini ? ' mini' : ''}">
      <span class="gnum">${game.numbers.length > 7 ? 'S' + game.numbers.length : 'G' + game.game_index}</span>${balls}${pb}${count}
    </div>`;
  }

  function officialStrip(result) {
    if (!result) return '';
    const balls = result.numbers.map((n) => `<span class="ball">${n}</span>`).join('');
    return `<div class="official-strip">
      <span class="lbl">Official numbers${result.source === 'manual' ? ' (entered by admin)' : ''}</span>
      ${balls}<span class="ball pb">${result.powerball}</span>
    </div>`;
  }

  function winnerCallouts(detail) {
    if (!detail || !detail.matching || !detail.matching.hasWinner) return '';
    return detail.matching.winners.map((w) => {
      const confirmed = (detail.winnings || []).find((x) => x.game_index === w.gameIndex);
      const detailTxt = confirmed
        ? `${money(confirmed.amount_cents)}${confirmed.added_to_kitty ? ' — added to kitty' : ''}`
        : 'Prize amount to be confirmed by admin';
      return `<div class="winner-callout">
        <span class="trophy">🏆</span>
        <div>
          <div class="win-title">Winner — Game ${w.gameIndex}${w.division ? ` · Division ${w.division}` : ''}</div>
          <div class="win-detail">${w.matchCount} numbers${w.powerballMatched ? ' + Powerball' : ''} · ${esc(detailTxt)}</div>
        </div>
      </div>`;
    }).join('');
  }

  /** The gold perforated ticket stub with all games. */
  function ticketStub(detail) {
    if (!detail || !detail.ticket) {
      return `<div class="card"><h2>This week's ticket</h2>
        <p style="color:var(--muted)">No ticket yet — check back once it's published.</p></div>`;
    }
    const matchById = new Map();
    if (detail.matching) for (const m of detail.matching.matches) matchById.set(m.gameIndex, m);
    const lines = detail.games.map((g) => gameLine(g, matchById.get(g.game_index) || null)).join('');
    return `
      ${winnerCallouts(detail)}
      <div class="ticket-stub">
        <div class="stub-head">
          <div>
            <div class="stub-title">Powerball</div>
            <div class="stub-sub">${esc(fmtDate(detail.draw.draw_date))}</div>
          </div>
          <div style="text-align:right">
            <div class="stub-sub">${detail.games.length} games</div>
            <div class="stub-sub">${money(detail.ticket.cost_cents)}</div>
          </div>
        </div>
        ${lines}
        <div class="stub-meta">
          <span>${detail.draw.draw_number ? 'Draw #' + detail.draw.draw_number : 'Syndicate entry'}</span>
          <span>Good luck!</span>
        </div>
      </div>`;
  }

  // ---------- router ----------

  const views = {};

  function route(hash) {
    if (hash) location.hash = hash;
  }

  async function render() {
    const hash = location.hash || '#/home';
    const name = hash.replace('#/', '').split('?')[0] || 'home';

    const publicViews = ['login', 'set-password'];
    if (!me && !publicViews.includes(name)) {
      try {
        const data = await api('/me');
        me = data.member;
      } catch {
        return; // api() already routed to #/login
      }
    }
    if (name === 'admin' && (!me || me.role !== 'admin')) return route('#/home');

    nav.classList.toggle('hidden', publicViews.includes(name));
    navAdmin.classList.toggle('hidden', !me || me.role !== 'admin');
    nav.querySelectorAll('a').forEach((a) =>
      a.classList.toggle('active', a.dataset.view === name)
    );

    const view = views[name] || views.home;
    app.innerHTML = header() + `<p style="color:var(--muted);text-align:center">Loading…</p>`;
    try {
      await view();
    } catch (e) {
      endReveal(); // never leave the reveal overlay up over an error
      if (e.message !== 'Not authenticated') {
        app.innerHTML = header() + `<div class="card"><p class="form-msg error">${esc(e.message)}</p></div>`;
      }
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);

  // ---------- views ----------

  views.login = async () => {
    me = null;
    app.innerHTML = `
      <div class="login-wrap">
        ${header()}
        <div class="card login-card">
          <label>Email</label>
          <input id="loginEmail" type="email" autocomplete="email" inputmode="email">
          <label>Password</label>
          <input id="loginPassword" type="password" autocomplete="current-password">
          <div class="form-msg error" id="loginMsg"></div>
          <button class="btn" id="loginBtn">Log In</button>
        </div>
      </div>`;
    const submit = async () => {
      const btn = document.getElementById('loginBtn');
      const msg = document.getElementById('loginMsg');
      btn.disabled = true; msg.textContent = '';
      try {
        const data = await api('/login', {
          method: 'POST',
          body: {
            email: document.getElementById('loginEmail').value.trim(),
            password: document.getElementById('loginPassword').value,
          },
        });
        me = data.member;
        startReveal(); // draw-reveal plays on login only
        route('#/home');
      } catch (e) {
        msg.textContent = e.message;
        btn.disabled = false;
      }
    };
    document.getElementById('loginBtn').addEventListener('click', submit);
    app.querySelectorAll('input').forEach((i) =>
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); })
    );
  };

  views['set-password'] = async () => {
    const query = new URLSearchParams((location.hash.split('?')[1] || ''));
    const email = query.get('email') || '';
    const token = query.get('token') || '';
    app.innerHTML = `
      <div class="login-wrap">
        ${header()}
        <div class="card login-card">
          <h2>Set your password</h2>
          <p style="color:var(--muted);font-size:14px">for <strong>${esc(email)}</strong></p>
          <label>New password (8+ characters)</label>
          <input id="spPass" type="password" autocomplete="new-password">
          <label>Confirm password</label>
          <input id="spPass2" type="password" autocomplete="new-password">
          <div class="form-msg error" id="spMsg"></div>
          <button class="btn" id="spBtn">Save password</button>
        </div>
      </div>`;
    document.getElementById('spBtn').addEventListener('click', async () => {
      const msg = document.getElementById('spMsg');
      const p1 = document.getElementById('spPass').value;
      const p2 = document.getElementById('spPass2').value;
      msg.textContent = '';
      if (p1.length < 8) { msg.textContent = 'Password must be at least 8 characters'; return; }
      if (p1 !== p2) { msg.textContent = "Passwords don't match"; return; }
      try {
        await api('/set-password', { method: 'POST', body: { email, token, password: p1 } });
        app.querySelector('.login-card').innerHTML = `
          <h2>Password set 🎉</h2>
          <p style="color:var(--muted)">You're all set — log in with your email and new password.</p>
          <button class="btn" onclick="location.hash='#/login'">Go to login</button>`;
      } catch (e) { msg.textContent = e.message; }
    });
  };

  // Prepay model: members top up in advance and never go negative. Red means
  // "$25 or less left — one draw of credit, top up now".
  const LOW_BALANCE_CENTS = 2500;

  views.home = async () => {
    const data = await api('/home');
    if (reveal.active) revealSequence(data); // continues on top while home renders below
    const d = data.current;
    const balCls = data.balance_cents <= LOW_BALANCE_CENTS ? 'owing' : 'credit';
    app.innerHTML = header() + `
      <div class="stat-row">
        <div class="stat">
          <div class="label">Kitty</div>
          <div class="value">${money(data.kitty_cents)}</div>
        </div>
        <div class="stat">
          <div class="label">My balance</div>
          <div class="value ${balCls}">${money(data.balance_cents)}</div>
        </div>
      </div>
      ${data.balance_cents <= LOW_BALANCE_CENTS ? `<div class="card" style="border-color:rgba(231,111,81,0.5)">
        <p style="margin:0;color:var(--red);font-weight:600">Your balance is ${money(data.balance_cents)} — top up before Thursday to stay in the draw. Weekly ticket is ${money(data.weekly_charge_cents)}.</p>
      </div>` : ''}
      ${(data.members || []).length ? `
      <div class="card">
        <h2>The Syndicate</h2>
        <div class="member-grid">
          ${data.members.map((m) => `
            <div class="member-box ${m.balance_cents <= LOW_BALANCE_CENTS ? 'danger' : ''}">
              <div class="mb-name">${esc(m.name)}</div>
              <div class="mb-balance">${moneyShort(m.balance_cents)}</div>
            </div>`).join('')}
        </div>
      </div>` : ''}
      ${d ? `
        <div class="card">
          <h2>This week <span style="float:right">${statusChip(d.draw.status)}</span></h2>
          ${officialStrip(d.result)}
        </div>
        ${ticketStub(d)}
      ` : `<div class="card"><p style="color:var(--muted)">No draws yet.</p></div>`}
      <div class="stat">
        <div class="label">Total syndicate winnings</div>
        <div class="value">${money(data.total_winnings_cents)}</div>
      </div>`;
  };

  views.ticket = async () => {
    const data = await api('/home');
    const d = data.current;
    if (!d) {
      app.innerHTML = header() + `<div class="card"><p style="color:var(--muted)">No draws yet.</p></div>`;
      return;
    }
    app.innerHTML = header() + `
      <div class="card">
        <h2>${esc(fmtDate(d.draw.draw_date))} <span style="float:right">${statusChip(d.draw.status)}</span></h2>
        ${d.result ? officialStrip(d.result) : '<p style="color:var(--muted);margin:0">Results land Friday morning — numbers will light up automatically.</p>'}
      </div>
      ${ticketStub(d)}
      ${d.ticket && d.ticket.published_at ? `<p style="color:var(--muted);font-size:12px;text-align:center">Published ${new Date(d.ticket.published_at).toLocaleString('en-AU')}</p>` : ''}`;
  };

  views.history = async () => {
    const data = await api('/history');
    const rows = data.draws.map((d) => {
      const result = d.result
        ? `<div class="mini-balls">${d.result.numbers.map((n) => `<span class="ball">${n}</span>`).join('')}<span class="ball pb">${d.result.powerball}</span></div>`
        : '';
      const winnings = (d.winnings || []).reduce((s, w) => s + w.amount_cents, 0);
      const bestMatch = d.matching
        ? Math.max(0, ...d.matching.matches.map((m) => m.matchCount))
        : null;
      return `<div class="card">
        <div class="list-row" style="border:none;padding:0">
          <div>
            <div class="primary">${esc(fmtDate(d.draw.draw_date))}</div>
            <div class="secondary">
              ${d.ticket ? `${d.games.length} games · ${money(d.ticket.cost_cents)}` : 'No ticket'}
              ${bestMatch !== null ? ` · best line ${bestMatch}` : ''}
              ${winnings > 0 ? ` · won ${money(winnings)}` : ''}
            </div>
          </div>
          ${statusChip(d.draw.status)}
        </div>
        ${result}
        ${winnerCallouts(d)}
      </div>`;
    }).join('');
    app.innerHTML = header() + (rows || `<div class="card"><p style="color:var(--muted)">No draw history yet.</p></div>`);
  };

  views.account = async () => {
    const data = await api('/account');
    const balCls = data.balance_cents <= LOW_BALANCE_CENTS ? 'owing' : 'credit';
    const txns = data.transactions.map((t) => {
      const labels = {
        weekly_charge: 'Weekly ticket charge',
        payment: 'Payment',
        adjustment: 'Adjustment',
        winnings_credit: 'Winnings credit',
      };
      return `<div class="list-row">
        <div>
          <div class="primary">${esc(labels[t.type] || t.type)}</div>
          <div class="secondary">${esc(t.note || '')} · ${new Date(t.created_at).toLocaleDateString('en-AU')}</div>
        </div>
        <span class="amount ${t.amount_cents < 0 ? 'owing' : 'credit'}">${money(t.amount_cents)}</span>
      </div>`;
    }).join('');
    app.innerHTML = header() + `
      <div class="stat">
        <div class="label">My balance</div>
        <div class="value ${balCls}">${money(data.balance_cents)}</div>
      </div>
      <div class="card">
        <div class="list-row" style="border:none;padding:0">
          <div>
            <div class="primary">${esc(data.member.name)}</div>
            <div class="secondary">${esc(data.member.email)}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="list-row" style="border:none;padding:0">
          <div>
            <div class="primary">Email notifications</div>
            <div class="secondary">Ticket confirmations, reminders, win announcements</div>
          </div>
          <span class="toggle">
            <input type="checkbox" id="notifToggle" ${data.member.notifications_enabled ? 'checked' : ''}>
            <span class="track"></span>
          </span>
        </div>
      </div>
      <div class="card">
        <h2>Transactions</h2>
        ${txns || '<p style="color:var(--muted)">No transactions yet.</p>'}
      </div>
      <button class="btn secondary" id="logoutBtn">Log out</button>`;
    document.getElementById('notifToggle').addEventListener('change', async (e) => {
      try {
        await api('/account/notifications', { method: 'POST', body: { enabled: e.target.checked } });
      } catch { e.target.checked = !e.target.checked; }
    });
    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await api('/logout', { method: 'POST' });
      me = null;
      route('#/login');
    });
  };

  // ---------- admin ----------

  // A line is the mains then the Powerball last: 8 numbers for a standard
  // game (7+PB), 9-21 for a System 8-20 entry. A trailing "PH" instead of a
  // Powerball marks a PowerHit (plays all 20 Powerballs).
  function parseGameLine(line, { exactMains = null } = {}) {
    const tokens = line.trim().split(/[\s,:+]+/).filter(Boolean);
    if (tokens.length < 2) return null;
    const last = tokens[tokens.length - 1];
    const powerhit = /^ph$/i.test(last) || /^powerhit$/i.test(last);
    if (powerhit && exactMains !== null) return null; // results can't be PowerHit
    const mainTokens = tokens.slice(0, -1);
    const mains = mainTokens.map(Number);
    if (mains.some((n) => !Number.isInteger(n))) return null;
    if (exactMains !== null && mains.length !== exactMains) return null;
    if (mains.length < 7 || mains.length > 20) return null;
    if (powerhit) return { numbers: mains, powerball: null, powerhit: true };
    const pb = Number(last);
    if (!Number.isInteger(pb)) return null;
    return { numbers: mains, powerball: pb, powerhit: false };
  }

  // Render a game back into its text-line form for the editor.
  const gameToLine = (g) => g.numbers.join(' ') + ' ' + (g.powerhit ? 'PH' : g.powerball);

  views.admin = async () => {
    const data = await api('/admin/overview');
    const draws = data.draws;
    const activeDraw = draws[0] || null;

    const memberRows = data.members.map((m) => `
      <div class="list-row">
        <div>
          <div class="primary">${esc(m.name)} ${m.role === 'admin' ? '<span class="tag">admin</span>' : ''}
            ${!m.is_active ? '<span class="tag off">inactive</span>' : ''}
            ${!m.notifications_enabled ? '<span class="tag off">no emails</span>' : ''}
            ${!m.has_password ? '<span class="tag off">no password yet</span>' : ''}</div>
          <div class="secondary">${esc(m.email)}</div>
        </div>
        <div style="text-align:right">
          <span class="amount ${m.balance_cents < 0 ? 'owing' : 'credit'}">${money(m.balance_cents)}</span><br>
          <button class="btn small secondary" data-edit-member="${m.id}" style="margin-top:6px">Edit</button>
          <button class="btn small secondary" data-invite-member="${m.id}" style="margin-top:6px">${m.has_password ? 'Reset link' : 'Resend invite'}</button>
        </div>
      </div>`).join('');

    const drawOptions = draws.map((d) =>
      `<option value="${d.draw.id}">${esc(d.draw.draw_date)} — ${esc((STATUS_LABELS[d.draw.status] || [d.draw.status])[0])}</option>`
    ).join('');

    const memberOptions = data.members.filter((m) => m.is_active)
      .map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');

    const currentGamesText = activeDraw && activeDraw.games.length
      ? activeDraw.games.map(gameToLine).join('\n') : '';

    const emailRows = data.email_logs.map((l) => `
      <div class="list-row">
        <div>
          <div class="primary">${esc(l.type)} ${l.status === 'failed' ? '<span class="tag off">failed</span>' : ''}</div>
          <div class="secondary">${esc(l.to_email)} · ${new Date(l.sent_at).toLocaleString('en-AU')}</div>
        </div>
      </div>`).join('');

    const kittyRows = data.kitty_transactions.map((t) => `
      <div class="list-row">
        <div>
          <div class="primary">${esc(t.type.replace('_', ' '))}</div>
          <div class="secondary">${esc(t.note || '')} · ${new Date(t.created_at).toLocaleDateString('en-AU')}</div>
        </div>
        <span class="amount ${t.amount_cents < 0 ? 'owing' : 'credit'}">${money(t.amount_cents)}</span>
      </div>`).join('');

    app.innerHTML = header() + `
      <div class="stat"><div class="label">Kitty</div><div class="value">${money(data.kitty_cents)}</div></div>

      <div class="admin-section">
        <h2>Members</h2>
        <div class="card">${memberRows}</div>
        <div class="card">
          <h2>Add member</h2>
          <label>Name</label><input id="nmName">
          <label>Email</label><input id="nmEmail" type="email">
          <div class="form-msg" id="nmMsg"></div>
          <button class="btn secondary" id="nmBtn">Add member</button>
        </div>
      </div>

      <div class="admin-section">
        <h2>Draw &amp; Ticket</h2>
        <div class="card">
          <label>New draw date (a Thursday)</label>
          <input id="ndDate" type="date">
          <div class="form-msg" id="ndMsg"></div>
          <button class="btn secondary" id="ndBtn">Create draw</button>
        </div>
        <div class="card">
          <label>Draw</label>
          <select id="ticketDraw">${drawOptions}</select>
          <input id="scanFile" type="file" accept="image/*" capture="environment" multiple style="display:none">
          <button class="btn secondary" id="scanBtn" style="margin:6px 0 12px">📷 Scan ticket photo(s)</button>
          <div class="form-msg" id="scanMsg"></div>
          <label>Games — one per line: mains then the Powerball last (7 mains standard, 8-20 for System). PowerHit: mains then <code>PH</code></label>
          <textarea id="ticketGames" rows="6" placeholder="4 11 17 22 31 40 2 7">${esc(currentGamesText)}</textarea>
          <label>Ticket cost ($)</label>
          <input id="ticketCost" type="number" step="0.01" min="0" value="${activeDraw && activeDraw.ticket ? (activeDraw.ticket.cost_cents / 100).toFixed(2) : ''}">
          <div class="form-msg" id="ticketMsg"></div>
          <div class="pill-btns">
            <button class="btn small secondary" id="saveTicketBtn">Save ticket</button>
            <button class="btn small" id="publishTicketBtn">Publish (charge + email)</button>
          </div>
          <p style="color:var(--muted);font-size:12px">Publishing charges each active member ${money(data.settings.weekly_charge_cents)} once — re-publishing never double-charges.</p>
        </div>
      </div>

      <div class="admin-section">
        <h2>Official Results</h2>
        <div class="card">
          <button class="btn" id="fetchResultsBtn">⚡ Fetch results now (auto)</button>
          <p style="color:var(--muted);font-size:12px;margin-top:8px">Pulls the official numbers straight from the Lott and lights everything up — tap on draw night once results are posted (usually 30-60 min after the draw). The 3 AM auto-fetch stays as backup.</p>
        </div>
        <div class="card">
          <label>Or enter manually — Draw</label>
          <select id="resultsDraw">${drawOptions}</select>
          <label>7 winning mains + Powerball (space-separated, PB last)</label>
          <input id="resultsNumbers" placeholder="4 8 17 22 31 33 44 7">
          <div class="form-msg" id="resultsMsg"></div>
          <button class="btn" id="resultsBtn">Save results — matching runs automatically</button>
          <p style="color:var(--muted);font-size:12px">Saving triggers matching, highlighting, win detection and draw status in one action. Manual entry overrides scraped results.</p>
        </div>
      </div>

      <div class="admin-section">
        <h2>Payments</h2>
        <div class="card">
          <label>Member</label><select id="payMember">${memberOptions}</select>
          <label>Amount ($)</label><input id="payAmount" type="number" step="0.01" min="0">
          <label>Note</label><input id="payNote" placeholder="Bank transfer">
          <div class="form-msg" id="payMsg"></div>
          <button class="btn secondary" id="payBtn">Record payment (credits member + kitty)</button>
        </div>
      </div>

      <div class="admin-section">
        <h2>Confirm Winnings</h2>
        <div class="card">
          <label>Draw</label><select id="winDraw">${drawOptions}</select>
          <div class="grid-2">
            <div><label>Division (1-9, optional)</label><input id="winDivision" type="number" min="1" max="9"></div>
            <div><label>Game # (optional)</label><input id="winGame" type="number" min="1"></div>
          </div>
          <label>Amount ($)</label><input id="winAmount" type="number" step="0.01" min="0">
          <div class="list-row" style="border:none">
            <span>Add to kitty</span>
            <span class="toggle"><input type="checkbox" id="winToKitty" checked><span class="track"></span></span>
          </div>
          <div class="form-msg" id="winMsg"></div>
          <div class="pill-btns">
            <button class="btn small" id="winBtn">Confirm winnings</button>
            <button class="btn small secondary" id="announceBtn" disabled>Announce win to members</button>
          </div>
          <p style="color:var(--muted);font-size:12px">Prize amounts are never guessed — enter the amount from the official ticket check.</p>
        </div>
      </div>

      <div class="admin-section">
        <h2>Settings</h2>
        <div class="card">
          <label>Weekly charge ($)</label>
          <input id="setWeekly" type="number" step="0.01" min="0" value="${(data.settings.weekly_charge_cents / 100).toFixed(2)}">
          <div class="list-row" style="border:none">
            <span>Charge members on publish</span>
            <span class="toggle"><input type="checkbox" id="setCharge" ${data.settings.charge_on_publish ? 'checked' : ''}><span class="track"></span></span>
          </div>
          <label>Reminder threshold ($ — remind when balance is at or below this)</label>
          <input id="setThreshold" type="number" step="0.01" value="${(data.settings.owing_threshold_cents / 100).toFixed(2)}">
          <div class="form-msg" id="setMsg"></div>
          <div class="pill-btns">
            <button class="btn small secondary" id="setBtn">Save settings</button>
            <button class="btn small secondary" id="remindersBtn">Run Friday reminders now</button>
          </div>
        </div>
      </div>

      <div class="admin-section">
        <h2>Kitty ledger</h2>
        <div class="card">${kittyRows || '<p style="color:var(--muted)">Empty.</p>'}</div>
      </div>

      <div class="admin-section">
        <h2>Email log</h2>
        <div class="card">${emailRows || '<p style="color:var(--muted)">No emails sent yet.</p>'}</div>
      </div>`;

    // ----- wire up admin actions -----
    const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
    const val = (id) => document.getElementById(id).value;
    const msg = (id, text, ok) => {
      const el = document.getElementById(id);
      el.textContent = text;
      el.className = 'form-msg ' + (ok ? 'ok' : 'error');
    };
    const dollars = (id) => Math.round(parseFloat(val(id) || '0') * 100);
    const act = async (msgId, fn, okText, { rerender = true } = {}) => {
      try {
        const out = await fn();
        msg(msgId, okText(out), true);
        if (rerender) setTimeout(render, 1200);
      } catch (e) { msg(msgId, e.message, false); }
    };

    // Ticket editor follows the selected draw.
    document.getElementById('ticketDraw').addEventListener('change', (e) => {
      const d = draws.find((x) => x.draw.id === e.target.value);
      document.getElementById('ticketGames').value = d && d.games.length
        ? d.games.map(gameToLine).join('\n') : '';
      document.getElementById('ticketCost').value = d && d.ticket
        ? (d.ticket.cost_cents / 100).toFixed(2) : '';
    });

    const showInvite = (out) => {
      const status = out.invite_email_sent
        ? 'Invite email sent — here is the set-password link too:'
        : 'Email delivery is not configured — copy this set-password link and send it to them:';
      prompt(status, out.invite_link);
    };

    on('nmBtn', () => act('nmMsg',
      () => api('/admin/members', { method: 'POST', body: { name: val('nmName'), email: val('nmEmail') } }),
      (o) => `Member added — they can log in now with password "${o.default_password}"`));

    app.querySelectorAll('[data-invite-member]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const out = await api(`/admin/members/${btn.dataset.inviteMember}/invite`, { method: 'POST' });
          showInvite(out);
        } catch (e) { alert(e.message); }
        btn.disabled = false;
      });
    });

    app.querySelectorAll('[data-edit-member]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const m = data.members.find((x) => x.id === btn.dataset.editMember);
        const name = prompt('Name', m.name);
        if (name === null) return;
        const active = confirm(`OK = ${m.name} is ACTIVE (charged weekly + emailed)\nCancel = inactive`);
        try {
          await api(`/admin/members/${m.id}`, { method: 'PATCH', body: { name, is_active: active } });
          render();
        } catch (e) { alert(e.message); }
      });
    });

    on('ndBtn', () => act('ndMsg',
      () => api('/admin/draws', { method: 'POST', body: { draw_date: val('ndDate') } }),
      () => 'Draw created'));

    // 📷 Scan ticket photo: downscale client-side, send to the server, and
    // PRE-FILL the games editor. The admin checks the numbers against the
    // paper ticket before saving — a scan never saves anything by itself.
    // Multiple tickets: each scan APPENDS to the games list (duplicate lines
    // skipped), so you can snap ticket 1, then ticket 2 — or select several
    // photos at once — and publish the lot together.
    const scanInput = document.getElementById('scanFile');
    on('scanBtn', () => scanInput.click());
    scanInput.addEventListener('change', async () => {
      const files = Array.from(scanInput.files || []);
      scanInput.value = '';
      if (!files.length) return;
      const btn = document.getElementById('scanBtn');
      btn.disabled = true;
      const ta = document.getElementById('ticketGames');
      let added = 0;
      let skippedDup = 0;
      const notes = [];
      try {
        for (let i = 0; i < files.length; i++) {
          msg('scanMsg', `Reading photo ${i + 1} of ${files.length}…`, true);
          const img = await createImageBitmap(files[i]);
          const scale = Math.min(1, 1568 / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

          const out = await api('/admin/tickets/scan', {
            method: 'POST',
            body: { image: base64, media_type: 'image/jpeg' },
          });
          const existing = new Set(ta.value.split('\n').map((l) => l.trim()).filter(Boolean));
          for (const g of out.games) {
            const line = gameToLine(g);
            if (existing.has(line)) { skippedDup++; continue; }
            existing.add(line);
            ta.value = ta.value.trim() ? ta.value.trim() + '\n' + line : line;
            added++;
          }
          if (out.notes) notes.push(out.notes);
          if (out.rejected) notes.push(`${out.rejected} unreadable line(s) skipped`);
        }
        const total = ta.value.split('\n').filter((l) => l.trim()).length;
        const extras = [
          skippedDup ? `${skippedDup} duplicate(s) skipped` : '',
          ...notes,
        ].filter(Boolean).join(' · ');
        msg('scanMsg', `Added ${added} game(s) from ${files.length} photo(s) — ${total} total${extras ? ` (${extras})` : ''}. CHECK every number before publishing`, true);
      } catch (e) {
        msg('scanMsg', e.message, false);
      }
      btn.disabled = false;
    });

    const collectGames = () => {
      const lines = val('ticketGames').split('\n').map((l) => l.trim()).filter(Boolean);
      const games = lines.map((l) => parseGameLine(l));
      if (games.length === 0 || games.some((g) => g === null)) {
        throw new Error('Each line: 7 mains (or 8-20 for a System entry) then the Powerball last');
      }
      return games;
    };

    on('saveTicketBtn', () => act('ticketMsg',
      () => api('/admin/tickets', {
        method: 'POST',
        body: { draw_id: val('ticketDraw'), cost_cents: dollars('ticketCost'), games: collectGames() },
      }),
      (o) => `Saved ${o.games_saved} games${o.edited_published ? ' (published ticket edit — audit logged)' : ''}`));

    on('publishTicketBtn', () => act('ticketMsg',
      async () => {
        const saved = await api('/admin/tickets', {
          method: 'POST',
          body: { draw_id: val('ticketDraw'), cost_cents: dollars('ticketCost'), games: collectGames() },
        });
        return api(`/admin/tickets/${saved.ticket_id}/publish`, { method: 'POST' });
      },
      (o) => `Published — charged ${o.charged} member(s), ${o.charge_skipped} already charged, emailed ${o.emailed}`));

    on('fetchResultsBtn', async () => {
      const btn = document.getElementById('fetchResultsBtn');
      btn.disabled = true;
      btn.textContent = 'Fetching…';
      try {
        const out = await api('/admin/results/fetch', { method: 'POST' });
        const messages = {
          saved: out.hasWinner ? '🏆 WINNER! Results saved and matched' : '✅ Results in — ticket lit up, no winning line',
          skipped: 'Results were already saved for this draw',
          no_draw: 'No draw is waiting for results',
          fetch_failed: "Results aren't up yet (or the source is down) — try again in a few minutes, or enter them manually below",
          mismatch: `The source's latest draw (${out.scrapedDate || '?'}) doesn't match ours yet — try again shortly`,
        };
        alert(messages[out.status] || out.status);
        if (out.status === 'saved' || out.status === 'skipped') render();
      } catch (e) { alert(e.message); }
      btn.disabled = false;
      btn.textContent = '⚡ Fetch results now (auto)';
    });

    on('resultsBtn', () => act('resultsMsg',
      () => {
        const parsed = parseGameLine(val('resultsNumbers'), { exactMains: 7 });
        if (!parsed) throw new Error('Enter exactly 8 numbers: 7 mains then the Powerball');
        return api('/admin/results', {
          method: 'POST',
          body: { draw_id: val('resultsDraw'), numbers: parsed.numbers, powerball: parsed.powerball },
        });
      },
      (o) => o.hasWinner ? '🏆 WINNER detected — matching done' : 'Results saved — matching done, no winning line'));

    on('payBtn', () => act('payMsg',
      () => api('/admin/payments', {
        method: 'POST',
        body: { member_id: val('payMember'), amount_cents: dollars('payAmount'), note: val('payNote') },
      }),
      () => 'Payment recorded'));

    let lastWinningId = null;
    on('winBtn', () => act('winMsg',
      async () => {
        const out = await api('/admin/winnings', {
          method: 'POST',
          body: {
            draw_id: val('winDraw'),
            division: val('winDivision') ? parseInt(val('winDivision'), 10) : null,
            game_index: val('winGame') ? parseInt(val('winGame'), 10) : null,
            amount_cents: dollars('winAmount'),
            add_to_kitty: document.getElementById('winToKitty').checked,
          },
        });
        lastWinningId = out.winning.id;
        document.getElementById('announceBtn').disabled = false;
        return out;
      },
      (o) => `Winnings confirmed (${money(o.winning.amount_cents)}) — you can announce it below`,
      { rerender: false }));

    on('announceBtn', () => act('winMsg',
      () => api('/admin/winnings/announce', { method: 'POST', body: { winning_id: lastWinningId } }),
      (o) => `Announced to ${o.emailed} member(s)`));

    on('setBtn', () => act('setMsg',
      () => api('/admin/settings', {
        method: 'PATCH',
        body: {
          weekly_charge_cents: dollars('setWeekly'),
          charge_on_publish: document.getElementById('setCharge').checked,
          owing_threshold_cents: dollars('setThreshold'),
        },
      }),
      () => 'Settings saved'));

    on('remindersBtn', () => act('setMsg',
      () => api('/admin/reminders/run', { method: 'POST' }),
      (o) => `Reminders: ${o.eligible} eligible, ${o.sent} sent (already-reminded members skipped)`));
  };

  // ---------- boot ----------
  render();
})();
