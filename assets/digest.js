/* Urban Science AI Lab - weekly digest page.
   Shows the digest named by ?w=YYYY-Www, or the latest one, with an archive list.
   Digests are written once a week by scripts/build_network.py. With ?src=example the files in data/examples/digests/ are used. */
(() => {
  'use strict';
  const root = document.getElementById('digest');
  if (!root) return;
  const params = new URLSearchParams(location.search);
  const example = params.get('src') === 'example';
  const dir = example ? 'data/examples/digests/' : 'data/digests/';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.json(); }).catch(() => null);
  const $ = (sel) => root.querySelector(sel);
  const fmt = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const SHORT = { ccc: 'Collective', xurbanai: 'XUrbanAI', urbanprobe: 'UrbanProbe' };
  const KIND = { new: 'New', updated: 'Updated', deprecated: 'Deprecated' };
  const link = (href) => (window.NET ? window.NET.link(href) : href);
  const page = (w) => link(`digest.html?w=${encodeURIComponent(w)}`);

  const list = (rows) => `<ul class="dg-list">${rows.join('')}</ul>`;
  const a = (it) => `<a href="${esc(link(it.url))}">${esc(it.title)}</a>`;

  function section(title, body) { return `<section class="dg-sec"><h3>${esc(title)}</h3>${body}</section>`; }

  function render(d) {
    const parts = [];
    if (d.discussions.length) {
      parts.push(section('New discussions', d.discussions.map((g) =>
        `<h4>${esc(g.category)}</h4>` + list(g.items.map((i) => `<li>${a(i)} <span class="dg-date">${esc(fmt(i.date))}</span></li>`))).join('')));
    }
    if (d.unanswered.length) {
      parts.push(section('Questions waiting for an answer', list(d.unanswered.map((i) => `<li>${a(i)} <span class="dg-date">asked ${esc(fmt(i.date))}</span></li>`))));
    }
    if (d.closing.length) {
      parts.push(section(`Open calls closing in the next ${d.closingDays} days`, list(d.closing.map((i) => `<li>${a(i)} <span class="dg-date">${esc(i.label)}, closes ${esc(fmt(i.date))}</span></li>`))));
    }
    if (d.events.length) {
      parts.push(section(`Events in the next ${d.eventDays} days`, list(d.events.map((i) => `<li>${a(i)} <span class="dg-date">${esc(fmt(i.date))}</span></li>`))));
    }
    if (d.releases.length) {
      parts.push(section('New and updated releases', list(d.releases.map((i) => `<li>${a(i)} <span class="dg-date">${esc(KIND[i.kind])} ${esc(i.label)} on ${esc(SHORT[i.source] || i.source)}, ${esc(fmt(i.date))}</span></li>`))));
    }
    const c = d.counts;
    $('#dg-body').innerHTML = `<header class="dg-head"><h2>Week ${esc(d.week.split('-W')[1])}, ${esc(d.week.split('-W')[0])}</h2>`
      + `<p>${esc(fmt(d.start))} to ${esc(fmt(d.end))}. ${esc(plural(c.discussions, 'new discussion', 'new discussions'))} and ${esc(plural(c.releases, 'release', 'releases'))}.</p></header>${parts.join('')}`;
    document.title = `Weekly digest ${d.week} — Urban Science AI Lab`;
  }

  get(dir + 'index.json').then(async (idx) => {
    const digests = (idx && idx.digests) || [];
    $('#dg-loading').hidden = true;
    if (!digests.length) {
      $('#dg-empty').hidden = false;
      return;
    }
    const wanted = params.get('w');
    const current = digests.find((d) => d.week === wanted) || digests[0];
    const data = await get(`${dir}${current.week}.json`);
    $('#dg-content').hidden = false;
    if (wanted && current.week !== wanted) $('#dg-note').hidden = false;
    if (data) render(data); else $('#dg-body').innerHTML = '<p>This digest could not be loaded. Try again later.</p>';
    $('#dg-archive-list').innerHTML = digests.map((d) =>
      `<li><a href="${esc(page(d.week))}"${d.week === current.week ? ' aria-current="page"' : ''}>${esc(d.week)}<span>${esc(fmt(d.start))} to ${esc(fmt(d.end))}</span></a></li>`).join('');
    if (window.NET) window.NET.rewrite(root);
  });
})();
