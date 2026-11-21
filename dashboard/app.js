// Yield Radar dashboard: renders window.RADAR (written by main.ts) with no network.
// State lives in the URL (?family= &chain= &q= &sort= &watchlist=1 &detail=<slug>) so a
// filtered view or a detail view is a link, not a click path. No fetch, no external requests.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.body.innerHTML = '<p style="padding:30px">No radar data loaded.</p>'; return; }

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n >= 1e9) return '$' + trim2(n / 1e9) + 'B';
    if (n >= 1e6) return '$' + trim2(n / 1e6) + 'M';
    if (n >= 1e3) return '$' + trim2(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function trim2(n) { return (Math.round(n * 100) / 100).toString(); }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="dim">—</span>';
    var c = v >= 0 ? 'up' : 'down';
    return '<span class="' + c + '">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function age(d) { return d === null || d === undefined ? '—' : d + 'd'; }

  // ---- state from the URL -----------------------------------------------
  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    family: params.get('family') || '',
    chain: params.get('chain') || '',
    watchlist: params.get('watchlist') === '1',
    sort: params.get('sort') || 'implied',
    detail: params.get('detail') || '',
  };
  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.family) p.set('family', state.family);
    if (state.chain) p.set('chain', state.chain);
    if (state.watchlist) p.set('watchlist', '1');
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.detail) p.set('detail', state.detail);
    var q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
  }

  // ---- header + model ----------------------------------------------------
  var top = D.rows[0];
  $('meta').innerHTML =
    'Snapshot <b>' + esc(D.as_of) + '</b> &middot; <b>' + D.board_size + '</b> protocols ranked &middot; ' +
    '<b>' + D.watchlist_size + '</b> on the watchlist &middot; top implied value <b>' + money(top.implied_value_usd) + '</b>';
  $('asof').textContent = D.as_of;
  $('model').innerHTML =
    '<h2>The value model <span class="sub">yield-quality-1 — stated, not hidden</span></h2>' +
    '<p class="formula">' + esc(D.formula) + '</p>' +
    '<div class="chips">' + D.families.map(function (f) {
      return '<span class="chip">' + esc(f.family) + ': <b>' + f.multiple.toFixed(3) + '×</b> <span>median mcap/TVL of ' + f.live_n + ' live tokens</span></span>';
    }).join('') + '<span class="chip">Fallback (no live family): <b>' + D.overall_multiple.toFixed(3) + '×</b></span></div>' +
    '<p class="note">Fee multiple: the median market-cap-to-TVL of live-token protocols in the same family, computed from this snapshot and clamped to 0.05–3.00×. Growth: 1 + 0.5 × 7d change, clamped to −25%…+100%. Maturity: 0.90 under 90 days, 1.00 under a year, 1.08 under two years, 1.15 beyond. Chains: +0.04 per extra chain, capped at +0.20.</p>';

  // ---- chains for the filter ---------------------------------------------
  var chainCount = {};
  D.rows.forEach(function (r) { r.chains.forEach(function (c) { chainCount[c] = (chainCount[c] || 0) + 1; }); });
  var chainSel = $('chain');
  Object.keys(chainCount).sort(function (a, b) { return chainCount[b] - chainCount[a]; }).slice(0, 24).forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c + ' (' + chainCount[c] + ')';
    chainSel.appendChild(o);
  });

  // ---- filtering + sorting ------------------------------------------------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.watchlist && !r.watchlist) return false;
      if (state.family === '__other') { if (r.family !== null) return false; }
      else if (state.family && r.family !== state.family) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
    }[state.sort] || function (a, b) { return a.rank - b.rank; };
    return rows.slice().sort(by);
  }

  function renderBoard() {
    var rows = filtered();
    $('count').textContent = rows.length + ' of ' + D.board_size + ' protocols';
    $('board-sub').textContent = state.family ? '· ' + (state.family === '__other' ? 'Other' : state.family) : '';
    var tb = document.querySelector('#board tbody');
    tb.innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="r">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.family || '—') + '<br><span class="slug">' + esc(r.category || '') + '</span></td>' +
        '<td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + r.model.fee_multiple.toFixed(3) + '×</td></tr>';
    }).join('') || '<tr><td colspan="9">No protocol matches these filters.</td></tr>';
    tb.querySelectorAll('tr[data-slug]').forEach(function (tr) {
      tr.addEventListener('click', function () { selectDetail(tr.getAttribute('data-slug')); });
    });
  }

  // ---- detail view ---------------------------------------------------------
  function parseStep(s) {
    var ci = s.indexOf(' Cost: ');
    var ri = s.indexOf(' Risk: ');
    if (ci < 0 || ri < 0) return { action: s, cost: '', risk: '' };
    return { action: s.slice(0, ci).trim(), cost: s.slice(ci + 7, ri).trim(), risk: s.slice(ri + 7).trim() };
  }
  function selectDetail(slug) {
    state.detail = slug;
    syncUrl();
    renderDetail();
    var el = $('detail');
    if (el && !el.hidden) el.scrollIntoView({ block: 'start' });
  }
  function renderDetail() {
    var el = $('detail');
    var r = D.rows.find(function (x) { return x.slug === state.detail; });
    if (!r) { el.hidden = true; return; }
    el.hidden = false;
    var main = document.querySelector('main');
    if (main.firstChild !== el) main.insertBefore(el, main.firstChild);
    var m = r.model;
    el.innerHTML =
      '<button class="back" id="back">← Back to the board</button>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + ' <span class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'no category') + ' · ' + esc(r.family || 'outside the yield families') + (r.watchlist ? ' · on the watchlist' : '') + '</span></h2>' +
      '<div class="stats">' +
      '<div class="stat"><div class="k">Implied value</div><div class="v big">' + money(r.implied_value_usd) + '</div></div>' +
      '<div class="stat"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div></div>' +
      '<div class="stat"><div class="k">7d change</div><div class="v">' + (r.change_7d === null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</div></div>' +
      '<div class="stat"><div class="k">Age (listed)</div><div class="v">' + (r.age_days === null ? '—' : r.age_days + ' days') + '</div></div>' +
      '<div class="stat"><div class="k">Chains</div><div class="v">' + r.chains.length + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + '</div></div>' +
      '<div class="stat"><div class="k">Token</div><div class="v">records none</div></div>' +
      '</div>' +
      '<pre class="breakdown">' + money(r.tvl_usd) + ' TVL  ×  <b>' + m.fee_multiple.toFixed(3) + '</b> fee multiple (' + esc(r.family || 'fallback') + ')  ×  <b>' + m.growth_multiplier.toFixed(3) + '</b> growth (' + (m.growth_pct >= 0 ? '+' : '') + m.growth_pct.toFixed(1) + '% 7d)  ×  <b>' + m.maturity_multiplier.toFixed(2) + '</b> maturity  ×  <b>' + m.chain_multiplier.toFixed(2) + '</b> chains  =  <b>' + money(r.implied_value_usd) + '</b></pre>' +
      '<h2>Farm plan — 5 steps</h2>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) {
        var p = parseStep(s);
        return '<li>' + esc(p.action) +
          '<div class="tags"><span class="tag-cost">Cost: ' + esc(p.cost) + '</span>' +
          (p.risk ? '<span class="tag-risk">Risk: ' + esc(p.risk) + '</span>' : '') + '</div></li>';
      }).join('') + '</ol>' +
      '<p class="note">Same formula scores every row on this board; no protocol name is ever special-cased. The plan is a starting point — read each step&rsquo;s risk note before you put money in.</p>';
    $('back').addEventListener('click', function () {
      state.detail = '';
      syncUrl();
      renderDetail();
    });
  }

  // ---- live comparables ----------------------------------------------------
  document.querySelector('#live tbody').innerHTML = D.live.map(function (p) {
    return '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.family || '—') + '</td><td>' + p.chains + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num"><b>' + p.mcap_tvl.toFixed(3) + '×</b></td><td class="num">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  // ---- method --------------------------------------------------------------
  $('method').innerHTML =
    '<p><b>Scope.</b> The board ranks ' + D.board_size + ' protocols: all ' + D.watchlist_size + ' on the snapshot&rsquo;s watchlist, plus the pre-token protocols in the five yield families (Lending, Yield, Trading, Vaults, StableRWA) below the $50M floor. A protocol counts as pre-token when the snapshot records no token for it — no market cap, no CoinGecko id, no symbol.</p>' +
    '<p><b>Why fee multiples differ.</b> Live-token markets pay very different prices per TVL dollar: Trading protocols median ' + famMult('Trading') + '×, Stable/RWA ' + famMult('StableRWA') + '×, Lending ' + famMult('Lending') + '×, Yield ' + famMult('Yield') + '×, Vaults ' + famMult('Vaults') + '×. A vault curator moving billions earns thin pass-through fees, so its launch is worth less per TVL dollar than a perps exchange with the same TVL. The multiples come from the live tokens in this same snapshot, so the model re-runs on any new snapshot.</p>' +
    '<p><b>What the numbers cannot do.</b> The snapshot carries no fees, no points program and no airdrop flag, so the fee multiple is a market proxy, not a fee measurement. Growth is a single 7-day window. Treat the ranking as a shortlist to research, not a verdict.</p>';
  function famMult(f) {
    var row = D.families.find(function (x) { return x.family === f; });
    return row ? row.multiple.toFixed(3) : '—';
  }

  // ---- controls --------------------------------------------------------------
  $('q').value = state.q;
  $('family').value = state.family;
  $('chain').value = state.chain;
  $('watchlist').checked = state.watchlist;
  $('sort').value = state.sort;
  $('q').addEventListener('input', function (e) { state.q = e.target.value; syncUrl(); renderBoard(); });
  $('family').addEventListener('change', function (e) { state.family = e.target.value; syncUrl(); renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; syncUrl(); renderBoard(); });
  $('watchlist').addEventListener('change', function (e) { state.watchlist = e.target.checked; syncUrl(); renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; syncUrl(); renderBoard(); });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      state.sort = th.getAttribute('data-sort');
      $('sort').value = state.sort;
      syncUrl();
      renderBoard();
    });
  });

  // ---- first paint -----------------------------------------------------------
  renderBoard();
  renderDetail();
  window.addEventListener('error', function (e) { document.title = 'ERROR: ' + (e.message || 'page error'); });
})();
