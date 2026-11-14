#!/usr/bin/env python3
"""Build the network activity data and feeds for urbanscience.ai.

Reads the public data of the City Computing Collective (CCC), XUrbanAI and UrbanProbe and writes:

  data/activity.json            newest 200 items, plus counts the home page shows
  data/digests/YYYY-Www.json    one weekly digest per week with activity (never rewritten)
  data/digests/index.json       list of digests, newest first (the archive on digest.html)
  feeds/network.xml             every item, newest 50
  feeds/theme-<slug>.xml        one per shared research theme (8)
  feeds/direction-<key>.xml     one per research direction (data/network.json)
  feeds/digest.xml              one item per weekly digest, newest first
  sitemap.xml                   static pages plus one entry per digest

Usage:
  python scripts/build_network.py                       production URLs
  python scripts/build_network.py --from-dir SITES      read sibling clones SITES/ccc, SITES/xurbanai, SITES/urbanprobe
  python scripts/build_network.py --from-dir SITES --examples --now 2026-10-19   local test with example data
  --out DIR     write somewhere other than the repository root (for tests)

If any source cannot be loaded, or anything unexpected goes wrong before the first write, the script says why and
exits 0 without writing anything. A record that cannot be used (no number, no date, ...) is skipped with a warning.
Characters that XML 1.0 forbids are removed from all text. Every feed is parsed before anything is written.
--examples needs --out, so that example items can never overwrite the real files.
It exits 1 when a research theme is not mapped to a direction in data/network.json.
The output depends only on the input and on --now (default: the current UTC time), so the same
input gives byte-identical files.
"""
import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.etree import ElementTree
from xml.sax.saxutils import escape as _escape

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://urbanscience.ai"
MAX_FEED = 50
MAX_ACTIVITY = 200
CLOSING_DAYS = 21
EVENT_DAYS = 14
UNANSWERED_MAX = 10

SOURCES = {
    "ccc": {"name": "City Computing Collective", "short": "Collective", "base": "https://citycomputingcollective.com"},
    "xurbanai": {"name": "XUrbanAI", "short": "XUrbanAI", "base": "https://xurbanai.com"},
    "urbanprobe": {"name": "UrbanProbe", "short": "UrbanProbe", "base": "https://urbanprobe.com"},
}
REGISTRY_SITES = ("xurbanai", "urbanprobe")
STATIC_PAGES = ["", "research.html", "follow.html", "activity.html", "digest.html"]


class SourceError(Exception):
    pass


# XML 1.0 allows tab, LF, CR, U+0020-U+D7FF, U+E000-U+FFFD and U+10000 and up. Lone surrogates are not allowed either.
_XML_BAD = re.compile("[^\\t\\n\\r\\u0020-\\ud7ff\\ue000-\\ufffd\\U00010000-\\U0010ffff]")


def clean(s):
    """Text without the characters XML 1.0 forbids."""
    return _XML_BAD.sub("", str(s if s is not None else ""))


def deep_clean(v):
    if isinstance(v, str):
        return clean(v)
    if isinstance(v, list):
        return [deep_clean(x) for x in v]
    if isinstance(v, dict):
        return {clean(k): deep_clean(x) for k, x in v.items()}
    return v


def escape(s, entities=None):
    return _escape(clean(s), entities or {})


def warn(msg):
    print(f"Warning: {msg}")


# ---------------------------------------------------------------- loading

def load_json(args, site, name, example_ok):
    """name is a path under data/. example_ok: use data/examples/ when --examples is set."""
    rel = f"data/examples/{name}" if (args.examples and example_ok) else f"data/{name}"
    if args.from_dir:
        path = Path(args.from_dir) / site / rel
        try:
            return deep_clean(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError) as e:
            raise SourceError(f"{path}: {e}")
    url = f"{SOURCES[site]['base']}/{rel}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "urbanscience-network-build"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return deep_clean(json.loads(r.read().decode("utf-8")))
    except Exception as e:  # network, HTTP and JSON errors all mean "skip this run"
        raise SourceError(f"{url}: {e}")


