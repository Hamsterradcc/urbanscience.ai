/* Urban Science AI Lab - live view of the network.
   Normally reads data/activity.json, which scripts/build_network.py refreshes every few hours from the public data of the
   City Computing Collective, XUrbanAI and UrbanProbe. If that file is missing, or when ?src=example is in the address, it
   builds the same items in the browser from the sites' own files (all served with open CORS).
   data/network.json maps research directions to the shared research themes.
   Other scripts use window.NET (ready, kindLabel, SITES). Example-mode link rewriting lives in site.js (window.SiteLinks). */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const example = params.get('src') === 'example';
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const SITES = {
    ccc: { name: 'City Computing Collective', short: 'Collective', base: LOCAL ? '/ccc' : 'https://citycomputingcollective.com' },
    xurbanai: { name: 'XUrbanAI', short: 'XUrbanAI', base: LOCAL ? '/xurbanai' : 'https://xurbanai.com' },
    urbanprobe: { name: 'UrbanProbe', short: 'UrbanProbe', base: LOCAL ? '/urbanprobe' : 'https://urbanprobe.com' },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); }).catch(() => null);
  const ex = example ? 'examples/' : '';
  const qs = example ? '&src=example' : '';
  const day = (s) => String(s || '').slice(0, 10);

  const { link, rewrite } = window.SiteLinks || { link: (h) => h, rewrite: () => {} };

  /* The same items scripts/build_network.py writes, built here from raw site data. */
  function fromRaw(tax, disc, regs) {
    const themes = ((tax && tax.themes) || []).map((t) => ({ slug: t.slug, label: t.label }));
    const bySlug = Object.fromEntries(themes.map((t) => [t.label, t.slug]));
    const known = new Set(themes.map((t) => t.slug));
    const items = [], upcoming = [];
    const stats = { discussions: 0, people: 0, releases: { xurbanai: 0, urbanprobe: 0 } };
    ((disc && disc.discussions) || []).forEach((d) => {
      stats.discussions += 1;
      if (d.category === 'introductions' && d.directory) stats.people += 1;
      const slugs = (d.themes || []).map((l) => bySlug[l]).filter(Boolean);
      const url = `${SITES.ccc.base}/post.html?n=${d.number}${qs}`;
      items.push({ id: `ccc-${d.number}`, source: 'ccc', kind: 'discussion', title: d.title, url, date: d.createdAt, themes: slugs, label: d.categoryName || d.category, summary: d.excerpt || '' });
      const f = d.fields || {};
      if (d.category === 'opportunities' && f.deadline) upcoming.push({ kind: 'deadline', title: d.title, url, date: f.deadline, label: f.kind || 'Open call', themes: slugs });
      if (d.category === 'events-meetups' && f.date) upcoming.push({ kind: 'event', title: d.title, url, date: f.date, label: f.format || 'Event', themes: slugs });
    });
    regs.forEach(({ site, data, schema }) => {
      if (!data || !schema) return;
      (schema['x-registries'] || []).forEach((r) => {
        const entries = data[r.key] || [];
        entries.forEach((e) => {
          const slugs = (e.themes || []).filter((s) => known.has(s));
          const url = `${SITES[site].base}/entry.html?registry=${r.key}&id=${e.id}${qs}`;
          if (e.status === 'released') {
            stats.releases[site] += 1;
            const log = (e.changelog && e.changelog.length ? e.changelog : [{ version: e.version, date: e.released, note: '' }])
              .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.version).localeCompare(String(b.version)));
            log.forEach((c, n) => {
              if (!c.date) return;
              items.push({ id: `${site}-${r.key}-${e.id}-v${c.version}`, source: site, kind: 'release', title: `${e.title} v${c.version}`, url, date: c.date, themes: slugs, label: r.singular, summary: e.summary || '', version: String(c.version), first: n === 0, note: c.note || '' });
            });
          } else if (e.status === 'deprecated') {
            const when = e.updated || e.released;
            if (!when) return;
            const next = entries.find((x) => x.id === e.replaced_by);
            items.push({ id: `${site}-${r.key}-${e.id}-deprecated`, source: site, kind: 'deprecation', title: `Deprecated: ${e.title}`, url, date: when, themes: slugs, label: r.singular, summary: `This ${r.singular} is no longer maintained.${next ? ` It was replaced by ${next.title}.` : ''}` });
          }
        });
      });
    });
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id)));
    upcoming.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { themes, items, upcoming, stats, total: items.length };
  }

  const loadLive = () => Promise.all([
    get(`${SITES.ccc.base}/data/taxonomy.json`),
    get(`${SITES.ccc.base}/data/${ex}discussions.json`),
    ...['xurbanai', 'urbanprobe'].flatMap((k) => [get(`${SITES[k].base}/data/${ex}registry.json`), get(`${SITES[k].base}/data/schema.json`)]),
  ]).then(([tax, disc, xData, xSchema, pData, pSchema]) => fromRaw(tax, disc, [
    { site: 'xurbanai', data: xData, schema: xSchema }, { site: 'urbanprobe', data: pData, schema: pSchema }]));

  const loadBuilt = () => get('data/activity.json').then((a) => (a && Array.isArray(a.items) && a.stats ? a : null));

  const kindLabel = (i) => (i.kind === 'discussion' ? `Discussion · ${i.label}`
    : i.kind === 'release' ? `${i.first ? 'New' : 'Updated'} ${i.label} · v${i.version}`
      : `Deprecated ${i.label}`);

  const ready = Promise.all([get('data/network.json'), example ? loadLive() : loadBuilt().then((a) => a || loadLive())])
    .then(([map, data]) => ({ map: map || { directions: {}, labels: {} }, ...(data || { themes: [], items: [], upcoming: [], stats: { discussions: 0, people: 0, releases: {} }, total: 0 }) }));
  window.NET = { ready, link, rewrite, kindLabel, SITES, example, esc };

  ready.then(({ map, items, stats, upcoming }) => {
    // research directions
    document.querySelectorAll('[data-direction]').forEach((el) => {
      const key = el.dataset.direction;
      const slugs = map.directions[key] || [];
      const mine = items.filter((i) => i.themes.some((s) => slugs.includes(s)));
      if (!mine.length) return;
      const pick = (f) => mine.filter(f).slice(0, 3).map((i) => `<li><a href="${esc(i.url)}"><span>${esc(SITES[i.source].short)} · ${esc(kindLabel(i))}</span>${esc(i.title)}</a></li>`);
      const list = el.querySelector('[data-slot="activity"]');
      list.innerHTML = [...pick((i) => i.kind !== 'discussion'), ...pick((i) => i.kind === 'discussion')].join('');
      list.hidden = false;
      const counts = Object.keys(SITES).map((k) => [k, mine.filter((i) => i.source === k).length]).filter(([, n]) => n > 0);
      el.querySelector('[data-slot="count"]').innerHTML = 'See all: ' + counts.map(([k, n]) =>
        `<a href="activity.html?direction=${encodeURIComponent(key)}&amp;source=${k}">${n} from ${esc(SITES[k].short)}</a>`).join(' · ');
      el.querySelector('[data-slot="count"]').hidden = false;
      const empty = el.querySelector('[data-slot="empty"]');
      if (empty) empty.hidden = true;
    });

    // home page: counts across the network
    const box = document.querySelector('[data-network-stats]');
    if (box) {
      const today = new Date().toISOString().slice(0, 10);
      const open = (upcoming || []).filter((u) => day(u.date) >= today).length;
      const rel = stats.releases || {};
      const cells = [
        ['XUrbanAI releases', rel.xurbanai || 0, `${SITES.xurbanai.base}/index.html`],
        ['UrbanProbe releases', rel.urbanprobe || 0, `${SITES.urbanprobe.base}/index.html`],
        ['Discussions', stats.discussions || 0, `${SITES.ccc.base}/community.html`],
        ['People listed', stats.people || 0, `${SITES.ccc.base}/people.html`],
        ['Open calls & events', open, `${SITES.ccc.base}/opportunities.html`],
      ];
      if (cells.some(([, n]) => n > 0)) {
        box.querySelector('[data-slot="cells"]').innerHTML = cells.map(([label, n, href]) => `<a class="net-stat" href="${esc(href)}"><strong>${n}</strong><span>${label}</span></a>`).join('');
        box.querySelector('[data-slot="cells"]').hidden = false;
        const empty = box.querySelector('[data-slot="empty"]');
        if (empty) empty.hidden = true;
        const follow = box.querySelector('[data-slot="follow"]');
        if (follow) follow.hidden = false;
      }
    }
    rewrite(document);
  });

})();
