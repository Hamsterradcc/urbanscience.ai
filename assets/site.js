/* Urban Science AI Lab - shared page behaviour (no dependencies):
   1. example mode (?src=example) keeps src=example on every link to a page of this site or of the network;
   2. the mobile menu closes with Escape, with a click outside, and when the window grows. */
(function () {
  var example = new URLSearchParams(location.search).get('src') === 'example';
  var NETWORK_HOSTS = ['citycomputingcollective.com', 'xurbanai.com', 'urbanprobe.com'];
  function link(href) {
    if (!example || !href || href.charAt(0) === '#') return href;
    var u;
    try { u = new URL(href, location.href); } catch (e) { return href; }
    if (!/^https?:$/.test(u.protocol)) return href;
    if (u.origin !== location.origin && NETWORK_HOSTS.indexOf(u.hostname) < 0) return href;
    if (!/(\.html|\/)$/.test(u.pathname)) return href;
    if (u.searchParams.has('src')) return href;
    var i = href.indexOf('#');
    var hash = i >= 0 ? href.slice(i) : '';
    var bare = i >= 0 ? href.slice(0, i) : href;
    return bare + (bare.indexOf('?') >= 0 ? '&' : '?') + 'src=example' + hash;
  }
  function rewrite(root) {
    if (!example) return;
    (root || document).querySelectorAll('a[href]').forEach(function (a) {
      var h = a.getAttribute('href');
      var n = link(h);
      if (n !== h) a.setAttribute('href', n);
    });
  }
  window.SiteLinks = { example: example, link: link, rewrite: rewrite };
  if (example) {
    var run = function () {
      rewrite(document);
      // links added later (the follow dialog, lists drawn by other scripts)
      new MutationObserver(function (list) {
        list.forEach(function (m) {
          m.addedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'A') { var h = n.getAttribute('href'), x = link(h); if (x !== h) n.setAttribute('href', x); }
            else if (n.querySelectorAll) rewrite(n);
          });
        });
      }).observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  }
})();

(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;
  function setOpen(open) {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function isOpen() { return nav.classList.contains('open'); }
  toggle.addEventListener('click', function () {
    var open = !isOpen();
    setOpen(open);
    // the menu comes before the button in the page, so move focus into it for keyboard and screen reader users
    if (open) { var first = nav.querySelector('a'); if (first) first.focus(); }
  });
  nav.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a')) setOpen(false);
  });
  // Escape closes the menu and puts focus back on the button
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !isOpen()) return;
    setOpen(false);
    toggle.focus();
  });
  // a click or tap outside the menu closes it
  document.addEventListener('click', function (e) {
    if (isOpen() && !nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
  // a wider window shows the full menu, so reset the state
  if (window.matchMedia) {
    var wide = window.matchMedia('(min-width: 721px)');
    var reset = function (m) { if (m.matches) setOpen(false); };
    if (wide.addEventListener) wide.addEventListener('change', reset); else if (wide.addListener) wide.addListener(reset);
  }
})();