def load_all(args):
    ccc_tax = load_json(args, "ccc", "taxonomy.json", False)
    ccc_disc = load_json(args, "ccc", "discussions.json", True)
    if not isinstance(ccc_tax.get("themes"), list) or not isinstance(ccc_disc.get("discussions"), list):
        raise SourceError("CCC data does not have the expected shape")
    regs = {}
    for site in REGISTRY_SITES:
        schema = load_json(args, site, "schema.json", False)
        data = load_json(args, site, "registry.json", True)
        if not isinstance(schema.get("x-registries"), list):
            raise SourceError(f"{site} schema has no x-registries")
        regs[site] = (schema, data)
    return ccc_tax, ccc_disc, regs


# ---------------------------------------------------------------- helpers

def parse_dt(s):
    s = str(s)
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        s += "T00:00:00Z"
    d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def iso(d):
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clip(s, n=300):
    s = " ".join(str(s or "").split())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = text.encode("utf-8", "replace")
    if path.exists() and path.read_bytes() == data:
        return False
    path.write_bytes(data)
    return True


def write_json(path, obj):
    return write_text(path, json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- items

def as_list(v):
    return v if isinstance(v, list) else []


def line(s):
    """One-line text without forbidden characters."""
    return " ".join(clean(s).split())


def day_of(v):
    """The YYYY-MM-DD part of a date string, or None when v is not a usable date."""
    if not isinstance(v, str):
        return None
    try:
        parse_dt(v)
    except ValueError:
        return None
    return v[:10]


def usable_discussion(d):
    n = d.get("number") if isinstance(d, dict) else None
    return (isinstance(n, int) and not isinstance(n, bool) and isinstance(d.get("title"), str) and d["title"].strip() != ""
            and isinstance(d.get("createdAt"), str) and day_of(d["createdAt"]) is not None)


def usable_discussions(ccc_disc):
    good = []
    for d in ccc_disc["discussions"]:
        if usable_discussion(d):
            good.append(d)
        else:
            warn(f"skipped a CCC discussion without a valid number, title or createdAt: {str(d)[:80]}")
    return good


def registry_entries(data, reg):
    rows = data.get(reg["key"]) if isinstance(data, dict) else None
    good = []
    for e in as_list(rows):
        if isinstance(e, dict) and isinstance(e.get("id"), str) and e["id"] and isinstance(e.get("title"), str):
            good.append(e)
        else:
            warn(f"skipped a {reg['key']} entry without a valid id or title: {str(e)[:80]}")
    return good


def entry_items(site, reg, e, by_id, known):
    """The feed items of one registry entry (raises on data that cannot be used)."""
    base = SOURCES[site]["base"]
    slugs = [t for t in as_list(e.get("themes")) if isinstance(t, str) and t in known]
    url = f"{base}/entry.html?registry={reg['key']}&id={e['id']}"
    out = []
    if e.get("status") == "released":
        log = [c for c in as_list(e.get("changelog")) if isinstance(c, dict)] or [
            {"version": e.get("version"), "date": e.get("released"), "note": ""}]
        log = sorted(log, key=lambda c: (str(c.get("date")), str(c.get("version"))))
        for n, c in enumerate(log):
            if not c.get("date"):
                continue
            if day_of(c["date"]) is None:
                warn(f"{site} {reg['key']} {e['id']}: skipped a changelog line with the date {str(c['date'])[:30]!r}")
                continue
            out.append({
                "id": f"{site}-{reg['key']}-{e['id']}-v{c.get('version')}", "source": site, "kind": "release",
                "title": line(f"{e['title']} v{c.get('version')}"), "url": url, "date": iso(parse_dt(c["date"])),
                "themes": slugs, "label": line(reg["singular"]), "summary": clip(e.get("summary")),
                "version": str(c.get("version")), "first": n == 0, "note": clip(c.get("note"), 200),
            })
    elif e.get("status") == "deprecated":
        when = e.get("updated") or e.get("released")
        if when:
            if day_of(when) is None:
                raise ValueError(f"deprecation date {str(when)[:30]!r}")
            new = by_id.get(e.get("replaced_by"))
            summary = f"This {reg['singular']} is no longer maintained."
            if new:
                summary += f" It was replaced by {new['title']}."
            out.append({
                "id": f"{site}-{reg['key']}-{e['id']}-deprecated", "source": site, "kind": "deprecation",
                "title": line(f"Deprecated: {e['title']}"), "url": url, "date": iso(parse_dt(when)),
                "themes": slugs, "label": line(reg["singular"]), "summary": summary,
            })
    return out


def build_items(ccc_tax, discussions, regs):
    themes = [{"slug": t["slug"], "label": t["label"]} for t in ccc_tax["themes"]]
    label_to_slug = {t["label"]: t["slug"] for t in themes}
    known = set(label_to_slug.values())
    items, upcoming = [], []
    stats = {"discussions": 0, "people": 0, "releases": {}}

    for d in discussions:
        stats["discussions"] += 1
        if d.get("category") == "introductions" and d.get("directory"):
            stats["people"] += 1
        slugs = [label_to_slug[l] for l in as_list(d.get("themes")) if isinstance(l, str) and l in label_to_slug]
        url = f"{SOURCES['ccc']['base']}/post.html?n={d['number']}"
        items.append({
            "id": f"ccc-{d['number']}", "source": "ccc", "kind": "discussion", "title": line(d["title"]), "url": url,
            "date": iso(parse_dt(d["createdAt"])), "themes": slugs,
            "label": line(d.get("categoryName") or d.get("category", "")), "summary": clip(d.get("excerpt")),
        })
        f = d.get("fields") if isinstance(d.get("fields"), dict) else {}
        if d.get("category") == "opportunities" and f.get("deadline"):
            when = day_of(f["deadline"])
            if when:
                upcoming.append({"kind": "deadline", "title": line(d["title"]), "url": url, "date": when,
                                 "label": line(f.get("kind") or "Open call"), "themes": slugs})
            else:
                warn(f"discussion {d['number']}: the deadline {str(f['deadline'])[:30]!r} is not a date and was left out")
        if d.get("category") == "events-meetups" and f.get("date"):
            when = day_of(f["date"])
            if when:
                upcoming.append({"kind": "event", "title": line(d["title"]), "url": url, "date": when,
                                 "label": line(f.get("format") or "Event"), "themes": slugs})
            else:
                warn(f"discussion {d['number']}: the event date {str(f['date'])[:30]!r} is not a date and was left out")

    for site in REGISTRY_SITES:
        schema, data = regs[site]
        stats["releases"][site] = 0
        for reg in schema["x-registries"]:
            entries = registry_entries(data, reg)
            by_id = {e["id"]: e for e in entries}
            for e in entries:
                try:
                    made = entry_items(site, reg, e, by_id, known)
                except (KeyError, TypeError, ValueError, AttributeError) as err:
                    warn(f"skipped {site} {reg['key']} {e['id']}: {err!r}")
                    continue
                if e.get("status") == "released":
                    stats["releases"][site] += 1
                items += made

    items.sort(key=lambda i: (i["date"], i["id"]), reverse=True)
    upcoming.sort(key=lambda u: (u["date"], u["title"]))
    return themes, items, upcoming, stats


def check_directions(netmap, themes):
    dirs = netmap.get("directions") or {}
    mapped = {s for v in dirs.values() for s in v}
    slugs = {t["slug"] for t in themes}
    missing = sorted(slugs - mapped)
    unknown = sorted(mapped - slugs)
    problems = []
    if missing:
        problems.append("themes not mapped to any direction in data/network.json: " + ", ".join(missing))
    if unknown:
        problems.append("data/network.json maps unknown themes: " + ", ".join(unknown))
    for key in dirs:
        if key not in (netmap.get("labels") or {}):
            problems.append(f"direction '{key}' has no label in data/network.json")
    return problems


# ---------------------------------------------------------------- digest

def week_key(start):
    y, w, _ = start.isocalendar()
    return f"{y}-W{w:02d}"


def build_digest(items, upcoming, posts, now):
    """The digest for the most recent completed ISO week (Monday to Sunday, UTC), or None."""
    today = now.date()
    start = today - timedelta(days=today.weekday() + 7)
    end = start + timedelta(days=6)
    s, e = start.isoformat(), end.isoformat()
    week = [i for i in items if s <= i["date"][:10] <= e]
    if not week:
        return None

    by_cat = {}
    for i in week:
        if i["kind"] == "discussion":
            by_cat.setdefault(i["label"], []).append(i)
    discussions = [{"category": c, "items": [pick(i) for i in by_cat[c]]} for c in sorted(by_cat)]

    unanswered = [
        {"title": line(d["title"]), "url": f"{SOURCES['ccc']['base']}/post.html?n={d['number']}", "date": iso(parse_dt(d["createdAt"]))}
        for d in sorted(posts, key=lambda d: (d["createdAt"], d["number"]), reverse=True)
        if d.get("category") == "q-a" and not d.get("answered") and d["createdAt"][:10] <= e
    ][:UNANSWERED_MAX]

    def window(kind, days):
        lo, hi = today.isoformat(), (today + timedelta(days=days)).isoformat()
        return [{"title": u["title"], "url": u["url"], "date": u["date"], "label": u["label"]}
                for u in upcoming if u["kind"] == kind and lo <= u["date"] <= hi]

    releases = [
        {"title": i["title"], "url": i["url"], "date": i["date"][:10], "source": i["source"], "label": i["label"],
         "kind": "deprecated" if i["kind"] == "deprecation" else ("new" if i.get("first") else "updated")}
        for i in week if i["kind"] in ("release", "deprecation")
    ]
    n_disc = sum(len(g["items"]) for g in discussions)
    return {
        "week": week_key(start), "start": s, "end": e, "generated": today.isoformat(),
        "counts": {"discussions": n_disc, "releases": len(releases)},
        "discussions": discussions, "unanswered": unanswered,
        "closing": window("deadline", CLOSING_DAYS), "events": window("event", EVENT_DAYS), "releases": releases,
        "closingDays": CLOSING_DAYS, "eventDays": EVENT_DAYS,
    }


def pick(i):
    return {"title": i["title"], "url": i["url"], "date": i["date"][:10], "themes": i["themes"]}


def digest_html(d):
    """The digest as HTML for the feed description (escaped again when written into the feed)."""
    def li(it, extra=""):
        return f'<li><a href="{escape(it["url"], {chr(34): "&quot;"})}">{escape(it["title"])}</a>{escape(extra)}</li>'
    out = [f"<p>Week of {d['start']} to {d['end']}: {d['counts']['discussions']} new "
           f"{'discussion' if d['counts']['discussions'] == 1 else 'discussions'} and {d['counts']['releases']} "
           f"{'release' if d['counts']['releases'] == 1 else 'releases'}.</p>"]
    if d["discussions"]:
        out.append("<h3>New discussions</h3>")
        for g in d["discussions"]:
            out.append(f"<h4>{escape(g['category'])}</h4><ul>" + "".join(li(i) for i in g["items"]) + "</ul>")
    if d["unanswered"]:
        out.append("<h3>Questions waiting for an answer</h3><ul>" + "".join(li(i) for i in d["unanswered"]) + "</ul>")
    if d["closing"]:
        out.append(f"<h3>Open calls closing in the next {d['closingDays']} days</h3><ul>"
                   + "".join(li(i, f" ({i['label']}, closes {i['date']})") for i in d["closing"]) + "</ul>")
    if d["events"]:
        out.append(f"<h3>Events in the next {d['eventDays']} days</h3><ul>"
                   + "".join(li(i, f" ({i['date']})") for i in d["events"]) + "</ul>")
    if d["releases"]:
        names = {"new": "New", "updated": "Updated", "deprecated": "Deprecated"}
        out.append("<h3>New and updated releases</h3><ul>"
                   + "".join(li(i, f" ({names[i['kind']]} {i['label']} on {SOURCES[i['source']]['short']}, {i['date']})") for i in d["releases"])
                   + "</ul>")
    return "".join(out)


# ---------------------------------------------------------------- feeds

def rfc822(d):
    return format_datetime(d.astimezone(timezone.utc), usegmt=True)


def feed_xml(title, link, description, self_url, entries):
    """entries: list of dicts with title, link, guid, date (datetime), description, categories."""
    entries = entries[:MAX_FEED]
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">', "<channel>",
           f"<title>{escape(title)}</title>", f"<link>{escape(link)}</link>",
           f"<description>{escape(description)}</description>", "<language>en</language>"]
    if entries:
        out.append(f"<lastBuildDate>{rfc822(entries[0]['date'])}</lastBuildDate>")
    out.append(f'<atom:link href="{escape(self_url)}" rel="self" type="application/rss+xml"/>')
    for e in entries:
        out += ["<item>", f"<title>{escape(e['title'])}</title>", f"<link>{escape(e['link'])}</link>",
                f'<guid isPermaLink="false">{escape(e["guid"])}</guid>', f"<pubDate>{rfc822(e['date'])}</pubDate>",
                f"<description>{escape(e['description'])}</description>"]
        out += [f"<category>{escape(c)}</category>" for c in e["categories"]]
        out.append("</item>")
    out += ["</channel>", "</rss>", ""]
    return "\n".join(out)


