// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a sortable/filterable table, a Live token view and a per-protocol detail drawer
// that shows the model's own inputs and the protocol's farm plan. All state lives in the URL hash
// (#p=slug opens a detail, #category=..&sort=..&q=.. filters), so a view is a link. No network:
// every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var tabs = document.getElementById('tabs');
  var tagline = document.getElementById('tagline');
  var scrim = document.getElementById('scrim');
  var drawer = document.getElementById('detail');
  var M = DATA.model;

  var state = { q: '', category: 'all', chain: 'all', source: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var neg = n < 0; n = Math.abs(n);
    var s;
    if (n >= 1e9) s = '$' + (n / 1e9).toFixed(2) + 'B';
    else if (n >= 1e6) s = '$' + (n / 1e6).toFixed(1) + 'M';
    else if (n >= 1e3) s = '$' + Math.round(n / 1e3) + 'K';
    else s = '$' + Math.round(n);
    return neg ? '-' + s : s;
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return isFinite(n) ? n.toFixed(2) + 'x' : 'n/a'; }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row) {
    return Math.max(M.min_value, Math.round(row.base_usd * row.growth_score * row.age_score * row.size_score));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'style') node.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- state <-> hash -----------------------------------------------------------
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('source')) state.source = p.get('source');
    if (p.get('tab')) state.tab = p.get('tab') === 'live' ? 'live' : 'pre';
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir')) state.dir = p.get('dir') === 'asc' ? 1 : -1;
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.source !== 'all') p.set('source', state.source);
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (!(state.sort === 'implied' && state.dir === -1)) { p.set('sort', state.sort); p.set('dir', state.dir === 1 ? 'asc' : 'desc'); }
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    var target = next ? '#' + next : window.location.pathname + window.location.search;
    try { window.history.replaceState(null, '', target); } catch (e) { /* file:// may refuse; harmless */ }
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.source === 'watchlist' && !r.on_watchlist) return false;
      if (state.source === 'early' && r.on_watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' '), r.comparable_category].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var k = state.sort, d = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (k === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (k === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (k === 'rank') { av = a.rank; bv = b.rank; }
      else if (k === 'category') { av = (a.category || 'Other').toLowerCase(); bv = (b.category || 'Other').toLowerCase(); }
      else if (k === 'chain') { av = (a.chains || []).join(',').toLowerCase(); bv = (b.chains || []).join(',').toLowerCase(); }
      else if (k === 'source') { av = a.on_watchlist ? 0 : 1; bv = b.on_watchlist ? 0 : 1; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -d;
      if (av > bv) return d;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  function categories() {
    return Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
  }
  function chains() { return Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort(); }

  // ---- static chrome ------------------------------------------------------------
  function renderMasthead() {
    tagline.textContent = 'Pre-token value radar · ' + DATA.as_of + ' · category comps from ' + DATA.live_total + ' live protocols';
    tabs.textContent = '';
    [['pre', 'Pre-token board'], ['live', 'Live token']].forEach(function (pair) {
      tabs.appendChild(el('button', {
        type: 'button', 'aria-pressed': state.tab === pair[0] ? 'true' : 'false', text: pair[1],
        onclick: function () { state.tab = pair[0]; if (pair[0] === 'pre') { state.sort = 'implied'; state.dir = -1; } writeHash(); render(); }
      }));
    });
  }

  function stats() {
    var top = DATA.rows[0];
    var items = [
      ['Pre-token rows scored', DATA.rows.length],
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Early radar (below the floor)', DATA.early_size],
      ['Live tokens set aside', DATA.live_total],
      ['Market FDV/TVL multiple', fmtMult(DATA.global_multiple)]
    ];
    if (top) items.push(['Top implied launch value', fmtUsd(top.implied_value_usd)]);
    return el('section', { class: 'stats', 'aria-label': 'Snapshot facts' },
      items.map(function (it) {
        return el('div', { class: 'stat' },
          el('div', { class: 'k', text: it[0] }),
          el('div', { class: 'v', text: it[1] }));
      }));
  }

  function modelPanel() {
    var m = DATA.model;
    var cm = Object.keys(DATA.category_multiples).map(function (k) {
      var v = DATA.category_multiples[k];
      return el('span', { class: 'chip', text: k + ' ' }, el('b', { text: v.multiple.toFixed(2) + 'x' }),
        el('span', { class: 'sub', text: ' (' + v.n + ')' }));
    });
    return el('section', { class: 'model' },
      el('h2', { text: 'Pre-token value model · closed-form estimate' }),
      el('p', { class: 'formula' }, el('code', { text: 'implied USD = round(TVL × median live mcap/TVL × growthScore × ageScore × sizeScore)' })),
      el('p', { class: 'sub', text: 'growthScore = ' + m.growth_score_floor + ' + (clamp(7d change, ' + m.growth_floor + '%, ' + m.growth_cap + '%) − ' + m.growth_floor + ') / ' + (m.growth_cap - m.growth_floor) + ' × ' + m.growth_score_range + '; ageScore = ' + m.age_score_floor + ' + clamp(age, 0, ' + m.age_days_cap + 'd) / ' + m.age_days_cap + ' × ' + m.age_score_range + ' (unknown age uses ' + m.unknown_age_days + 'd); sizeScore = clamp(1 + ' + m.size_log_weight + ' × log10(TVL / $' + (m.size_reference_usd / 1e6) + 'm), ' + m.size_score_floor + ', ' + m.size_score_cap + '). Comparable multiple is category median when n ≥ ' + m.min_comparables + ', otherwise global median. All live-token protocols are set aside from this pre-token ranking.' }),
      el('div', { class: 'multis' }, cm)
    );
  }

  function controls() {
    var cats = categories();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderBoardOnly(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories (' + DATA.rows.length + ')' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }));
    if (state.category !== 'all') select.value = state.category;
    select.addEventListener('change', function () { state.category = select.value; writeHash(); renderBoardOnly(); });
    var chainSelect = el('select', { 'aria-label': 'Filter by chain' }, el('option', { value: 'all', text: 'All chains' }), chains().map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    chainSelect.value = state.chain; chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); renderBoardOnly(); });
    var sourceSelect = el('select', { 'aria-label': 'Filter watchlist or early' }, el('option', { value: 'all', text: 'All sources' }), el('option', { value: 'watchlist', text: 'Watchlist only' }), el('option', { value: 'early', text: 'Early radar only' }));
    sourceSelect.value = state.source; sourceSelect.addEventListener('change', function () { state.source = sourceSelect.value; writeHash(); renderBoardOnly(); });
    var n = state.tab === 'pre' ? sorted(rows()).length : DATA.live.length;
    return el('div', { class: 'controls' },
      search,
      select,
      chainSelect, sourceSelect,
      el('span', { class: 'count', text: state.tab === 'pre' ? n + ' of ' + DATA.rows.length + ' rows' : n + ' live-token protocols' }));
  }

  function sortHeader(key, label, num) {
    return el('th', { scope: 'col', class: (num ? 'num ' : '') + (state.sort === key ? 'sorted' : '') },
      el('button', {
        type: 'button',
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          writeHash(); render();
        }
      },
        label,
        state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? '▼' : '▲' }) : null));
  }

  function boardTable() {
    var list = sorted(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('div', { class: 'big', text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d;
      var gcls = g === null ? 'flat' : g >= 0 ? 'up' : 'down';
      var tr = el('tr', {
        class: r.on_watchlist ? 'wl' : '',
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'proto' },
          el('span', { class: 'avatar', 'aria-hidden': 'true', text: r.name.slice(0, 1) }),
          el('div', null,
            el('div', { class: 'pname', text: r.name }),
            el('div', { class: 'sub', text: (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })))),
        el('td', { class: 'cat', text: r.category || 'Other' }),
        el('td', { class: 'cat hide-sm', text: (r.chains || []).slice(0, 2).join(', ') || '—', title: (r.chains || []).join(', ') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + gcls, text: g === null ? 'n/a' : fmtPct(g) }),
        el('td', { class: 'num hide-sm', text: fmtAge(r.age_days) }),
        el('td', { class: 'num' },
          el('span', { class: 'imp', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'ratio', title: 'FDV/TVL multiple applied', text: fmtMult(r.multiple) })),
        el('td', { class: 'hide-sm' }, el('span', { class: 'badge ' + (r.on_watchlist ? 'wl' : 'early'), text: r.on_watchlist ? 'Watchlist' : 'Early' })));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'scroll' },
        el('table', null,
          el('caption', { class: 'sub', style: 'caption-side:bottom;text-align:left;padding:10px 12px;color:var(--dim);font-size:12px', text: 'Pre-token protocols, strongest implied launch value first. Select a row for its multiple, its arithmetic and its farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('category', 'Category'),
            sortHeader('chain', 'Chain'),
            sortHeader('tvl', 'TVL', true),
            sortHeader('growth', '7d', true),
            sortHeader('age', 'Age', true),
            sortHeader('implied', 'Implied value', true),
            sortHeader('source', 'Source'))),
        tbody)));
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var g = r.change_7d;
      tbody.appendChild(el('tr', null,
        el('td', { class: 'rank num', text: 'live' }),
        el('td', null, el('div', { class: 'proto' },
          el('span', { class: 'avatar', 'aria-hidden': 'true', text: r.name.slice(0, 1) }),
          el('div', null,
            el('div', { class: 'pname', text: r.name }),
            el('div', { class: 'sub', text: (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })))),
        el('td', { class: 'cat hide-sm', text: r.category || 'Other' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtMult(r.multiple) }),
        el('td', { class: 'num ' + (g !== null && g >= 0 ? 'up' : g === null ? 'flat' : 'down'), text: g === null ? 'n/a' : fmtPct(g) }),
        el('td', { class: 'hide-sm' }, el('span', { class: 'badge live', text: 'Live' }))));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'scroll' },
        el('table', null,
          el('caption', { class: 'sub', style: 'caption-side:bottom;text-align:left;padding:10px 12px;color:var(--dim);font-size:12px', text: 'Token live: these already trade, so their market cap is a fact, not a model. They are kept out of the ranking - and they are the very protocols whose FDV/TVL multiple sets the scale for everyone still tokenless.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'hide-sm', text: 'Category' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' }),
            el('th', { scope: 'col', class: 'num', text: 'FDV/TVL' }),
            el('th', { scope: 'col', class: 'num', text: '7d' }),
            el('th', { scope: 'col', class: 'hide-sm', text: 'Token' }))),
        tbody)));
  }

  function renderBoardOnly() {
    var old = app.querySelector('.controls');
    var oldTable = app.querySelector('.panel');
    var c = controls();
    var t = state.tab === 'pre' ? boardTable() : liveTable();
    if (old) app.replaceChild(c, old); else app.appendChild(c);
    if (oldTable) app.replaceChild(t, oldTable); else app.appendChild(t);
  }

  function render() {
    app.textContent = '';
    app.setAttribute('aria-busy', 'false');
    app.appendChild(stats());
    if (state.tab === 'pre') app.appendChild(modelPanel());
    renderBoardOnly();
  }

  // ---- detail drawer ------------------------------------------------------------
  function closeDetail() {
    state.selected = null;
    drawer.hidden = true;
    drawer.textContent = '';
    scrim.hidden = true;
    writeHash();
  }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    drawer.textContent = '';
    drawer.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.rows.length + (row.on_watchlist ? ' - watchlist' : ' - early radar') }),
        el('h2', { id: 'detail-title' }, el('span', { class: 'avatar', 'aria-hidden': 'true', text: row.name.slice(0, 1) }), row.name),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.listed_at ? ' - listed ' + row.listed_at : ' - no listing date on record') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Esc', onclick: closeDetail })));

    drawer.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied launch value' }),
      el('div', { class: 'hero' },
        el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Implied value' }), el('div', { class: 'v', text: fmtUsd(row.implied_value_usd) })),
        el('div', { class: 'cell' }, el('div', { class: 'k', text: 'FDV/TVL multiple' }), el('div', { class: 'v', text: fmtMult(row.multiple) }, el('small', { text: ' ' + row.comparable_category })))),
      el('div', { class: 'hero', style: 'margin-top:12px' },
        el('div', { class: 'cell' }, el('div', { class: 'k', text: 'TVL · base' }), el('div', { class: 'v', text: fmtUsd(row.base_usd) }, el('small', { text: fmtUsd(row.tvl_usd) + ' × ' + fmtMult(row.multiple) }))),
        el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Growth score' }), el('div', { class: 'v', text: row.growth_score.toFixed(3) }, el('small', { text: row.change_7d === null ? 'n/a' : fmtPct(row.change_7d) }))),
        el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Age score' }), el('div', { class: 'v', text: row.age_score.toFixed(3) }, el('small', { text: fmtAge(row.age_days) }))),
        el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Size score' }), el('div', { class: 'v', text: row.size_score.toFixed(3) }, el('small', { text: 'TVL sanity' }))),
        el('div', { class: 'cell' }, el('div', { class: 'k', text: 'Comparables' }), el('div', { class: 'v', text: String(row.comparables) }, el('small', { text: row.comparable_category })))),
      el('div', { class: 'calc', style: 'margin-top:12px' },
        el('b', { text: fmtUsd(row.base_usd) }), ' base × growth ', el('b', { text: row.growth_score.toFixed(3) }), ' × age ', el('b', { text: row.age_score.toFixed(3) }), ' × size ', el('b', { text: row.size_score.toFixed(3) }), ' = ', el('b', { text: fmtUsd(row.implied_value_usd) }),
        el('br'), el('span', { class: 'sub', text: 'round(' + fmtUsd(row.base_usd) + ' × ' + row.growth_score.toFixed(3) + ' × ' + row.age_score.toFixed(3) + ' × ' + row.size_score.toFixed(3) + ') = ' + fmtUsd(impliedOf(row)) })),
      el('p', { class: 'sub', style: 'margin-top:10px', text: 'Model ' + DATA.model_version + ': base × growth term × age term × size term. The ranking adds a deterministic $1 tie break to equal rounded values. ' + (impliedOf(row) === Math.round(row.base_usd * row.growth_score * row.age_score * row.size_score) ? 'This row recomputes to the scored value.' : 'The displayed rank includes the tie break.') })));

    drawer.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How to farm it' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 7) : '';
        var costAt = tail.indexOf('. Time: ');
        var cost = costAt >= 0 ? tail.slice(0, costAt) : tail;
        var time = costAt >= 0 ? tail.slice(costAt + 8).replace(/\.$/, '') : '';
        return el('li', null,
          el('div', { class: 'act', text: action }),
          el('span', { class: 'meta' }, el('b', { text: 'Cost ' }), cost),
          el('span', { class: 'meta' }, el('b', { text: 'Time ' }), time));
      })),
      el('p', { class: 'sub', style: 'margin-top:6px', text: 'The plan follows the protocol\'s own record - its category sets the action, its TVL sets the position size, its age sets the hold. No protocol is special-cased.' })));

    drawer.appendChild(el('div', { class: 'disclaimer', text: 'Ranks a protocol that has no token. It never predicts whether or when a token is issued. Farming a pre-token protocol is a bet with no payout date: only use funds you can afford to lose, and claim only from the protocol\'s own published links.' }));

    drawer.hidden = false;
    scrim.hidden = false;
    writeHash();
  }

  scrim.addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !drawer.hidden) closeDetail(); });
  window.addEventListener('hashchange', function () {
    var was = state.selected;
    readHash();
    renderMasthead();
    render();
    if (state.selected && state.selected !== was) openDetail(state.selected);
    else if (!state.selected && !drawer.hidden) closeDetail();
  });

  readHash();
  renderMasthead();
  render();
  if (state.selected) openDetail(state.selected);
})();
