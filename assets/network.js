/* Urban Science AI Lab — live view of the network.
   Reads the public data of the City Computing Collective, XUrbanAI, and UrbanProbe (all served with open CORS)
   and shows, for each research direction, the discussions and releases in its themes.
   data/network.json maps directions to the shared research themes. Static links stay in the HTML. */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const example = params.get('src') === 'example';
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const SITES = {
    ccc: { name: 'City Computing Collective', base: LOCAL ? '/ccc' : 'https://citycomputingcollective.com' },
    xurbanai: { name: 'XUrbanAI', base: LOCAL ? '/xurbanai' : 'https://xurbanai.com' },
    urbanprobe: { name: 'UrbanProbe', base: LOCAL ? '/urbanprobe' : 'https://urbanprobe.com' },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = (url) => fetch(url, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(url); return r.json(); }).catch(() => null);
  const ex = example ? 'examples/' : '';
  const qs = example ? '&src=example' : '';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  const ready = Promise.all([
    get('data/network.json'),
    get(`${SITES.ccc.base}/data/taxonomy.json`),
    get(`${SITES.ccc.base}/data/${ex}discussions.json`),
    ...['xurbanai', 'urbanprobe'].flatMap((k) => [get(`${SITES[k].base}/data/${ex}registry.json`), get(`${SITES[k].base}/data/schema.json`)]),
  ]).then(([map, tax, disc, xData, xSchema, pData, pSchema]) => {
    const labelToSlug = Object.fromEntries(((tax && tax.themes) || []).map((t) => [t.label, t.slug]));
    const posts = ((disc && disc.discussions) || []).map((d) => ({ ...d, themeSlugs: (d.themes || []).map((l) => labelToSlug[l]).filter(Boolean) }));
    const releases = [];
    [['xurbanai', xData, xSchema], ['urbanprobe', pData, pSchema]].forEach(([k, data, schema]) => {
      if (!data || !schema) return;
      (schema['x-registries'] || []).forEach((r) => (data[r.key] || []).filter((e) => e.status === 'released').forEach((e) => releases.push({ site: k, reg: r, e })));
    });
    return { map: map || { directions: {} }, posts, releases, themes: (tax && tax.themes) || [] };
  });
  window.NET = { ready };

  ready.then(({ map, posts, releases, themes }) => {
    // research directions
    document.querySelectorAll('[data-direction]').forEach((el) => {
      const slugs = map.directions[el.dataset.direction] || [];
      const inPosts = posts.filter((d) => d.themeSlugs.some((s) => slugs.includes(s)));
      const inReleases = releases.filter(({ e }) => (e.themes || []).some((s) => slugs.includes(s)));
      const list = el.querySelector('[data-slot="activity"]');
      if (!inPosts.length && !inReleases.length) return;
      const items = [
        ...inReleases.sort((a, b) => String(b.e.updated || b.e.released).localeCompare(String(a.e.updated || a.e.released))).slice(0, 3).map(({ site, reg, e }) => ({
          kind: `${SITES[site].name} · ${reg.singular}`, title: e.title, href: `${SITES[site].base}/entry.html?registry=${reg.key}&id=${e.id}${qs}` })),
        ...inPosts.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 3).map((d) => ({
          kind: `Collective · ${d.categoryName}`, title: d.title, href: `${SITES.ccc.base}/post.html?n=${d.number}${qs}` })),
      ];
      el.querySelector('[data-slot="count"]').textContent = [inReleases.length ? plural(inReleases.length, 'release') : '', inPosts.length ? plural(inPosts.length, 'discussion') : ''].filter(Boolean).join(' · ');
      list.innerHTML = items.map((it) => `<li><a href="${esc(it.href)}"><span>${esc(it.kind)}</span>${esc(it.title)}</a></li>`).join('');
      list.hidden = false;
    });

    // index: network counts
    const stats = document.querySelector('[data-network-stats]');
    if (stats) {
      const isOpen = (d) => { const f = d.fields || {}; const day = f.deadline || f.date; return day && day >= new Date().toISOString().slice(0, 10); };
      const cells = [
        ['Releases', releases.length, `${SITES.xurbanai.base}/index.html`],
        ['Discussions', posts.length, `${SITES.ccc.base}/community.html`],
        ['People listed', posts.filter((d) => d.directory).length, `${SITES.ccc.base}/people.html`],
        ['Open calls & events', posts.filter((d) => ['opportunities', 'events-meetups'].includes(d.category) && isOpen(d)).length, `${SITES.ccc.base}/opportunities.html`],
      ];
      if (cells.some(([, n]) => n > 0)) {
        stats.querySelector('[data-slot="cells"]').innerHTML = cells.map(([label, n, href]) => `<a class="net-stat" href="${esc(href + (example ? '?src=example' : ''))}"><strong>${n}</strong><span>${label}</span></a>`).join('');
        stats.hidden = false;
      }
    }
  });
})();