def item_entry(i, theme_labels):
    src = SOURCES[i["source"]]
    if i["kind"] == "discussion":
        title, desc = f"{i['label']}: {i['title']}", i["summary"]
        kind = "Discussion"
    elif i["kind"] == "release":
        title = f"{'New' if i.get('first') else 'Updated'} {i['label']}: {i['title']}"
        desc = " ".join(x for x in (i["summary"], ("Changes: " + i["note"]) if i.get("note") else "") if x)
        kind = "Release"
    else:
        title, desc, kind = f"{i['title']} ({i['label']})", i["summary"], "Deprecation"
    return {
        "title": title, "link": i["url"], "guid": i["id"], "date": parse_dt(i["date"]),
        "description": (desc + " " if desc else "") + f"Source: {src['name']}.",
        "categories": [src["name"], kind] + [theme_labels[s] for s in i["themes"] if s in theme_labels],
    }


def digest_entries(digests):
    out = []
    for d in digests:
        end = datetime.fromisoformat(d["end"]).replace(tzinfo=timezone.utc) + timedelta(days=1)
        out.append({
            "title": f"Weekly network digest: {d['week']}", "link": f"{SITE}/digest.html?w={d['week']}",
            "guid": f"urbanscience-digest-{d['week']}", "date": end, "description": digest_html(d),
            "categories": ["Weekly digest"],
        })
    return out


