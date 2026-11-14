/* Urban Science AI Lab - activity page.
   Lists the items of data/activity.json (or, with ?src=example, items built from the example data of the three sites),
   filtered by site and theme. "Follow this view" opens the follow dialog for the feed that matches the filters. */
(() => {
  'use strict';
  const root = document.getElementById('activity');
  if (!root || !window.NET) return;
  const NET = window.NET;
  const { esc, SITES } = NET;
  const params = new URLSearchParams(location.search);
  const PAGE = 30;
  const $ = (sel) => root.querySelector(sel);
  const GITHUB = {
    ccc: ['https://github.com/citycomputingcollective/citycomputingcollective.github.io/discussions', 'discussions'],
    xurbanai: ['https://github.com/Hamsterradcc/xurbanai.com', 'releases'],
    urbanprobe: ['https://github.com/Hamsterradcc/urbanprobe.com', 'releases'],
  };
  const SITE_FEED = {
    ccc: 'https://citycomputingcollective.com/feeds/all.xml',
    xurbanai: 'https://xurbanai.com/feeds/releases.xml',
    urbanprobe: 'https://urbanprobe.com/feeds/releases.xml',
  };

  // "New since your last visit": a stored time, never required
  const KEY = 'usai:lastVisit';
  let previous = null;
  try { previous = localStorage.getItem(KEY); } catch (e) { /* storage blocked: show nothing */ }
  const stamp = () => { try { localStorage.setItem(KEY, new Date().toISOString()); } catch (e) { /* ignore */ } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') stamp(); });
  window.addEventListener('pagehide', stamp);

  const fmt = (s) => new Date(String(s).length === 10 ? s + 'T00:00:00Z' : s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  NET.ready.then((data) => {
    const { items, themes, map } = data;
    const labels = Object.fromEntries(themes.map((t) => [t.slug, t.label]));
    const dirs = (map && map.directions) || {};
    const dirLabels = (map && map.labels) || {};
    // own keys only: 'constructor' or '__proto__' in the address must not count as a site, theme or direction
    const has = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
    const pickParam = (name, ok) => (ok(params.get(name)) ? params.get(name) : '');
    const state = {
      source: pickParam('source', (v) => has(SITES, v)),
      theme: pickParam('theme', (v) => has(labels, v)),
      direction: pickParam('direction', (v) => has(dirs, v) && Array.isArray(dirs[v])),
      shown: PAGE,
    };
    const list = $('#act-list');
    let focusIndex = -1;

    const filtered = () => items.filter((i) => (!state.source || i.source === state.source)
      && (!state.theme || i.themes.includes(state.theme))
      && (!state.direction || i.themes.some((s) => dirs[state.direction].includes(s))));

    function followOptions() {
      // the direction and theme feeds cover all three sites, so say so when the list is filtered to one site
      const wide = state.source ? ` Your list shows only ${SITES[state.source].short}, but the feed includes all three sites.` : '';
      if (state.direction) return { title: dirLabels[state.direction] || state.direction, what: 'New discussions and releases on the themes of this research direction.' + wide, feed: `feeds/direction-${state.direction}.xml` };
      if (state.theme) return { title: labels[state.theme], what: 'New discussions and releases tagged with this theme, from all three sites.' + wide, feed: `feeds/theme-${state.theme}.xml` };
      if (state.source) {
        const [github, kind] = GITHUB[state.source];
        return { title: SITES[state.source].name, what: state.source === 'ccc' ? 'Every new discussion in the Collective.' : 'Every new release.', feed: SITE_FEED[state.source], github, githubKind: kind };
      }
      return { title: 'Everything in the network', what: 'Every new discussion and release from the three sites.', feed: 'feeds/network.xml' };
    }
    function syncFollow() {
      const btn = $('#act-follow');
      const o = followOptions();
      btn.setAttribute('data-follow-title', o.title);
      btn.setAttribute('data-follow-what', o.what);
      btn.setAttribute('data-follow-feed', o.feed);
      ['data-follow-github', 'data-follow-github-kind'].forEach((a) => btn.removeAttribute(a));
      if (o.github) { btn.setAttribute('data-follow-github', o.github); btn.setAttribute('data-follow-github-kind', o.githubKind); }
    }
    function syncUrl() {
      const p = new URLSearchParams(location.search);
      ['source', 'theme', 'direction'].forEach((k) => (state[k] ? p.set(k, state[k]) : p.delete(k)));
      const q = p.toString();
      try { history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash); } catch (e) { /* ignore */ }
    }

    function itemHtml(i) {
      const isNew = previous && i.date > previous;
      return `<li class="act-item"><div class="act-meta"><span class="act-src act-src-${esc(i.source)}">${esc(SITES[i.source].short)}</span>`
        + `<span class="act-kind">${esc(NET.kindLabel(i))}</span><time datetime="${esc(String(i.date).slice(0, 10))}">${esc(fmt(i.date))}</time>`
        + `${isNew ? '<span class="act-new">New</span>' : ''}</div>`
        + `<a class="act-title" href="${esc(i.url)}">${esc(i.title)}</a>`
        + (i.summary ? `<p class="act-sum">${esc(i.summary)}</p>` : '')
        + (i.themes.length ? `<ul class="act-themes" aria-label="Themes">${i.themes.map((s) => `<li>${esc(labels[s] || s)}</li>`).join('')}</ul>` : '')
        + '</li>';
    }

    function render(announce) {
      const all = filtered();
      const part = all.slice(0, state.shown);
      root.querySelectorAll('[data-chip]').forEach((b) => b.setAttribute('aria-pressed', String(state[b.dataset.chip] === b.dataset.value)));
      const dirBox = $('#act-direction');
      dirBox.hidden = !state.direction;
      if (state.direction) dirBox.querySelector('strong').textContent = dirLabels[state.direction] || state.direction;
      const nothing = !items.length;
      $('#act-filters').hidden = nothing;
      $('#act-empty-all').hidden = !nothing;
      $('#act-empty-filter').hidden = nothing || all.length > 0;
      $('#act-follow-wrap').hidden = nothing;
      list.innerHTML = part.map(itemHtml).join('');
      list.hidden = !part.length;
      const more = $('#act-more');
      more.hidden = all.length <= part.length;
      more.textContent = `Show more (${all.length - part.length} left)`;
      const fresh = previous ? all.filter((i) => i.date > previous).length : 0;
      $('#act-meta').textContent = nothing ? '' : `${plural(all.length, 'item', 'items')}${fresh ? ` · ${fresh} new since your last visit` : ''}`;
      if (announce) $('#act-status').textContent = `Showing ${plural(all.length, 'item', 'items')}`;
      syncFollow();
      NET.rewrite(root);
      if (focusIndex >= 0) {
        const links = list.querySelectorAll('.act-title');
        if (links[focusIndex]) links[focusIndex].focus();
        focusIndex = -1;
      }
    }

    root.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-chip]');
      if (chip) {
        const k = chip.dataset.chip;
        state[k] = state[k] === chip.dataset.value ? '' : chip.dataset.value;
        if (k === 'theme' && state.direction) state.direction = '';
        state.shown = PAGE;
        syncUrl();
        render(true);
        return;
      }
      if (e.target.closest('[data-clear-direction]')) {
        state.direction = ''; state.shown = PAGE; syncUrl(); render(true);
        $('[data-chip="source"][data-value=""]').focus();
        return;
      }
      if (e.target.closest('[data-clear]')) {
        state.source = ''; state.theme = ''; state.direction = ''; state.shown = PAGE; syncUrl(); render(true);
        $('[data-chip="source"][data-value=""]').focus();
        return;
      }
      if (e.target.closest('#act-more')) {
        focusIndex = state.shown;
        state.shown += PAGE;
        render(false);
      }
    });

    $('#act-loading').hidden = true;
    render(true);
  });
})();