# ---------------------------------------------------------------- main

def json_text(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def plan_outputs(args, now, out):
    """Work out every file to write without touching the disk.
    Returns (files, problems): files maps a path under out/ (as a string) to its text, and problems lists errors that make
    the build fail (unmapped themes). Raises SourceError when a source cannot be loaded."""
    ccc_tax, ccc_disc, regs = load_all(args)
    netmap = deep_clean(json.loads((ROOT / "data" / "network.json").read_text(encoding="utf-8")))
    posts = usable_discussions(ccc_disc)
    themes, items, upcoming, stats = build_items(ccc_tax, posts, regs)
    problems = check_directions(netmap, themes)
    if problems:
        return {}, problems
    theme_labels = {t["slug"]: t["label"] for t in themes}
    files = {}

    # activity.json: a build time is written only when the content changed
    body = {"generated": None, "total": len(items), "themes": themes, "stats": stats,
            "upcoming": upcoming, "items": items[:MAX_ACTIVITY]}
    target = out / "data" / "activity.json"
    body["generated"] = iso(now) if items else None
    if target.exists():
        try:
            old = json.loads(target.read_text(encoding="utf-8"))
            if {**old, "generated": None} == {**body, "generated": None}:
                body["generated"] = old.get("generated")
        except (ValueError, TypeError, AttributeError):
            pass
    files["data/activity.json"] = json_text(body)

    # digests (an existing digest is never rewritten; an empty week writes nothing)
    ddir = out / "data" / "digests"
    by_week = {}
    for p in sorted(ddir.glob("????-W??.json")):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            d["week"], d["start"], d["end"], d["counts"]
            by_week[d["week"]] = d
        except (ValueError, TypeError, KeyError):
            warn(f"{p.name} is not a usable digest and was left out of the index.")
    digest = build_digest(items, upcoming, posts, now)
    if digest and digest["week"] not in by_week and not (ddir / f"{digest['week']}.json").exists():
        by_week[digest["week"]] = digest
        files[f"data/digests/{digest['week']}.json"] = json_text(digest)
    digests = [by_week[w] for w in sorted(by_week, reverse=True)]
    files["data/digests/index.json"] = json_text(
        {"digests": [{"week": d["week"], "start": d["start"], "end": d["end"], "counts": d["counts"]} for d in digests]})

    # feeds
    entries = [item_entry(i, theme_labels) for i in items]
    feeds = {}
    feeds["network.xml"] = feed_xml(
        "Urban Science AI Lab: everything in the network", f"{SITE}/activity.html",
        "New discussions from the City Computing Collective and new releases from XUrbanAI and UrbanProbe.",
        f"{SITE}/feeds/network.xml", entries)
    for t in themes:
        sel = [e for e, i in zip(entries, items) if t["slug"] in i["themes"]]
        feeds[f"theme-{t['slug']}.xml"] = feed_xml(
            f"Urban Science AI Lab: {t['label']}", f"{SITE}/activity.html?theme={t['slug']}",
            f"Discussions on {t['label']} from the City Computing Collective, and releases on XUrbanAI and UrbanProbe tagged with this theme.",
            f"{SITE}/feeds/theme-{t['slug']}.xml", sel)
    for key, slugs in sorted(netmap["directions"].items()):
        label = netmap["labels"][key]
        sel = [e for e, i in zip(entries, items) if set(slugs) & set(i["themes"])]
        feeds[f"direction-{key}.xml"] = feed_xml(
            f"Urban Science AI Lab: {label}", f"{SITE}/research.html#{key}",
            f"Discussions and releases on the themes of this research direction: {', '.join(theme_labels[s] for s in slugs)}.",
            f"{SITE}/feeds/direction-{key}.xml", sel)
    feeds["digest.xml"] = feed_xml(
        "Urban Science AI Lab: weekly network digest", f"{SITE}/digest.html",
        "One summary for each week with activity: new discussions, questions waiting for an answer, open calls, events, and releases.",
        f"{SITE}/feeds/digest.xml", digest_entries(digests))
    for name, text in feeds.items():
        files[f"feeds/{name}"] = text

    # sitemap
    urls = [f"{SITE}/{p}" for p in STATIC_PAGES] + [f"{SITE}/digest.html?w={d['week']}" for d in digests]
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        extra = ""
        m = re.search(r"\?w=(\d{4}-W\d{2})$", u)
        if m:
            end = next(d["end"] for d in digests if d["week"] == m.group(1))
            extra = f"<lastmod>{(datetime.fromisoformat(end) + timedelta(days=1)).date().isoformat()}</lastmod>"
        lines.append(f"  <url><loc>{escape(u)}</loc>{extra}</url>")
    lines += ["</urlset>", ""]
    files["sitemap.xml"] = "\n".join(lines)
    return files, []


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from-dir", help="folder that holds the sibling clones ccc, xurbanai and urbanprobe")
    ap.add_argument("--examples", action="store_true", help="read data/examples/ files (local testing only; needs --out)")
    ap.add_argument("--now", help="YYYY-MM-DD to use as the current day (for tests)")
    ap.add_argument("--out", help="write here instead of the repository root (for tests)")
    args = ap.parse_args()
    if args.examples and not args.out:
        ap.error("--examples needs --out DIR, so that example items cannot overwrite the real data and feeds")

    try:
        now = parse_dt(args.now) if args.now else datetime.now(timezone.utc).replace(microsecond=0)
    except ValueError:
        ap.error("--now must look like 2026-10-19")
    out = Path(args.out) if args.out else ROOT

    # everything is worked out and checked first; nothing is written unless every part is good
    try:
        files, problems = plan_outputs(args, now, out)
        for rel, text in files.items():
            if rel.endswith(".xml"):
                ElementTree.fromstring(text.encode("utf-8"))
    except SourceError as e:
        print(f"Skipped: could not load a source. {e}")
        return 0
    except ElementTree.ParseError as e:
        print(f"Skipped: a generated file is not well-formed XML ({e}). Nothing was written.")
        return 0
    except Exception as e:  # unexpected data: keep the old files rather than fail every run
        print(f"Skipped: the data could not be processed ({type(e).__name__}: {e}). Nothing was written.")
        return 0
    if problems:
        for p in problems:
            print("ERROR:", p)
        return 1

    changed = []
    for rel, text in sorted(files.items()):
        if write_text(out / rel, text):
            changed.append(rel)
    fdir = out / "feeds"
    for p in list(fdir.glob("theme-*.xml")) + list(fdir.glob("direction-*.xml")):
        if f"feeds/{p.name}" not in files:
            p.unlink()
            changed.append(f"feeds/{p.name} (removed)")

    n_items = json.loads(files["data/activity.json"])["total"]
    n_digests = len(json.loads(files["data/digests/index.json"])["digests"])
    print(f"{n_items} items, {n_digests} digests. " + (("Changed: " + ", ".join(changed)) if changed else "No changes."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
