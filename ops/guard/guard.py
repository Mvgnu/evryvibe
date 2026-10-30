#!/usr/bin/env python3
"""CG1 origin crawler guard for evryvibe.com (installed as /usr/local/lib/evryvibe-guard/guard.py).

nginx writes a guard log for the EVRYVIBE vhost (fetch metadata, client hints, RSC header, verdicts). This detector
reads it, learns user-agent families from behaviour and maintains /etc/nginx/evryvibe-guard/families.map (exact
user-agent string -> family id). No address or ASN is ever listed. Every block is answered with a button page
("Kurz bestätigen, dass Sie kein Bot sind"); the button (POST /_evg/pass, served by this process) sets a cookie pair
that nginx verifies with secure_link, so a real person always gets through.

What nginx blocks (evryvibe-guard.nginx.conf, $evg_hit), never for self-declared crawlers, utm-tagged landings
(Deal-Alarm mails, ChatGPT and other assistants) or AI-assistant referrers, never for a genuine cross-site or
same-origin navigation (every pattern needs Sec-Fetch-Site none or absent):
  blind   per request: a desktop Chromium navigation with a search-engine referrer and blind fetch metadata, on
          every document page (round 5; until then only on URLs that engine cannot show; switch blind-docs.conf).
          Google's Chrome prefetch proxy (anonymous prefetches of result pages, prefetch-proxy.txt) is exempt.
  f/d     the same shape from a hot family (also non-Chromium strings), d also without referrer on desktop.
  o       stale desktop Chrome without referrer: SHADOW, logged as would-old only.
  s       CG2 broad sweep (SW): a fingerprint (exact user agent + Accept-Language) landing blind (Sec-Fetch-Site none
          or absent) without referrer or with a forged self referrer (?1 or no fetch metadata), learned from 10
          unengaged networks in 30 min while its user agent has < 3 genuinely engaged networks in 24 h; sweep.conf.
  r       CG2 r2 script runtimes (RT): Bun, node, Go-http-client, ... documents from 5 networks outside the owner's
          in 24 h; plain 403 without the button; switch runtime.conf.
"Cannot show" is per engine: Google gets the app's set (robots.txt, SEARCH_PATH, any filter query), Bing-powered
engines only robots.txt, because they do show filtered URLs.

How a family turns hot (evaluate), only for strings real people do not use (fewer than 3 engaged networks in 24 h;
engaged = soft navigation, internal page view, or a beacon or outbound POST from one of our pages; the memory is
persisted in state.json):
  F1  forged search landings from 3 unengaged networks in 30 min.
  F2x referrerless landings on the targets a hot family forged, from 10 networks.
  OLD referrerless deep landings of desktop Chrome >= 6 majors behind the learned stable major, 10 networks.
A family lives 24 h and is renewed only by fresh evidence of its own kind; it is released at once when its string
reaches 3 engaged networks. Fail open: a watchdog sets families.off when the heartbeat is older than 10 min, the
startup policy load falls back to no families, and guard.off / families.off / lock.off are files nginx checks per
request (no reload, so they work even when nginx -t fails elsewhere).

Subcommands: run, seed, learn-stable, watchdog, policy, ledger [--days N], mode, lock, challenge, blind-docs, sweep, runtime.
"""
from __future__ import annotations

import argparse
import base64
import http.server
import threading
import collections
import datetime as dt
import hashlib
import ipaddress
import json
import os
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qsl, urlsplit

CONFIG = {
    'log': '/var/log/evryvibe/guard.log',
    'state_dir': '/var/lib/evryvibe-guard',
    'nginx_dir': '/etc/nginx/evryvibe-guard',
    'robots_url': 'http://127.0.0.1:3300/robots.txt',
    'host': 'evryvibe.com',
    'release_src': '/srv/evryvibe/current/src',
    'first_contact_s': 1800,
    'window_s': 1800,
    'f1_nets': 3,
    'old_gap': 6,              # OLD: desktop Chrome this many majors or more behind the learned stable major ...
    'old_nets': 10,            # ... landing without referrer on unshowable URLs from this many networks in 30 min
    'stale_s': 600,
    'pair_window_s': 3600,     # S1: one network (IPv4 /24, IPv6 /64) + one user agent with ...
    'pair_docs': 30,           # ... this many document navigations in the window ...
    'pair_noref_share': 0.9,   # ... nearly all without referrer, none with Sec-Fetch-User (or a stale Chrome/Edge) ...
    'pair_ttl_s': 86400,       # ... and no engagement in 24 h: blocked (button page) for this long            # watchdog: no detector heartbeat for this long -> families.off (fail open)
    'stable_days': 7,          # stable major = most common Chrome major among engaged clients over these days ...
    'stable_min_clients': 50,  # ... once at least this many engaged clients were seen (else the rule is off)
    'reuse_nets': 10,          # F2x: deep landings on URLs a hot family forged, from this many networks ...
    'rare_engaged': 3,         # ... by a user agent with fewer engaged networks than this in 24 h
    'deep_nets': 5,            # cluster (ledger only): referrerless deep landings from this many networks ...
    'deep_shared_urls': 2,     # ... with this many URLs landed on from two or more networks
    'engaged_horizon_s': 86400,
    'ttl_s': 86400,
    'reload_min_interval_s': 15,
    'pass_port': 3319,         # the button's issuer (POST /_evg/pass via nginx), loopback only
    'pass_ttl_s': 30 * 86400,  # lifetime of the signed pass cookie
    'eval_interval_s': 3,
    'sweep_nets': 10,          # SW: one fingerprint (exact user agent + Accept-Language) landing blind on deep pages
    'sweep_window_s': 1800,    # ... from this many unengaged networks in this window, while the user agent has
    'sweep_ttl_s': 86400,      # ... fewer than rare_engaged genuinely engaged networks in 24 h: blocked this long
    'rt_nets': 5,              # RT (CG2 r2): a script-runtime / HTTP-library family fetching documents from this many
    'rt_window_s': 86400,      # ... non-exempt networks within this window is refused (plain 403, no button) ...
    'rt_ttl_s': 86400,         # ... until this long after its last document
}

# Crawlers and tools that identify themselves: never a family, never blocked. nginx carries the same expression
# ($evg_crawler in evryvibe-guard.conf); keep them equal.
CRAWLER = re.compile(
    r'bot|crawl|spider|slurp|Google-|GoogleOther|ChatGPT-User|OAI-SearchBot|Claude-User|Perplexity-User|'
    r'meta-external|facebookexternalhit|HetrixTools|openai-mcp|evryvibe-|Lighthouse|PageSpeed', re.I)
SEARCH_REF = re.compile(
    r'^https?://((www|de|search|html|lite|start)\.)?(google|bing|duckduckgo|yahoo|ecosia|qwant|yandex|startpage|'
    r'brave|baidu|seznam)\.[a-z.]{2,12}(/|$)', re.I)
SELF_REF = re.compile(r'^https?://(www\.)?evryvibe\.com(/|$)', re.I)
# Click identifiers and campaign tags that search engines, ads and mail clients add to a clean URL.
TRACKING_KEYS = ('gclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid', 'srsltid', 'fbclid', 'msclkid',
                 'dclid', 'yclid', '_gl', 'mc_cid', 'mc_eid', 'ref')
TRACKING_KEY = re.compile(r'^(%s|utm_[a-z_]+)$' % '|'.join(TRACKING_KEYS))
ASSET = re.compile(r'^/(_next/|brand-media|brand-favicons|branding/|editorial/|fonts/|media/|favicon|icon|apple-icon|'
                   r'robots\.txt|sitemap|\.well-known/|manifest|opengraph|twitter-image|cdn-cgi/)')
NON_DOC_DEST = {'empty', 'image', 'script', 'style', 'font', 'manifest', 'audio', 'video', 'track', 'worker',
                'serviceworker', 'sharedworker', 'object', 'embed', 'report', 'xslt'}
UNSAFE_UA = re.compile(r'["\\$\x00-\x1f{}]')
# AI-assistant referrals: never evidence, never blocked (nginx $evg_ai is the same pair of expressions).
AI_UTM = re.compile(r'[?&]utm_source=(chatgpt(\.com)?|openai(\.com)?|copilot(\.com|\.microsoft\.com)?|perplexity(\.ai)?|'
                    r'gemini(\.google\.com)?|claude(\.ai)?|mistral(\.ai)?|deepseek(\.com)?|grok(\.com)?|meta\.ai)(&|$)', re.I)
AI_REF = re.compile(r'^(https?://([a-z0-9-]+\.)*(chatgpt\.com|openai\.com|perplexity\.ai|copilot\.microsoft\.com|'
                    r'gemini\.google\.com|claude\.ai|mistral\.ai|deepseek\.com|grok\.com|meta\.ai)(/|$)|'
                    r'android-app://(com\.openai\.chatgpt|ai\.perplexity\.app\.android|com\.microsoft\.copilot|'
                    r'com\.google\.android\.apps\.bard|com\.anthropic\.claude))', re.I)
# OLD rule: desktop Chrome only. Reduced Android UAs are one string per version, WebViews and vendor builds lag.
CHROME_MAJOR = re.compile(r'Chrome/(\d+)\.')
OLD_EXCLUDED = re.compile(r'Mobile|Android|; wv|iPhone|iPad|CriOS|SamsungBrowser|YaBrowser|UCBrowser|Silk/|'
                          r'HuaweiBrowser|MiuiBrowser|HeyTap|Electron/|OPR/', re.I)


ENGAGING_POSTS = ('/_evg/outbound', '/api/minilytics', '/api/minilytics', '/api/minilytics/')


def genuine_engagement(r: 'Req') -> bool:
    """CG2: engagement a scripted client cannot fake by setting headers. An internal page view or RSC soft navigation
    that the browser marks Sec-Fetch-Site same-origin, or an outbound click (POST /_evg/outbound). Not: a self referrer with
    Sec-Fetch-Site none (the sweep fleets forge it), nor the POSTs our pages fire on load (recommendation-measurement;
    rendering fleets send them). No fetch metadata at all counts only for a user agent that does not claim Chrome
    (Chrome has sent Sec-Fetch-Site on every request since 76; old Safari sends none)."""
    if not (r.sfs == 'same-origin' or (r.sfs == '' and r.peer and 'Chrome/' not in r.ua)):
        return False
    rc, path = ref_class(r.ref), r.uri.split('?', 1)[0]
    if r.rsc == '1':
        return True
    if is_document(r) and rc == 'self' and not path.startswith('/_evg/outbound') and not same_page(r):
        return True
    return r.method == 'POST' and rc == 'self' and path == '/_evg/outbound'


def sweep_evidence(r: 'Req') -> bool:
    """CG2 SW evidence: a desktop document navigation from a browser-claiming user agent with blind fetch metadata
    (Sec-Fetch-Site none or absent) and no referrer or a forged self referrer, on any page but the home page. Typed,
    bookmarked and app-opened links of real people have this shape too, so it is evidence only, never a block on its
    own: a fingerprint must do it from 10 unengaged networks in 30 min while its user agent is not one people engage
    with. Guard-log lines only (r.peer), never utm/AI landings or self-declared headless builds."""
    return (bool(r.peer) and is_document(r) and desktop(r) and bool(BROWSER_CLAIM.search(r.ua))
            and 'Headless' not in r.ua and not ai_referral(r) and 'utm_source=' not in r.uri
            and sweep_shape(r) and r.uri.split('?', 1)[0] != '/')


def sweep_shape(r: 'Req') -> bool:
    """The blind landing shape SW learns and nginx blocks: Sec-Fetch-Site none or absent and no referrer, or a self
    referrer that is forged. CG2 r2 (critic F1): real Chrome and Safari send none + self referrer WITHOUT
    Sec-Fetch-User on back, forward and reload, so a self referrer counts only with Sec-Fetch-User ?1 (the fleets'
    shape) or with no fetch metadata at all."""
    rc = ref_class(r.ref)
    if rc == 'none':
        return r.sfs in ('', 'none')
    return rc == 'self' and (r.sfs == '' or (r.sfs == 'none' and r.sfu == '?1'))


# RT (CG2 r2): script runtimes and HTTP libraries. A family is the product token, whatever the version. Not listed on
# purpose: curl, Wget and Python-urllib (the owner's own tools, seen from unlisted owner networks), Dart (our Flutter
# app), and anything that names itself (crawlers, link previews, feed readers are exempt via CRAWLER anyway).
# nginx carries the hot tokens as generated patterns (runtimes.map); keep RT_PATTERN in step with runtime_pattern().
RUNTIME = re.compile(r'^(?:(bun|deno|node|node-fetch|undici|axios|got|python-requests|aiohttp|python-httpx|httpx|'
                     r'go-http-client|okhttp|java|apache-httpclient|libwww-perl|lwp-trivial|php|guzzlehttp|ruby|'
                     r'faraday|reqwest|scrapy|colly|fasthttp)(?:/| |$)|python/[0-9.]+ (aiohttp)/)', re.I)
# The owner's own networks, the VPS and loopback: never RT evidence, never RT-blocked. nginx $evg_owner is the same list.
OWNER_NETS = [ipaddress.ip_network(n) for n in ('127.0.0.0/8', '::1/128', '87.58.154.89/32')]


def runtime_token(ua: str) -> str | None:
    m = RUNTIME.match(ua or '')
    return (m.group(1) or m.group(2)).lower() if m else None


def runtime_pattern(token: str) -> str:
    """nginx case-insensitive pattern for a hot token (matches every version of it)."""
    if token == 'aiohttp':
        return r'^(python/[0-9.]+ )?aiohttp/'
    return '^' + re.escape(token) + r'(/| |$)'


def same_page(r: 'Req') -> bool:
    """Referrer is the requested page itself (a crawler following a trailing-slash redirect): not navigation."""
    a, b = urlsplit(r.ref), urlsplit(r.uri)
    return (a.path.rstrip('/') or '/', a.query) == (b.path.rstrip('/') or '/', b.query)


def ai_referral(r: 'Req') -> bool:
    return bool(AI_UTM.search(r.uri) or AI_REF.search(r.ref))


def desktop_chrome_major(ua: str) -> int | None:
    """Major of desktop Chrome or Edge (Edge carries the Chromium major in both Chrome/ and Edg/)."""
    m = CHROME_MAJOR.search(ua)
    return int(m.group(1)) if m and not OLD_EXCLUDED.search(ua) else None


# OpenAI's agents are welcome (owner policy): the published egress lists, OpenAI's own network for the ChatGPT
# browsing agent (RIPE: 2a13:9500:1e4::/48, org OpenAI; not in the published lists) and a Signature-Agent header that
# names chatgpt.com are exempt from every rule. guard.py refreshes the lists daily into openai.conf (nginx geo).
OPENAI_LISTS = ('https://openai.com/chatgpt-user.json', 'https://openai.com/searchbot.json',
                'https://openai.com/gptbot.json')
OPENAI_STATIC = ('2a13:9500:1e4::/48',)
OPENAI_NETS: list = [ipaddress.ip_network(n) for n in OPENAI_STATIC]


def openai_client(r: 'Req') -> bool:
    if 'chatgpt.com' in (r.sigagent or '').lower():
        return True
    try:
        a = ipaddress.ip_address(r.ip)
    except ValueError:
        return False
    return any(a.version == n.version and a in n for n in OPENAI_NETS)


# Google's Chrome Private Prefetch Proxy fetches search results ahead of a click for real people, from Google's own
# egress, with the result page as referrer and Sec-Fetch-Site none. Published geofeed (stable since 2025-03):
# https://www.gstatic.com/chrome/prefetchproxy/prefetch_proxy_geofeed, collapsed into prefetch-proxy.txt.
def _load_nets(path: str) -> list:
    try:
        return [ipaddress.ip_network(x.split('#', 1)[0].strip()) for x in open(path) if x.split('#', 1)[0].strip()]
    except OSError:
        return []


PREFETCH_PROXY_NETS: list = _load_nets(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prefetch-proxy.txt'))


def _in_nets(ip: str, nets: list) -> bool:
    try:
        a = ipaddress.ip_address(ip.split('/')[0])
    except ValueError:
        return False
    return any(a.version == n.version and a in n for n in nets)


def exempt_client(r: 'Req') -> bool:
    """Never blocked, never evidence, never engagement: OpenAI's agents and Google's prefetch proxy."""
    return openai_client(r) or _in_nets(r.ip, PREFETCH_PROXY_NETS)


def exempt_net(net: str) -> bool:
    """A detector network key (IPv4 address or IPv6 /64) inside OpenAI's or the prefetch proxy's ranges."""
    return _in_nets(net, OPENAI_NETS) or _in_nets(net, PREFETCH_PROXY_NETS)


def refresh_openai(cache_dir: str, log) -> str | None:
    """Fetch OpenAI's published lists; returns the nginx geo include text (None if nothing could be fetched)."""
    global OPENAI_NETS
    nets, sources = [ipaddress.ip_network(n) for n in OPENAI_STATIC], []
    cache = os.path.join(cache_dir, 'openai-ranges.json')
    try:
        for url in OPENAI_LISTS:
            req = urllib.request.Request(url, headers={'User-Agent': 'evryvibe-guard/1'})
            data = json.load(urllib.request.urlopen(req, timeout=15))
            for p in data.get('prefixes', []):
                nets.append(ipaddress.ip_network(p.get('ipv4Prefix') or p.get('ipv6Prefix'), strict=False))
            sources.append(f"{url} ({data.get('creationTime', '?')})")
        write_atomic(cache, json.dumps([str(n) for n in nets]))
    except Exception as exc:  # keep the last good list
        log(f'OpenAI lists not refreshed: {exc}')
        if not os.path.exists(cache):
            return None
        nets = [ipaddress.ip_network(n) for n in json.load(open(cache))]
        sources = [cache + ' (cached)']
    OPENAI_NETS = nets
    return (f'# OpenAI egress (never blocked), generated by evryvibe-guard from {"; ".join(sources)} and the RIPE '
            f'OpenAI network {", ".join(OPENAI_STATIC)}. Do not edit.\n'
            + ''.join(f'{n} 1;\n' for n in sorted(set(nets), key=str)))


def now_iso(t: float) -> str:
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).astimezone().isoformat(timespec='seconds')


# --------------------------------------------------------------------------------------------------------------------
# Policy: which URLs a search engine can show, derived from the app, never copied by hand.
# --------------------------------------------------------------------------------------------------------------------

def _robots_regex(value: str) -> str:
    rx = '^' + re.escape(value).replace(r'\*', '.*')
    if rx.endswith(r'\$'):
        rx = rx[:-2] + '$'
    return rx


class Policy:
    def __init__(self, robots: str, search_path: str, filter_params: list[str], source: str):
        self.robots_text = robots
        self.search_path = search_path
        self.filter_params = set(filter_params)
        self.source = source
        groups = self._groups(robots)
        # The noindex crawlers' group (bingbot carries the AI-only disallows) and Googlebot's own group.
        self.groups = {'noindex': groups.get('bingbot') or groups.get('*') or [], 'google': groups.get('googlebot') or []}
        self.compiled = {k: [(allow, re.compile(rx), n) for allow, rx, n in v] for k, v in self.groups.items()}

    @staticmethod
    def _groups(text: str) -> dict[str, list[tuple[bool, str, int]]]:
        groups: dict[str, list] = {}
        agents: list[str] = []
        last_was_agent = False
        for raw in text.splitlines():
            line = raw.split('#', 1)[0].strip()
            if ':' not in line:
                continue
            key, value = (part.strip() for part in line.split(':', 1))
            key = key.lower()
            if key == 'user-agent':
                if not last_was_agent:
                    agents = []
                agents.append(value.lower())
                groups.setdefault(value.lower(), [])
                last_was_agent = True
                continue
            last_was_agent = False
            if key in ('allow', 'disallow') and value:
                for agent in agents:
                    groups[agent].append((key == 'allow', _robots_regex(value), len(value)))
        return groups

    @staticmethod
    def _disallowed(rules, target: str) -> bool:
        best = None
        for allow, rx, length in rules:
            if rx.match(target) and (best is None or length > best[1] or (length == best[1] and allow)):
                best = (allow, length)
        return best is not None and not best[0]

    def robots_only(self, uri: str) -> str | None:
        """What every engine is told not to fetch (robots.txt). Bing-powered engines show filtered and paged URLs."""
        parts = urlsplit(uri)
        path = parts.path or '/'
        target = path + ('?' + parts.query if parts.query else '')
        for rules in self.compiled.values():
            if self._disallowed(rules, target):
                return 'robots:' + (path.split('/')[1] or '/')
        return None

    def unshowable_for(self, uri: str, ref: str) -> str | None:
        """Per engine: Google's set (robots, /suche, any filter query) for Google, robots only for the others."""
        return self.unshowable(uri) if search_engine(ref) == 'google' else self.robots_only(uri)

    def unshowable(self, uri: str) -> str | None:
        """Why no search engine can have shown this URL, or None if it can."""
        parts = urlsplit(uri)
        path = parts.path or '/'
        target = path + ('?' + parts.query if parts.query else '')
        for rules in self.compiled.values():
            if self._disallowed(rules, target):
                return 'robots:' + (path.split('/')[1] or '/')
        if path == self.search_path or path.startswith(self.search_path + '/'):
            return 'noindex:' + self.search_path.strip('/')
        keys = [k for k, _ in parse_qsl(parts.query, keep_blank_values=True)]
        odd = [k for k in keys if not TRACKING_KEY.match(k)]
        if odd:
            return 'query:filter' if any(k in self.filter_params for k in odd) else 'query:other'
        return None

    def nginx_conf(self) -> str:
        """The same decision as nginx maps ($evg_unshowable), longest robots rule first as robots.txt resolves it."""
        out = [f'# generated by evryvibe-guard from {self.source} at {now_iso(time.time())}. Do not edit.',
               '# $evg_unshowable = 1 when no search engine can have shown $request_uri (see guard.py Policy).']
        for name, rules in self.groups.items():
            out.append(f'map $request_uri $evg_robots_{name} {{')
            out.append('    default 0;')
            for allow, rx, _ in sorted(rules, key=lambda r: (-r[2], not r[0])):
                out.append(f'    "~{rx}" {0 if allow else 1};')
            out.append('}')
        sp = re.escape(self.search_path)
        out.append('map $uri $evg_search_path {')
        out.append('    default 0;')
        out.append(f'    "~^{sp}(/|$)" 1;')
        out.append('}')
        keys = '|'.join(re.escape(k) for k in TRACKING_KEYS) + '|utm_[a-z_]+'
        out.append('map $args $evg_query {')
        out.append('    default 0;')
        out.append(f'    "~(^|&)(?!(?:{keys})(=|&|$))[^&]" 1;')
        out.append('}')
        out.append('map "$evg_robots_noindex$evg_robots_google$evg_search_path$evg_query" $evg_unshowable {')
        out.append('    default 1;')
        out.append('    "0000" 0;')
        out.append('}')
        out.append('# robots.txt only: what Bing-powered engines cannot show either (they do show filtered URLs).')
        out.append('map "$evg_robots_noindex$evg_robots_google" $evg_unshowable_robots {')
        out.append('    default 1;')
        out.append('    "00" 0;')
        out.append('}')
        return '\n'.join(out) + '\n'

    @classmethod
    def load(cls, robots_file: str | None = None, src: str | None = None, cache_dir: str | None = None) -> 'Policy':
        src = src or CONFIG['release_src']
        if robots_file:
            robots, origin = open(robots_file, encoding='utf-8').read(), robots_file
        else:
            cache = os.path.join(cache_dir, 'robots.txt') if cache_dir else None
            try:
                req = urllib.request.Request(CONFIG['robots_url'],
                                             headers={'Host': CONFIG['host'], 'User-Agent': 'evryvibe-guard/1'})
                robots = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
                origin = CONFIG['robots_url']
                if cache and 'Disallow' in robots:
                    with open(cache, 'w', encoding='utf-8') as fh:
                        fh.write(robots)
            except OSError:
                if not cache or not os.path.exists(cache):
                    raise
                robots, origin = open(cache, encoding='utf-8').read(), cache + ' (cached; app unreachable)'
        policy_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'policy.json')
        config = json.load(open(policy_file, encoding='utf-8'))
        params, search = config['filter_params'], config['search_path']
        if 'Disallow' not in robots or not params or not search:
            raise RuntimeError('EVRYVIBE guard policy source is incomplete')
        return cls(robots, search, params, f'{origin} + {policy_file}')


# --------------------------------------------------------------------------------------------------------------------
# Requests
# --------------------------------------------------------------------------------------------------------------------

class Req:
    __slots__ = ('t', 'ip', 'peer', 'method', 'uri', 'status', 'ref', 'ua', 'sfs', 'sfm', 'sfd', 'sfu', 'chua',
                 'chplat', 'lang', 'country', 'rsc', 'family', 'verdict', 'host', 'lock', 'sigagent', 'tag', 'sweep', 'runtime')

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k, ''))


# Guard log (log_format evg_guard in evryvibe-guard.nginx.conf): tab separated, nginx default escaping.
GUARD_FIELDS = ('time', 'ip', 'peer', 'method', 'uri', 'status', 'ref', 'ua', 'sfs', 'sfm', 'sfd', 'sfu', 'chua',
                'chplat', 'lang', 'country', 'rsc', 'family', 'verdict', 'rt', 'host', 'lock', 'sigagent', 'sweep', 'runtime')


def parse_guard_line(line: str) -> Req | None:
    f = line.rstrip('\n').split('\t')
    if len(f) < 20:
        return None
    try:
        t = dt.datetime.fromisoformat(f[0]).timestamp()
    except ValueError:
        return None
    d = {k: ('' if v == '-' else v) for k, v in zip(GUARD_FIELDS, f)}
    d['rsc'] = d['rsc'].replace('-', '')  # two variables, each logged as '-' when absent
    for k in ('ref', 'ua', 'uri'):
        d[k] = d[k].replace('\\x22', '"').replace('\\x5C', '\\')
    return Req(t=t, ip=d['ip'], peer=d['peer'], method=d['method'], uri=d['uri'], status=int(d['status'] or 0),
               ref=d['ref'], ua=d['ua'], sfs=d['sfs'], sfm=d['sfm'], sfd=d['sfd'], sfu=d['sfu'], chua=d['chua'],
               chplat=d['chplat'], lang=d['lang'], country=d['country'], rsc=d['rsc'], family=d['family'],
               verdict=d['verdict'], host=d.get('host', ''), lock=d.get('lock', ''),
               sigagent=d.get('sigagent', '').replace('\\x22', '"'), sweep=d.get('sweep', ''), runtime=d.get('runtime', ''))


def net_of(ip: str) -> str:
    if ':' not in ip:
        return ip
    try:
        return str(ipaddress.IPv6Network(ip + '/64', strict=False).network_address) + '/64'
    except ValueError:
        return ip


def search_engine(ref: str) -> str:
    m = SEARCH_REF.match(ref or '')
    return '' if not m else ('google' if m.group(3).lower() == 'google' else 'other')


DESKTOP_EXCLUDED = re.compile(r'Mobile|Android|iPhone|iPad|; wv\)', re.I)


def desktop(r: 'Req') -> bool:
    """Desktop as nginx's $evg_desktop sees it: no mobile UA token and no Android platform client hint (the guard log
    has no Sec-CH-UA-Mobile, so ?1 alone is nginx-only)."""
    return not DESKTOP_EXCLUDED.search(r.ua) and 'android' not in (r.chplat or '').lower()


def ref_class(ref: str) -> str:
    if not ref:
        return 'none'
    if SELF_REF.match(ref):
        return 'self'
    if SEARCH_REF.match(ref):
        return 'search'
    return 'ext'


def is_document(r: Req) -> bool:
    if r.method not in ('GET', 'HEAD'):
        return False
    path = r.uri.split('?', 1)[0]
    if ASSET.match(path) or path.startswith(('/api/', '/oauth')):
        return False
    return not (r.rsc or '_rsc=' in r.uri or r.sfm in ('cors', 'same-origin', 'no-cors') or r.sfd in NON_DOC_DEST)


def spoofed_chromium(r: Req) -> bool:
    """H4 (tracked, never blocked on its own): a 'Chrome/N' navigation from the guard log without fetch metadata, or
    whose client hints name another major or a headless build. Needs the guard log's header fields."""
    m = re.search(r'Chrome/(\d+)', r.ua)
    if not m or not r.sfm:  # sfm empty = combined-log replay or a client without any fetch metadata
        return bool(m) and r.peer != '' and not r.sfs
    majors = re.findall(r'v=(?:\\x22|")(\d+)', r.chua)
    return 'Headless' in r.chua or (bool(majors) and m.group(1) not in majors)


def canon_uri(uri: str) -> str:
    """Path plus sorted query without tracking keys, so one campaign URL matches in any parameter order."""
    parts = urlsplit(uri)
    q = sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not TRACKING_KEY.match(k))
    return parts.path + ('?' + '&'.join(f'{k}={v}' for k, v in q) if q else '')


# A user agent that claims a real browser: a full Chrome/Edge/Safari token on AppleWebKit, or Gecko + Firefox. Bare
# `Mozilla/5.0`, curl, Python and the owner's own audit tools do not claim one.
BROWSER_CLAIM = re.compile(r'^Mozilla/5\.0 \([^)]+\) (AppleWebKit/[0-9.]+ \(KHTML, like Gecko\) .*'
                           r'(Chrome|CriOS|Edg|Version)/[0-9.]+ .*Safari/[0-9.]+|Gecko/[0-9]+ Firefox/[0-9.]+)')


def evg_net(ip: str) -> str:
    """The client network exactly as nginx's $evg_net writes it: first three IPv4 octets, first four IPv6 groups."""
    m = re.match(r'^([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+$', ip) or re.match(r'^([0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+):', ip)
    return m.group(1) if m else ip


def family_id(ua: str, prefix: str = 'f') -> str:
    """f... = hot on forged search landings (F1), d... = hot on rotating referrerless deep landings (F2c)."""
    return prefix + hashlib.sha1(ua.encode('utf-8', 'replace')).hexdigest()[:7]


# --------------------------------------------------------------------------------------------------------------------
# Detector
# --------------------------------------------------------------------------------------------------------------------

class Detector:
    def __init__(self, policy: Policy, cfg: dict | None = None):
        self.p = policy
        self.c = dict(CONFIG, **(cfg or {}))
        self.last_seen: dict[tuple, float] = {}           # (net, ua) -> last request
        self.docs: collections.Counter = collections.Counter()  # (net, ua) -> documents since first contact
        self.engaged: set[tuple] = set()                  # (net, ua) with an RSC request or internal navigation
        self.engaged_by_ua: dict[str, dict[str, float]] = collections.defaultdict(dict)  # ua -> net -> last
        self.campaign: dict[str, dict] = {}               # URL a hot family forged -> {net: until}
        self.clusters: dict[str, str] = {}                # ua -> day a referrerless cluster was noted
        self.majors: dict[str, dict[str, int]] = {}       # day -> Chrome major -> engaged clients (stable major)
        self.pair_docs: dict = collections.defaultdict(collections.deque)  # (evg_net, ua) -> (t, noref, sfu, uri)
        self.pair_engaged: dict = {}                      # (evg_net, ua) -> last engagement
        self.pairs: dict = {}                             # 'net|ua' -> verdict record (S1, single network)
        self.evidence: dict[str, collections.deque] = collections.defaultdict(collections.deque)
        self.hot: dict[str, dict] = {}                    # ua -> verdict record
        self.day: dict[tuple, dict] = {}                  # (day, ua) -> ledger rollup
        self.events: list[dict] = []                      # transitions, flushed to the ledger
        self.refused: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)  # day -> peer
        self.last_prune = 0.0
        # SW (CG2): fingerprint = exact user agent + '|' + Accept-Language.
        self.sw_seen: dict[tuple, float] = {}             # (net, fp) -> last request (first contact)
        self.sw_docs: collections.Counter = collections.Counter()  # (net, fp) -> documents since first contact
        self.sw_eng_pair: dict[tuple, float] = {}         # (net, fp) -> last genuine engagement
        self.sw_eng_ua: dict[str, dict[str, float]] = collections.defaultdict(dict)  # ua -> net -> last genuine
        self.sw_ev: dict[str, collections.deque] = collections.defaultdict(collections.deque)  # fp -> (t, net, uri)
        self.sweeps: dict[str, dict] = {}                 # fp -> verdict record
        # RT (CG2 r2): runtime token -> deque of (t, net) document evidence (24 h, capped), hot tokens.
        self.rt_ev: dict[str, collections.deque] = collections.defaultdict(lambda: collections.deque(maxlen=2000))
        self.runtimes: dict[str, dict] = {}

    def observe(self, r: Req) -> None:
        if r.lock == '1':
            self.refused[dt.datetime.fromtimestamp(r.t).strftime('%Y-%m-%d')][r.peer] += 1
            return
        if not r.ua or r.ip in ('127.0.0.1', '::1') or CRAWLER.search(r.ua) or exempt_client(r):
            return
        self.observe_sweep(r)
        self.observe_runtime(r)
        key = (net_of(r.ip), r.ua)
        prev = self.last_seen.get(key)
        first_contact = prev is None or r.t - prev > self.c['first_contact_s']
        self.last_seen[key] = r.t
        if first_contact:
            self.docs[key] = 0
            self.engaged.discard(key)
        rc = ref_class(r.ref)
        doc = is_document(r)
        if r.rsc == '1' or (doc and rc == 'self' and not r.uri.startswith('/_evg/outbound') and not same_page(r)) or (
                r.method == 'POST' and rc == 'self' and r.uri.split('?', 1)[0] in ENGAGING_POSTS):
            # Engaged: a soft navigation (RSC without the prefetch marker), an internal page view, or a beacon or
            # outbound POST sent from one of this site's pages. RSC prefetches are not engagement (Chrome prefetches
            # on its own). The POSTs are counted although scripted Chrome sends them too: a user agent with three
            # engaged networks in 24 h is treated as one real people use, and no referrerless rule makes it hot.
            navigation = r.rsc == '1' or doc
            if key not in self.engaged and navigation:  # stable major: navigating clients only (beacons are scriptable)
                m = CHROME_MAJOR.search(r.ua)
                if m and 'Edg/' not in r.ua and not OLD_EXCLUDED.search(r.ua.replace('Mobile', '').replace('Android', '')):
                    day = self.majors.setdefault(dt.datetime.fromtimestamp(r.t).strftime('%Y-%m-%d'), {})
                    day[m.group(1)] = day.get(m.group(1), 0) + 1
            self.engaged.add(key)
            self.engaged_by_ua[r.ua][key[0]] = r.t
            self.pair_engaged[(evg_net(r.ip), r.ua)] = r.t
        if doc and not ai_referral(r) and 'utm_source=' not in r.uri:
            self.pair_docs[(evg_net(r.ip), r.ua)].append((r.t, rc == 'none', bool(r.sfu or r.sfs), r.uri[:160]))
        hot = self.hot.get(r.ua)
        if not doc:
            if hot:
                self._roll(r, None)
            return
        self.docs[key] += 1
        rule = None
        if first_contact and not ai_referral(r):
            why = self.p.unshowable(r.uri)
            # Referrerless evidence needs the guard log's fetch metadata and no Sec-Fetch-User: typed, pasted and
            # bookmarked navigations of real people carry ?1 (22 of 22 measured); the stale fleets never do.
            scripted = bool(r.peer) and r.sfu == ''
            major = desktop_chrome_major(r.ua) if rc == 'none' and 'utm_' not in r.uri and scripted else None
            stable = self.stable_major(r.t) if major else None
            if rc == 'search' and r.sfs in ('', 'none') and self.p.unshowable_for(r.uri, r.ref):
                rule = 'F1'  # a cross-site or same-origin navigation is a genuine click or reload, never evidence
            elif stable and major <= stable - self.c['old_gap']:
                rule = 'OLD'  # also counts as F2 for F2x and the cluster note
            elif rc == 'none' and why and 'utm_' not in r.uri and scripted and why.startswith(
                    ('robots:angebot', 'robots:ausgang', 'query:')):
                rule = 'F2'
            elif spoofed_chromium(r):
                rule = 'H4'
            if rule:
                cu = canon_uri(r.uri)
                self.evidence[r.ua].append((r.t, key[0], rule, r.uri, cu))
                if rule == 'F1' and hot:
                    self.campaign.setdefault(cu, {})[key[0]] = r.t + self.c['ttl_s']
            if hot and rule and rule in {'F1': ('F1',), 'F2x': ('F1', 'F2', 'OLD'), 'OLD': ('OLD',)}[hot['rule']]:
                # Renewed only by fresh evidence of the kind that made the family, never by any landing of the string.
                hot['expires'] = max(hot['expires'], r.t + self.c['ttl_s'])
                hot['last_seen'] = r.t
        if rule or hot or r.verdict:
            self._roll(r, rule)

    def _roll(self, r: Req, rule: str | None) -> None:
        day = dt.datetime.fromtimestamp(r.t).strftime('%Y-%m-%d')
        row = self.day.get((day, r.ua))
        if row is None:
            row = self.day[(day, r.ua)] = {'first': r.t, 'last': r.t, 'requests': 0, 'evidence': collections.Counter(),
                                           'nets': set(), 'blocked': 0, 'would': 0, 'samples': [], 'verdicts': set()}
        row['last'] = r.t
        row['requests'] += 1
        row['nets'].add(net_of(r.ip))
        if rule:
            row['evidence'][rule] += 1
        if r.verdict.startswith('block'):
            row['blocked'] += 1
        elif r.verdict.startswith('would'):
            row['would'] += 1
        if len(row['samples']) < 5 and is_document(r) and r.uri[:160] not in row['samples']:
            row['samples'].append(r.uri[:160])
        sw = self.sweeps.get(r.ua + '|' + r.lang)
        if r.ua in self.hot:
            row['verdicts'].add('hot')
            row['fid'] = self.hot[r.ua]['family']
        elif sw:
            row['verdicts'].add('sweep')
            row['fid'] = sw['sweep']
        elif rule:
            row['verdicts'].add('watch')

    def evaluate(self, now: float) -> bool:
        """Update verdicts; True if the nginx family map must change."""
        changed = False
        for ua, ev in list(self.evidence.items()):
            while ev and now - ev[0][0] > self.c['window_s']:
                ev.popleft()
            if not ev:
                del self.evidence[ua]
                continue
            current = None  # a hot family keeps its verdict until it expires (no upgrade from f to d)
            if ua in self.hot or UNSAFE_UA.search(ua) or ua.startswith('~') or len(ua) > 512:
                continue
            clean = [(net, rule, cu) for t, net, rule, uri, cu in ev
                     if (net, ua) not in self.engaged and self.docs.get((net, ua), 0) <= 2]
            rule = None
            rare = self.engaged_nets(ua, now) < self.c['rare_engaged']
            if not rare:
                continue  # a string real people use (>= 3 engaged networks in 24 h) never goes hot, under any rule
            nets = {net for net, r_, uri in clean if r_ == 'F1'}
            if len(nets) >= self.c['f1_nets']:
                rule = 'F1'
            deep = [(net, uri) for net, r_, uri in clean if r_ in ('F1', 'F2', 'OLD')]
            reuse = {net for net, cu in deep if self.campaign_target(cu, now)}
            if not rule and len(reuse) >= self.c['reuse_nets'] and self.engaged_nets(ua, now) < self.c['rare_engaged']:
                rule, nets = 'F2x', reuse
            if not rule:
                old = {net for net, r_, cu in clean if r_ == 'OLD'}
                if len(old) >= self.c['old_nets'] and self.engaged_nets(ua, now) < self.c['rare_engaged']:
                    rule, nets = 'OLD', old
            self.note_cluster(ua, deep, now)
            if not rule:
                continue
            fid = family_id(ua, {'F2x': 'd', 'OLD': 'o'}.get(rule, 'f'))
            if rule == 'F1':
                for t, net, r_, uri, cu in ev:
                    if r_ == 'F1':
                        self.campaign.setdefault(cu, {})[net] = now + self.c['ttl_s']
            self.hot[ua] = {'family': fid, 'rule': rule, 'since': current['since'] if current else now,
                            'last_seen': now, 'expires': now + self.c['ttl_s'], 'nets_at_trigger': len(nets),
                            'samples': [e[3][:160] for e in ev if e[2] in ('F1', 'F2')][-5:]}
            self.events.append({'event': 'hot', 't': now_iso(now), 'ua': ua, 'family': fid, 'rule': rule,
                                'nets_at_trigger': len(nets), 'samples': self.hot[ua]['samples']})
            changed = True
        changed |= self.evaluate_pairs(now)
        changed |= self.evaluate_sweeps(now)
        changed |= self.evaluate_runtimes(now)
        for ua, h in list(self.hot.items()):
            if self.engaged_nets(ua, now) >= self.c['rare_engaged']:
                # Real people use this string after all: the family is released at once, whatever made it hot.
                self.events.append({'event': 'released', 't': now_iso(now), 'family': h['family'], 'ua': ua,
                                    'since': now_iso(h['since']), 'engaged_nets': self.engaged_nets(ua, now)})
                del self.hot[ua]
                changed = True
                continue
            if now >= h['expires']:
                self.events.append({'event': 'expired', 't': now_iso(now), 'family': h['family'], 'ua': ua,
                                    'since': now_iso(h['since'])})
                del self.hot[ua]
                changed = True
        if now - self.last_prune > 60:
            self.last_prune = now
            for key, t in list(self.last_seen.items()):
                if now - t > self.c['first_contact_s']:
                    del self.last_seen[key]
                    self.docs.pop(key, None)
                    self.engaged.discard(key)
            for cu, nets in list(self.campaign.items()):
                for net, until in list(nets.items()):
                    if until < now:
                        del nets[net]
                if not nets:
                    del self.campaign[cu]
            for ua, nets in list(self.engaged_by_ua.items()):
                for net, t in list(nets.items()):
                    if now - t > self.c['engaged_horizon_s']:
                        del nets[net]
                if not nets:
                    del self.engaged_by_ua[ua]
        return changed

    def would(self, r: Req) -> str:
        """The verdict the round-2 nginx rules give this request (observer mode; mirrors evryvibe-guard.nginx.conf)."""
        if (not r.ua or CRAWLER.search(r.ua) or exempt_client(r) or not is_document(r) or ai_referral(r)
                or 'utm_source=' in r.uri):
            return ''
        rc, h = ref_class(r.ref), self.hot.get(r.ua)
        fid = h['family'] if h else ''
        blind, desktop_ = r.sfs in ('', 'none'), desktop(r)
        if rc == 'search' and blind and self.p.unshowable_for(r.uri, r.ref):
            if fid and fid[0] in 'fd':
                return 'would-family'
            if (not fid or fid[0] == 'o') and 'Chrome/' in r.ua and desktop_:
                return 'would-blind'
        if rc == 'search' and blind and 'Chrome/' in r.ua and desktop_:
            return 'would-blind'  # round 5: blind on every document page
        if rc == 'none' and blind and fid and desktop_ and not r.sfu and self.p.unshowable(r.uri):
            return {'d': 'would-family', 'o': 'would-old'}.get(fid[0], '')
        return ''

    def state(self) -> dict:
        now = time.time()
        engaged = {ua: {n: t for n, t in nets.items() if now - t < self.c['engaged_horizon_s']}
                   for ua, nets in self.engaged_by_ua.items()}
        return {'hot': self.hot, 'campaign': self.campaign, 'majors': self.majors,
                'engaged_by_ua': {ua: nets for ua, nets in engaged.items() if nets}, 'pairs': self.pairs,
                'pair_engaged': [[k[0], k[1], t] for k, t in self.pair_engaged.items()],
                'sweeps': self.sweeps,
                'sweep_engaged': {ua: {n: t for n, t in nets.items() if now - t < self.c['engaged_horizon_s']}
                                  for ua, nets in self.sw_eng_ua.items() if nets},
                'runtimes': self.runtimes,
                'runtime_ev': {k: [list(e) for e in d if now - e[0] < self.c['rt_window_s']]
                               for k, d in self.rt_ev.items() if d}}

    def restore(self, state: dict) -> None:
        self.hot, self.campaign = state.get('hot', {}), state.get('campaign', {})
        self.majors = state.get('majors', {})
        self.engaged_by_ua = collections.defaultdict(dict, {
            ua: {n: t for n, t in nets.items() if not exempt_net(n)} for ua, nets in state.get('engaged_by_ua', {}).items()})
        self.pairs = state.get('pairs', {})
        self.pair_engaged = {(n, u): t for n, u, t in state.get('pair_engaged', [])}
        self.sweeps = state.get('sweeps', {})
        self.sw_eng_ua = collections.defaultdict(dict, {
            ua: {n: t for n, t in nets.items() if not exempt_net(n)} for ua, nets in state.get('sweep_engaged', {}).items()})
        self.runtimes = state.get('runtimes', {})
        for k, evs in state.get('runtime_ev', {}).items():
            self.rt_ev[k].extend(tuple(e) for e in evs)

    def stable_major(self, now: float) -> int | None:
        """Most common Chrome major among engaged clients over the last stable_days days (learned, never fixed)."""
        since = dt.datetime.fromtimestamp(now - self.c['stable_days'] * 86400).strftime('%Y-%m-%d')
        total: dict[str, int] = {}
        for day, counts in self.majors.items():
            if day >= since:
                for k, v in counts.items():
                    total[k] = total.get(k, 0) + v
        if sum(total.values()) < self.c['stable_min_clients']:
            return None
        return int(max(total.items(), key=lambda kv: kv[1])[0])

    def campaign_target(self, cu: str, now: float) -> bool:
        """A URL a hot family forged from two or more networks in the last 24 h: the campaign's own target list."""
        nets = self.campaign.get(cu)
        return bool(nets) and sum(1 for until in nets.values() if until > now) >= 2

    def engaged_nets(self, ua: str, now: float) -> int:
        """Engaged networks of a user agent in 24 h. OpenAI's agent and Google's prefetch proxy never count: they
        are exempt from every block, so their activity must not shield a string a fleet shares with them."""
        return sum(1 for n, t in self.engaged_by_ua.get(ua, {}).items()
                   if now - t < self.c['engaged_horizon_s'] and not exempt_net(n))

    def note_cluster(self, ua: str, deep: list, now: float) -> None:
        """H2 in the ledger only: a rotating referrerless cluster sharing deep URLs (not blocked on its own)."""
        day = dt.datetime.fromtimestamp(now).strftime('%Y-%m-%d')
        nets = {net for net, uri in deep}
        if self.clusters.get(ua) == day or len(nets) < self.c['deep_nets']:
            return
        by_url = collections.defaultdict(set)
        for net, uri in deep:
            by_url[uri].add(net)
        if sum(1 for v in by_url.values() if len(v) >= 2) >= self.c['deep_shared_urls']:
            self.clusters[ua] = day
            self.events.append({'event': 'cluster', 't': now_iso(now), 'ua': ua, 'family': family_id(ua),
                                'nets': len(nets), 'engaged_nets': self.engaged_nets(ua, now),
                                'samples': [u[:160] for n, u in deep[-3:]]})

    def evaluate_pairs(self, now: float) -> bool:
        """S1, the single-network scraper: one network and one user agent that claims a real browser but never sends
        fetch metadata (no Sec-Fetch-Site at all, which every real Chrome, Edge, Safari and Firefox does), fetching
        30+ documents an hour, nearly all without referrer, with no engagement in 24 h. The owner's own tools (bare
        Mozilla/5.0, curl, audit scripts) claim no browser; real Safari and Playwright send Sec-Fetch-Site."""
        changed, c = False, self.c
        stable = self.stable_major(now)
        for key, dq in list(self.pair_docs.items()):
            while dq and now - dq[0][0] > c['pair_window_s']:
                dq.popleft()
            if not dq:
                del self.pair_docs[key]
                continue
            pk = f'{key[0]}|{key[1]}'
            if (len(dq) < c['pair_docs'] or UNSAFE_UA.search(key[1]) or key[1].startswith('~')
                    or not BROWSER_CLAIM.search(key[1])):
                continue
            noref = sum(1 for e in dq if e[1]) / len(dq)
            no_fetch_metadata = not any(e[2] for e in dq)  # no Sec-Fetch-Site (nor Sec-Fetch-User) on any document
            engaged = now - self.pair_engaged.get(key, 0) < c['engaged_horizon_s']
            if noref < c['pair_noref_share'] or not no_fetch_metadata or engaged:
                continue
            if pk in self.pairs:  # fresh evidence renews
                self.pairs[pk]['expires'] = now + c['pair_ttl_s']
                continue
            pid = 'p' + hashlib.sha1(pk.encode('utf-8', 'replace')).hexdigest()[:7]
            self.pairs[pk] = {'pair': pid, 'net': key[0], 'ua': key[1], 'since': now, 'expires': now + c['pair_ttl_s'],
                              'docs_at_trigger': len(dq), 'samples': [e[3] for e in list(dq)[-5:]]}
            self.events.append({'event': 'hot', 't': now_iso(now), 'ua': key[1], 'family': pid, 'rule': 'S1',
                                'nets_at_trigger': 1, 'net': key[0], 'docs': len(dq),
                                'samples': self.pairs[pk]['samples']})
            changed = True
        for pk, h in list(self.pairs.items()):
            key = (h['net'], h['ua'])
            released = self.pair_engaged.get(key, 0) > h['since']
            if released or now >= h['expires']:
                self.events.append({'event': 'released' if released else 'expired', 't': now_iso(now),
                                    'family': h['pair'], 'ua': h['ua'], 'net': h['net'], 'since': now_iso(h['since'])})
                del self.pairs[pk]
                changed = True
        for key, t in list(self.pair_engaged.items()):
            if now - t > c['engaged_horizon_s']:
                del self.pair_engaged[key]
        return changed

    def observe_sweep(self, r: Req) -> None:
        """SW bookkeeping per request (called from observe for every non-crawler, non-exempt line)."""
        fp = r.ua + '|' + r.lang
        key = (net_of(r.ip), fp)
        prev = self.sw_seen.get(key)
        first_contact = prev is None or r.t - prev > self.c['first_contact_s']
        self.sw_seen[key] = r.t
        if first_contact:
            self.sw_docs[key] = 0
        if genuine_engagement(r):
            self.sw_eng_pair[key] = r.t
            self.sw_eng_ua[r.ua][key[0]] = r.t
            return
        if not is_document(r):
            return
        self.sw_docs[key] += 1
        engaged = r.t - self.sw_eng_pair.get(key, -1e18) < self.c['engaged_horizon_s']
        if first_contact and not engaged and self.sw_docs[key] <= 2 and sweep_evidence(r):
            self.sw_ev[fp].append((r.t, key[0], r.uri[:160]))
            h = self.sweeps.get(fp)
            if h:  # renewed only by fresh SW evidence of its own fingerprint
                h['expires'] = max(h['expires'], r.t + self.c['sweep_ttl_s'])
                h['last_seen'] = r.t

    def sweep_engaged_nets(self, ua: str, now: float) -> int:
        """Genuinely engaged networks of a user agent (any Accept-Language) in 24 h, OpenAI/prefetch excluded."""
        return sum(1 for n, t in self.sw_eng_ua.get(ua, {}).items()
                   if now - t < self.c['engaged_horizon_s'] and not exempt_net(n))

    def evaluate_sweeps(self, now: float) -> bool:
        """SW, the broad sweep (CG2): one fingerprint (exact user agent + Accept-Language) that lands blind
        (Sec-Fetch-Site none or absent, no referrer or a forged self referrer) on deep pages from sweep_nets
        unengaged networks within sweep_window_s, while its user agent has fewer than rare_engaged genuinely engaged
        networks in 24 h. Hot for sweep_ttl_s, renewed by fresh evidence, released at once when the user agent
        reaches rare_engaged genuinely engaged networks. nginx then blocks that fingerprint's blind referrerless (or
        self-referrer) desktop navigations with the button page; same-origin and cross-site navigations never."""
        changed, c = False, self.c
        for fp, ev in list(self.sw_ev.items()):
            while ev and now - ev[0][0] > c['sweep_window_s']:
                ev.popleft()
            if not ev:
                del self.sw_ev[fp]
                continue
            if fp in self.sweeps:
                continue
            ua, lang = fp.rsplit('|', 1)
            if UNSAFE_UA.search(fp) or ua.startswith('~') or len(fp) > 700:
                continue
            nets = {net for t, net, uri in ev
                    if now - self.sw_eng_pair.get((net, fp), -1e18) >= c['engaged_horizon_s']}
            if len(nets) < c['sweep_nets'] or self.sweep_engaged_nets(ua, now) >= c['rare_engaged']:
                continue
            sid = 's' + hashlib.sha1(fp.encode('utf-8', 'replace')).hexdigest()[:7]
            self.sweeps[fp] = {'sweep': sid, 'ua': ua, 'lang': lang, 'since': now, 'last_seen': now,
                               'expires': now + c['sweep_ttl_s'], 'nets_at_trigger': len(nets),
                               'samples': [e[2] for e in list(ev)[-5:]]}
            self.events.append({'event': 'hot', 't': now_iso(now), 'ua': ua, 'lang': lang, 'family': sid,
                                'rule': 'SW', 'nets_at_trigger': len(nets), 'samples': self.sweeps[fp]['samples']})
            changed = True
        for fp, h in list(self.sweeps.items()):
            engaged = self.sweep_engaged_nets(h['ua'], now)
            if engaged >= c['rare_engaged'] or now >= h['expires']:
                self.events.append({'event': 'released' if engaged >= c['rare_engaged'] else 'expired',
                                    't': now_iso(now), 'family': h['sweep'], 'ua': h['ua'], 'lang': h['lang'],
                                    'since': now_iso(h['since']), 'engaged_nets': engaged})
                del self.sweeps[fp]
                changed = True
        if now - getattr(self, 'sw_last_prune', 0.0) > 60:
            self.sw_last_prune = now
            for key, t in list(self.sw_seen.items()):
                if now - t > c['first_contact_s']:
                    del self.sw_seen[key]
                    self.sw_docs.pop(key, None)
            for key, t in list(self.sw_eng_pair.items()):
                if now - t > c['engaged_horizon_s']:
                    del self.sw_eng_pair[key]
            for ua, nets in list(self.sw_eng_ua.items()):
                for net, t in list(nets.items()):
                    if now - t > c['engaged_horizon_s']:
                        del nets[net]
                if not nets:
                    del self.sw_eng_ua[ua]
        return changed

    def observe_runtime(self, r: Req) -> None:
        """RT evidence: a document request from a script-runtime / HTTP-library user agent, outside the owner's
        networks (crawlers, OpenAI, the prefetch proxy and loopback never reach here)."""
        tok = runtime_token(r.ua)
        if not tok or not is_document(r) or _in_nets(r.ip, OWNER_NETS):
            return
        self.rt_ev[tok].append((r.t, net_of(r.ip)))
        h = self.runtimes.get(tok)
        if h:  # renewed by every further document of the family
            h['expires'] = max(h['expires'], r.t + self.c['rt_ttl_s'])
            h['last_seen'] = r.t

    def evaluate_runtimes(self, now: float) -> bool:
        """RT, script runtimes (CG2 r2): a runtime family (product token, any version) whose documents come from
        rt_nets non-exempt networks within rt_window_s is refused with a plain 403 (no button: nobody behind it can
        press one) for rt_ttl_s after its last document. The owner's tools come from at most 1-4 networks a day."""
        changed, c = False, self.c
        for tok, ev in list(self.rt_ev.items()):
            while ev and now - ev[0][0] > c['rt_window_s']:
                ev.popleft()
            if not ev:
                del self.rt_ev[tok]
                continue
            if tok in self.runtimes:
                continue
            nets = {net for t, net in ev}
            if len(nets) < c['rt_nets']:
                continue
            rid = 'r' + hashlib.sha1(tok.encode()).hexdigest()[:7]
            self.runtimes[tok] = {'runtime': rid, 'token': tok, 'since': now, 'last_seen': now,
                                  'expires': max(now, ev[-1][0]) + c['rt_ttl_s'], 'nets_at_trigger': len(nets)}
            self.events.append({'event': 'hot', 't': now_iso(now), 'ua': tok, 'family': rid, 'rule': 'RT',
                                'nets_at_trigger': len(nets)})
            changed = True
        for tok, h in list(self.runtimes.items()):
            if now >= h['expires']:
                self.events.append({'event': 'expired', 't': now_iso(now), 'family': h['runtime'], 'ua': tok,
                                    'since': now_iso(h['since'])})
                del self.runtimes[tok]
                changed = True
        return changed

    def runtimes_text(self) -> str:
        lines = [f'# generated by evryvibe-guard {now_iso(time.time())}; user-agent (case-insensitive) -> runtime (RT).']
        for tok, h in sorted(self.runtimes.items(), key=lambda kv: kv[1]['since']):
            lines.append(f'"~*{runtime_pattern(tok)}" {h["runtime"]};  # RT since {now_iso(h["since"])}')
        return '\n'.join(lines) + '\n'

    def sweeps_text(self) -> str:
        lines = [f'# generated by evryvibe-guard {now_iso(time.time())}; "user-agent|accept-language" (anchored) -> sweep (SW).']
        for fp, h in sorted(self.sweeps.items(), key=lambda kv: kv[1]['since']):
            if not UNSAFE_UA.search(fp):
                lines.append(f'"~^{re.escape(h["ua"])}\\|{re.escape(h["lang"])}$" {h["sweep"]};  # SW since {now_iso(h["since"])}')
        return '\n'.join(lines) + '\n'

    def pairs_text(self) -> str:
        lines = [f'# generated by evryvibe-guard {now_iso(time.time())}; "network|user-agent" (anchored) -> pair (S1).']
        for pk, h in sorted(self.pairs.items(), key=lambda kv: kv[1]['since']):
            if BROWSER_CLAIM.search(h['ua']):
                lines.append(f'"~^{re.escape(h["net"])}\\|{re.escape(h["ua"])}$" {h["pair"]};  # S1 since {now_iso(h["since"])}')
        return '\n'.join(lines) + '\n'

    def map_text(self) -> str:
        lines = [f'# generated by evryvibe-guard {now_iso(time.time())}; exact user-agent (anchored regex) -> family.']
        for ua, h in sorted(self.hot.items(), key=lambda kv: kv[1]['since']):
            lines.append(f'"~^{re.escape(ua)}$" {h["family"]};  # {h["rule"]} since {now_iso(h["since"])}')
        return '\n'.join(lines) + '\n'

    def rollups(self, before_day: str | None = None, drop: bool = False) -> list[dict]:
        out = []
        for (day, ua), row in list(self.day.items()):
            if before_day and day >= before_day:
                continue
            fid = self.hot[ua]['family'] if ua in self.hot else row.get('fid') or family_id(ua)
            out.append({'event': 'day', 'day': day, 'family': fid, 'ua': ua,
                        'first': now_iso(row['first']), 'last': now_iso(row['last']), 'requests': row['requests'],
                        'nets': len(row['nets']), 'evidence': dict(row['evidence']), 'blocked': row['blocked'],
                        'would_block': row['would'], 'verdicts': sorted(row['verdicts']), 'samples': row['samples']})
            if drop:
                del self.day[(day, ua)]
        for day, peers in list(self.refused.items()):
            if before_day and day >= before_day:
                continue
            out.append({'event': 'lock', 'day': day, 'refused': sum(peers.values()), 'peers': len(peers),
                        'top_peers': peers.most_common(5)})
            if drop:
                del self.refused[day]
        return out


# --------------------------------------------------------------------------------------------------------------------
# Service
# --------------------------------------------------------------------------------------------------------------------

def write_atomic(path: str, text: str) -> None:
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


APPLY_FAILED: dict = {}  # basename -> first refused apply (any of them drives the watchdog, CG2 N4)


def install_file(path: str, text: str, log) -> bool | None:
    """Write an nginx include if its content changed, test, reload. None = unchanged."""
    old = open(path, encoding='utf-8').read() if os.path.exists(path) else ''
    if old.split('\n', 1)[-1] == text.split('\n', 1)[-1]:
        return None
    write_atomic(path, text)
    test = subprocess.run(['/usr/sbin/nginx', '-t', '-q'], capture_output=True, text=True)
    if test.returncode != 0:
        write_atomic(path, old)
        APPLY_FAILED.setdefault(os.path.basename(path), time.time())  # the watchdog fails open after stale_s
        log(f'nginx -t failed for {path}, reverted: {test.stderr.strip()[:300]}')
        return False
    APPLY_FAILED.pop(os.path.basename(path), None)
    subprocess.run(['/usr/sbin/nginx', '-s', 'reload'], check=False)
    log(f'{os.path.basename(path)} applied, nginx reloaded')
    return True


def ledger_append(state_dir: str, rows: list[dict]) -> None:
    # Separate lock inode: detector and button issuer append concurrently.
    import fcntl
    if not rows and not os.path.exists(os.path.join(state_dir, 'ledger.jsonl')):
        return
    os.makedirs(state_dir, exist_ok=True)
    path = os.path.join(state_dir, 'ledger.jsonl')
    marker = os.path.join(state_dir, 'ledger-pruned')
    with open(os.path.join(state_dir, '.ledger.lock'), 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if os.path.exists(path) and (not os.path.exists(marker) or time.time()-os.path.getmtime(marker)>60):
            cutoff = time.time()-14*86400
            kept = []
            with open(path, encoding='utf-8') as previous:
                for line in previous:
                    try:
                        row = json.loads(line)
                        stamp = row.get('t') or row.get('day')
                        if stamp and dt.datetime.fromisoformat(stamp).timestamp() < cutoff:
                            continue
                        kept.append(line)
                    except (ValueError, TypeError):
                        continue
            write_atomic(path, ''.join(kept))
            write_atomic(marker, now_iso(time.time()))
        with open(path, 'a', encoding='utf-8') as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + '\n')


COMBINED = re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) [^"]*" (\d{3}) \S+ "((?:[^"\\]|\\.)*)" '
                      r'"((?:[^"\\]|\\.)*)"')


def seed(det: Detector, path: str, hours: float, until: float | None = None) -> int:
    """Warm the detector from a log that carries engagement: the guard log (RSC header, fetch metadata), or the
    combined access log, where every `_rsc=` request counts as engagement (prefetch and soft navigation cannot be
    told apart there, so the seed errs towards "engaged"). Both formats are recognised per line."""
    since, n, last_eval = time.time() - hours * 3600, 0, 0.0
    for line in open(path, encoding='utf-8', errors='replace'):
        r = parse_guard_line(line) if '\t' in line else None
        if r is None:
            m = COMBINED.match(line)
            if not m:
                continue
            ip, ts, method, uri, status, ref, ua = m.groups()
            t = dt.datetime.strptime(ts, '%d/%b/%Y:%H:%M:%S %z').timestamp()
            r = Req(t=t, ip=ip, method=method, uri=uri, status=int(status), ref='' if ref == '-' else ref,
                    ua='' if ua == '-' else ua, rsc='1' if '_rsc=' in uri else '')
        elif r.host not in ('', CONFIG['host']):
            continue
        if r.t < since or (until and r.t >= until):
            continue
        det.observe(r)
        n += 1
        if r.t - last_eval >= 3:
            last_eval = r.t
            det.evaluate(r.t)
    return n


def warm(det: Detector, hours: float) -> int:
    """Cold start (critic N3): fill the RT evidence and SW engagement memory from the guard log's last hours. Only
    those two memories: no family, sweep or pair is learned from history here."""
    since, n = time.time() - hours * 3600, 0
    for path in (CONFIG['log'] + '.1', CONFIG['log']):
        if not os.path.exists(path):
            continue
        for line in open(path, encoding='utf-8', errors='replace'):
            r = parse_guard_line(line)
            if (r is None or r.t < since or r.host not in ('', CONFIG['host']) or r.lock == '1' or not r.ua
                    or r.ip in ('127.0.0.1', '::1') or CRAWLER.search(r.ua) or exempt_client(r)):
                continue
            n += 1
            det.observe_runtime(r)
            if genuine_engagement(r):
                det.sw_eng_ua[r.ua][net_of(r.ip)] = r.t
    return n


class PassServer(threading.Thread):
    """The button behind the 403 page: POST /_evg/pass (proxied by nginx) gets a cookie pair that nginx verifies with
    secure_link (md5 over expiry, user agent, client network and the server secret) and a 303 back to the page it
    came from. Runs as its own unit (`guard.py pass-server`), independent of the detector."""

    def __init__(self, port: int, secret: str, ttl: int, sink: list):
        super().__init__(daemon=True)
        secret_, ttl_, sink_ = secret, ttl, sink

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                origin = urlsplit(self.headers.get('Origin', ''))
                host = self.headers.get('Host', '')
                if (origin.netloc and origin.netloc != host) or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                    self.send_error(403)
                    return
                ua = self.headers.get('User-Agent', '')
                net = self.headers.get('X-EVG-Net', '')  # nginx $evg_net: IPv4 /24 or IPv6 /64 of the client
                expires = int(time.time()) + ttl_
                raw = f'{expires}{ua}{net} {secret_}'.encode('latin-1', 'replace')
                token = base64.urlsafe_b64encode(hashlib.md5(raw).digest()).rstrip(b'=').decode()
                ref = urlsplit(self.headers.get('Referer', ''))
                host = self.headers.get('Host', '')
                target = '/'
                if ref.netloc == host and ref.path.startswith('/') and not ref.path.startswith(('//', '/_evg/')):
                    target = ref.path + ('?' + ref.query if ref.query else '')
                secure = '; Secure' if self.headers.get('X-Forwarded-Proto') == 'https' else ''
                self.send_response(303)
                for name, value in (('evg_h', token), ('evg_e', str(expires))):
                    self.send_header('Set-Cookie', f'{name}={value}; Path=/; Max-Age={ttl_}; HttpOnly; SameSite=Lax{secure}')
                self.send_header('Location', target)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', '0')
                self.end_headers()
                sink_.append({'event': 'pass', 't': now_iso(time.time()), 'ua': ua,
                              'ip': self.headers.get('X-Real-IP', ''), 'path': target[:160]})

            def do_GET(self):  # noqa: N802
                self.send_response(405)
                self.send_header('Content-Length', '0')
                self.end_headers()

            def log_message(self, *a):
                pass

        self.httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)

    def run(self):
        self.httpd.serve_forever()


def pass_secret() -> str:
    text = open(os.path.join(CONFIG['nginx_dir'], 'pass-secret.conf'), encoding='utf-8').read()
    return re.search(r'default "([0-9a-f]{32,})"', text).group(1)


def cmd_run(args) -> None:
    c = CONFIG
    if args.state_dir:
        c['state_dir'] = args.state_dir
    os.makedirs(c['state_dir'], exist_ok=True)
    observe = args.observe  # observer: computes round-2 verdicts itself, never writes nginx files

    def log(msg: str) -> None:
        print(f'{now_iso(time.time())} {msg}', flush=True)

    def apply(name: str, text: str):
        return None if observe else install_file(os.path.join(c['nginx_dir'], name), text, log)

    while True:
        try:
            policy = Policy.load(cache_dir=c['state_dir'])
            break
        except Exception as exc:  # fail open: no families until the app's policy sources can be read again
            log(f'policy load failed, serving no families: {exc}')
            apply('families.map', '# policy unavailable: no families (fail open)\n')
            time.sleep(300)
    apply('policy.conf', policy.nginx_conf())
    openai_text = refresh_openai(c['state_dir'], log)
    if openai_text:
        apply('openai.conf', openai_text)
    last_openai = time.time()
    today_path = os.path.join(c['state_dir'], 'today.json')
    if os.path.exists(today_path):  # the previous run's open segment goes to the ledger; the reader sums segments
        try:
            ledger_append(c['state_dir'], json.load(open(today_path, encoding='utf-8')))
        except ValueError:
            pass
        os.remove(today_path)
    det = Detector(policy)
    state_path = os.path.join(c['state_dir'], 'state.json')
    if os.path.exists(state_path):
        try:
            det.restore(json.load(open(state_path, encoding='utf-8')))
        except (ValueError, OSError) as exc:
            log(f'state not restored: {exc}')
    passes: list = []
    if args.pass_server:
        PassServer(c['pass_port'], pass_secret(), c['pass_ttl_s'], passes).start()
        log(f"pass issuer on 127.0.0.1:{c['pass_port']}")
    det.evaluate(time.time())
    apply('families.map', det.map_text())
    apply('pairs.map', det.pairs_text())
    if not det.rt_ev and not det.runtimes:  # N3 cold start: no RT memory yet (first start or lost state)
        log(f'warm-up from the guard log: {warm(det, 24)} lines')
        det.evaluate(time.time())
    apply('sweeps.map', det.sweeps_text())
    apply('runtimes.map', det.runtimes_text())
    write_atomic(state_path, json.dumps(det.state()))
    log(f"started{' (observer)' if observe else ''}; policy from {policy.source}; {len(det.hot)} hot families; "
        f"stable Chrome major {det.stable_major(time.time())}")
    fh, inode, from_start = None, None, args.from_start
    last_eval = last_policy = last_flush = time.time()
    last_reload, pending = 0.0, False
    pos_path = os.path.join(c['state_dir'], 'logpos.json')
    resume = None
    if os.path.exists(pos_path):  # continue where the previous run stopped, so a restart loses no line
        try:
            resume = json.load(open(pos_path))
        except ValueError:
            resume = None

    def flush(*_):
        """Stop or SIGTERM: today's counts, state and the log position go to disk before the process ends."""
        write_atomic(os.path.join(c['state_dir'], 'today.json'), json.dumps(det.rollups(), ensure_ascii=False))
        write_atomic(state_path, json.dumps(det.state()))
        if fh is not None:
            write_atomic(pos_path, json.dumps({'inode': inode, 'offset': fh.tell()}))
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, flush)
    while True:
        if fh is None:
            try:
                fh = open(c['log'], encoding='utf-8', errors='replace')
                inode = os.fstat(fh.fileno()).st_ino
                if resume and resume.get('inode') == inode and resume.get('offset', 0) <= os.fstat(fh.fileno()).st_size:
                    fh.seek(resume['offset'])
                elif not from_start:
                    fh.seek(0, os.SEEK_END)
                resume = None
                from_start = True  # after a rotation the new file is read from its start
            except FileNotFoundError:
                time.sleep(2)
                continue
        line = fh.readline()
        if line.endswith('\n'):
            r = parse_guard_line(line)
            if r is not None and r.host in ('', c['host']):
                if observe:
                    r.verdict = det.would(r) if r.verdict[:5] not in ('pass-',) else r.verdict
                det.observe(r)
            continue
        if line:  # partial line: rewind and wait for the rest
            fh.seek(fh.tell() - len(line.encode('utf-8', 'replace')))
        now = time.time()
        try:
            if os.stat(c['log']).st_ino != inode:
                fh.close()
                fh = None
                continue
        except FileNotFoundError:
            pass
        if now - last_eval >= c['eval_interval_s']:
            last_eval = now
            pending |= det.evaluate(now)
            if not observe:
                with open(os.path.join(c['state_dir'], 'heartbeat'), 'w') as hb:  # read by `guard.py watchdog`
                    # N4: any generated include that nginx -t keeps refusing (families, pairs, sweeps, runtimes,
                    # policy, openai) counts; the watchdog then fails open with families.off.
                    hb.write(f"{now_iso(now)}\napply_failed_since={min(APPLY_FAILED.values()) if APPLY_FAILED else ''}\n")
            if passes:
                batch, passes[:] = list(passes), []
                for e in batch:
                    h = det.hot.get(e['ua'])
                    e['family'] = h['family'] if h else 'blind/other'
                det.events.extend(batch)
            for e in det.events:
                log(f"{e['event']} {e.get('family', '')} {e.get('ua', '')[:140]}")
            ledger_append(c['state_dir'], det.events)
            det.events = []
        if pending and now - last_reload >= c['reload_min_interval_s']:
            last_reload = now
            apply('pairs.map', det.pairs_text())
            apply('sweeps.map', det.sweeps_text())
            apply('runtimes.map', det.runtimes_text())
            if apply('families.map', det.map_text()) is not False:
                pending = False
            write_atomic(state_path, json.dumps(det.state()))
        if now - last_flush >= 300:
            last_flush = now
            today = dt.datetime.fromtimestamp(now).strftime('%Y-%m-%d')
            ledger_append(c['state_dir'], det.rollups(before_day=today, drop=True))
            write_atomic(os.path.join(c['state_dir'], 'today.json'), json.dumps(det.rollups(), ensure_ascii=False))
            write_atomic(state_path, json.dumps(det.state()))
            write_atomic(pos_path, json.dumps({'inode': inode, 'offset': fh.tell()}))
        if now - last_openai >= 86400:
            last_openai = now
            openai_text = refresh_openai(c['state_dir'], log)
            if openai_text:
                apply('openai.conf', openai_text)
        if now - last_policy >= 3600:
            last_policy = now
            try:
                det.p = Policy.load(cache_dir=c['state_dir'])
                apply('policy.conf', det.p.nginx_conf())
            except Exception as exc:  # keep the previous policy
                log(f'policy reload failed: {exc}')
        time.sleep(0.5)


def cmd_pass_server(args) -> None:
    """The button issuer as its own process: no policy, no log tailing, only the secret."""
    events: list = []
    PassServer(CONFIG['pass_port'], pass_secret(), CONFIG['pass_ttl_s'], events).start()
    print(f"{now_iso(time.time())} pass issuer on 127.0.0.1:{CONFIG['pass_port']}", flush=True)
    while True:
        time.sleep(5)
        if events:
            batch, events[:] = list(events), []
            for e in batch:
                e['family'] = 'button'
            ledger_append(CONFIG['state_dir'], batch)


def cmd_learn_stable(args) -> None:
    """Count engaged Chrome clients per major and day from combined logs (gz ok) into state.json (stable major)."""
    import gzip
    if args.state_dir:
        CONFIG['state_dir'] = args.state_dir
    det = Detector.__new__(Detector)
    det.majors = {}
    seen = set()
    for path in args.paths:
        fh = gzip.open(path, 'rt', errors='replace') if path.endswith('.gz') else open(path, errors='replace')
        for line in fh:
            m = COMBINED.match(line)
            if not m:
                continue
            ip, ts, method, uri, status, ref, ua = m.groups()
            r = Req(method=method, uri=uri, ref='' if ref == '-' else ref, ua=ua)
            rc, doc = ref_class(r.ref), is_document(r)
            if CRAWLER.search(ua) or not (doc and rc == 'self' and not uri.startswith('/_evg/outbound') and not same_page(r)):
                continue  # navigating clients only: beacons and outbound POSTs are scriptable
            mm = CHROME_MAJOR.search(ua)
            if not mm or 'Edg/' in ua or OLD_EXCLUDED.search(ua.replace('Mobile', '').replace('Android', '')):
                continue
            day = dt.datetime.strptime(ts, '%d/%b/%Y:%H:%M:%S %z').strftime('%Y-%m-%d')
            if (day, ip, ua) in seen:
                continue
            seen.add((day, ip, ua))
            d = det.majors.setdefault(day, {})
            d[mm.group(1)] = d.get(mm.group(1), 0) + 1
    state_path = os.path.join(CONFIG['state_dir'], 'state.json')
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    merged = state.get('majors', {})
    merged.update(det.majors)
    state['majors'] = merged
    write_atomic(state_path, json.dumps(state))
    det.c = dict(CONFIG)
    print('days', len(merged), 'stable major now', Detector.stable_major(det, time.time()))


# --------------------------------------------------------------------------------------------------------------------
# Owner commands
# --------------------------------------------------------------------------------------------------------------------

def cmd_backfill(args) -> None:
    """One-off repair: add the block/would counts per family that the guard log has but the ledger missed (restarts
    before the SIGTERM flush existed). Appends one correcting segment per user agent; never subtracts."""
    day = args.day
    log_counts: dict = collections.defaultdict(collections.Counter)
    end = None
    for path in (CONFIG['log'] + '.1', CONFIG['log']):
        if not os.path.exists(path):
            continue
        fh = open(path, encoding='utf-8', errors='replace')
        for line in iter(fh.readline, ''):
            if not line.endswith('\n'):
                break
            r = parse_guard_line(line)
            if r and r.verdict and dt.datetime.fromtimestamp(r.t).strftime('%Y-%m-%d') == day:
                log_counts[r.ua]['blocked' if r.verdict.startswith('block') else
                                 'would' if r.verdict.startswith('would') else 'other'] += 1
        if path == CONFIG['log']:
            end = {'inode': os.fstat(fh.fileno()).st_ino, 'offset': fh.tell()}
    led: dict = collections.defaultdict(collections.Counter)
    rows = []
    path = os.path.join(CONFIG['state_dir'], 'ledger.jsonl')
    for line in open(path, encoding='utf-8'):
        e = json.loads(line)
        if e['event'] == 'day' and e['day'] == day:
            rows.append(e)
    tp = os.path.join(CONFIG['state_dir'], 'today.json')
    if os.path.exists(tp):
        rows += [e for e in json.load(open(tp)) if e['event'] == 'day' and e['day'] == day]
    for e in rows:
        led[e['ua']]['blocked'] += e['blocked']
        led[e['ua']]['would'] += e.get('would_block', 0)
    out = []
    for ua, c in log_counts.items():
        b, w = c['blocked'] - led[ua]['blocked'], c['would'] - led[ua]['would']
        if b > 0 or w > 0:
            out.append({'event': 'day', 'day': day, 'family': family_id(ua), 'ua': ua, 'first': day + 'T00:00:00',
                        'last': day + 'T00:00:00', 'requests': 0, 'nets': 0, 'evidence': {}, 'blocked': max(b, 0),
                        'would_block': max(w, 0), 'verdicts': [], 'samples': [], 'backfill': True})
            print(f'{short_ua(ua):45} +{max(b, 0)} blocked +{max(w, 0)} would (log {c["blocked"]}/{c["would"]})')
    if args.apply:  # run with the detector stopped: it resumes exactly where this count ended
        ledger_append(CONFIG['state_dir'], out)
        if end:
            write_atomic(os.path.join(CONFIG['state_dir'], 'logpos.json'), json.dumps(end))
    print(f"{len(out)} correcting segments {'appended' if args.apply else '(dry run)'}")


def cmd_watchdog(args) -> None:
    """Fail open: no detector heartbeat for stale_s -> families.off (nginx stops family blocks per request, no
    reload needed). A fresh heartbeat removes a families.off that the watchdog itself set."""
    ledger_append(CONFIG['state_dir'], [])
    hb = os.path.join(CONFIG['state_dir'], 'heartbeat')
    off = os.path.join(CONFIG['nginx_dir'], 'families.off')
    age = time.time() - os.path.getmtime(hb) if os.path.exists(hb) else 1e9
    if os.path.exists(hb):  # a map that nginx -t keeps refusing counts as stale too (it cannot expire)
        m = re.search(r'apply_failed_since=(\d+(?:\.\d+)?)', open(hb).read())
        if m:
            age = max(age, time.time() - float(m.group(1)))
    # The button must never be dead: if the issuer does not answer, every block goes off (guard.off).
    goff = os.path.join(CONFIG['nginx_dir'], 'guard.off')
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{CONFIG['pass_port']}/", timeout=5)
        issuer_ok = True
    except urllib.error.HTTPError as exc:
        issuer_ok = exc.code == 405
    except OSError:
        issuer_ok = False
    gmine = os.path.exists(goff) and open(goff).read().startswith('watchdog')
    if not issuer_ok and not os.path.exists(goff):
        write_atomic(goff, f'watchdog {now_iso(time.time())}: button issuer not answering\n')
        ledger_append(CONFIG['state_dir'], [{'event': 'switch', 't': now_iso(time.time()),
                                             'mode': 'guard off (watchdog, button issuer down)'}])
        print('guard off')
    elif issuer_ok and gmine:
        os.remove(goff)
        ledger_append(CONFIG['state_dir'], [{'event': 'switch', 't': now_iso(time.time()),
                                             'mode': 'guard back on (watchdog, button issuer answers)'}])
        print('guard on')
    mine = os.path.exists(off) and open(off).read().startswith('watchdog')
    if age > CONFIG['stale_s'] and not os.path.exists(off):
        write_atomic(off, f'watchdog {now_iso(time.time())}: detector heartbeat {int(age)} s old\n')
        ledger_append(CONFIG['state_dir'], [{'event': 'switch', 't': now_iso(time.time()),
                                             'mode': f'families off (watchdog, heartbeat {int(age)} s old)'}])
        print('families off')
    elif age <= CONFIG['stale_s'] and mine:
        os.remove(off)
        ledger_append(CONFIG['state_dir'], [{'event': 'switch', 't': now_iso(time.time()),
                                             'mode': 'families back on (watchdog, detector alive)'}])
        print('families on')


def cmd_seed(args) -> None:
    """One-off warm-up before the service starts: hot families from the combined log, kept in state.json."""
    c = CONFIG
    if args.state_dir:
        c['state_dir'] = args.state_dir
    os.makedirs(c['state_dir'], exist_ok=True)
    det = Detector(Policy.load(cache_dir=c['state_dir']))
    state_path = os.path.join(c['state_dir'], 'state.json')
    if os.path.exists(state_path):
        det.majors = json.load(open(state_path)).get('majors', {})  # keep the learned stable major
    n = 0
    for path in args.path:
        n += seed(det, path, args.hours, until=args.until and dt.datetime.fromisoformat(args.until).timestamp()
                  if path.endswith('access.log') else None)
    det.evaluate(time.time())
    ledger_append(c['state_dir'], det.events)
    write_atomic(state_path, json.dumps(det.state()))
    write_atomic(os.path.join(c['state_dir'], 'today.json'), json.dumps(det.rollups(), ensure_ascii=False))
    print(f'seeded {n} lines; hot: ' + ', '.join(f"{h['family']} {short_ua(ua)}" for ua, h in det.hot.items()))


def short_ua(ua: str) -> str:
    plat = re.search(r'\(([^)]*)\)', ua)
    eng = (re.search(r'(Edg|OPR)/(\d+)', ua) or re.search(r'(HeadlessChrome|Firefox|Chrome|Version)/(\d+)', ua))
    p = '; '.join(x.strip() for x in plat.group(1).split(';')[:2]) if plat else ua[:30]
    return f"{p} {eng.group(1) + '/' + eng.group(2) if eng else ''}".strip()


def switch_state(name: str) -> str:
    path = os.path.join(CONFIG['nginx_dir'], name)
    return open(path).read() if os.path.exists(path) else ''


def cmd_ledger(args) -> None:
    state_dir = args.state_dir or CONFIG['state_dir']
    since = (dt.date.today() - dt.timedelta(days=args.days - 1)).isoformat()
    rows: list[dict] = []
    locks: dict[str, dict] = {}
    events = []

    def add_lock(e: dict) -> None:
        a = locks.setdefault(e['day'], {'refused': 0, 'peers': 0, 'top': collections.Counter()})
        a['refused'] += e['refused']
        a['peers'] += e['peers']
        a['top'].update(dict((p, n) for p, n in e['top_peers']))
    path = os.path.join(state_dir, 'ledger.jsonl')
    if os.path.exists(path):
        for line in open(path, encoding='utf-8'):
            e = json.loads(line)
            if e['event'] == 'day' and e['day'] >= since:
                rows.append(e)
            elif e['event'] == 'lock' and e['day'] >= since:
                add_lock(e)
            elif e['event'] not in ('day', 'lock') and e['t'][:10] >= since:
                events.append(e)
    today_path = os.path.join(state_dir, 'today.json')
    if os.path.exists(today_path):
        for e in json.load(open(today_path, encoding='utf-8')):
            if e['event'] == 'lock':
                add_lock(e)
            else:
                rows.append(e)
    state_path = os.path.join(state_dir, 'state.json')
    state = json.load(open(state_path)) if os.path.exists(state_path) else {}
    hot = state.get('hot', {})
    det = Detector.__new__(Detector)
    det.c, det.majors = dict(CONFIG), state.get('majors', {})
    mode = 'ENFORCING' if 'default 1' in switch_state('mode.conf') else 'SHADOW (would-block is only logged)'
    lock = 'ON' if 'default 1' in switch_state('origin-lock.conf') else 'OFF'
    challenge = switch_state('challenge.conf')
    challenge = 'ON' if 'default 1' in challenge else ('preview port only' if '3303 1' in challenge else 'OFF')
    kills = [f for f in ('guard.off', 'families.off', 'lock.off') if os.path.exists(os.path.join(CONFIG['nginx_dir'], f))]
    if kills:
        print('KILL SWITCHES PRESENT: ' + ', '.join(kills) + ' (guard.off = nothing blocked, families.off = only the '
              'per-request blind rule, lock.off = origin lock off)')
    print(f'EVRYVIBE crawler guard, last {args.days} day(s) from {since}. Guard: {mode}. Origin lock: {lock}. '
          f'Challenge page: {challenge}. Stable Chrome major (learned): {Detector.stable_major(det, time.time())}.'
          + (f' State: {state_dir}' if args.state_dir else ''))
    print(f'\nHot families ({len(hot)}). Blocked shapes, all answered with the button page, never for crawlers, '
          f'utm/assistant landings or genuine cross-site clicks: f/d = search-engine referrer on a URL that engine '
          f'cannot show, with blind fetch metadata; d also = no referrer on an unshowable URL from a desktop browser; '
          f'o = no referrer, no Sec-Fetch-User, on any document page from stale desktop Chrome or Edge')
    for ua, h in sorted(hot.items(), key=lambda kv: kv[1]['since']):
        print(f"  {h['family']}  {h['rule']:4} since {now_iso(h['since'])[:16]}  until {now_iso(h['expires'])[:16]}  "
              f"{short_ua(ua)}")
    pairs = state.get('pairs', {})
    pmode = 'ENFORCED' if 'default 1' in switch_state('pair.conf') else 'SHADOW (logged as would-pair)'
    print(f'\nSingle-network scrapers S1 ({len(pairs)}; {pmode}): one network + one user agent that claims a real '
          f'browser but sends no fetch metadata, 30+ documents an hour, no referrer, no engagement in 24 h')
    for pk, h in sorted(pairs.items(), key=lambda kv: kv[1]['since']):
        print(f"  {h['pair']}  since {now_iso(h['since'])[:16]}  until {now_iso(h['expires'])[:16]}  {h['net']:22} "
              f"{h['docs_at_trigger']:>4} docs/h  {short_ua(h['ua'])}")
    sweeps = state.get('sweeps', {})
    smode = 'ENFORCED' if 'default 1' in switch_state('sweep.conf') else 'SHADOW (logged as would-sweep)'
    print(f'\nBroad sweeps SW ({len(sweeps)}; {smode}): one fingerprint (user agent + Accept-Language) landing blind, '
          f'without referrer or with a forged self referrer, on deep pages from 10 unengaged networks in 30 min, '
          f'user agent with < 3 genuinely engaged networks in 24 h')
    for fp, h in sorted(sweeps.items(), key=lambda kv: kv[1]['since']):
        print(f"  {h['sweep']}  since {now_iso(h['since'])[:16]}  until {now_iso(h['expires'])[:16]}  "
              f"{h['nets_at_trigger']:>3} nets  {short_ua(h['ua'])}  [{h['lang'][:24]}]")
    sweep_uas = {h['ua'] for h in sweeps.values()}
    runtimes = state.get('runtimes', {})
    rmode = 'ENFORCED' if 'default 1' in switch_state('runtime.conf') else 'SHADOW (logged as would-runtime)'
    print(f'\nScript runtimes RT ({len(runtimes)}; {rmode}): a runtime / HTTP-library family (any version) fetching '
          f'documents from 5 networks in 24 h, outside the owner\'s networks; plain 403, no button')
    for tok, h in sorted(runtimes.items(), key=lambda kv: kv[1]['since']):
        print(f"  {h['runtime']}  since {now_iso(h['since'])[:16]}  until {now_iso(h['expires'])[:16]}  "
              f"{h['nets_at_trigger']:>3} nets  {tok}")
    agg: dict[str, dict] = {}
    for e in sorted(rows, key=lambda e: (e['day'], e.get('backfill', False), e['first'])):
        ua = e['ua']
        a = agg.setdefault(ua, {'family': e['family'], 'first': e['first'], 'last': e['last'], 'requests': 0,
                                'blocked': 0, 'would': 0, 'nets': 0, 'evidence': collections.Counter(),
                                'verdicts': set(), 'samples': []})
        if not e.get('backfill'):  # backfill segments only correct the counts
            a['first'], a['last'] = min(a['first'], e['first']), max(a['last'], e['last'])
            if e['family'][0] in 'do' or a['family'][0] == 'f':
                a['family'] = e['family']
        a['requests'] += e['requests']
        a['blocked'] += e['blocked']
        a['would'] += e.get('would_block', 0)
        a['nets'] += e['nets']
        a['evidence'].update(e['evidence'])
        a['verdicts'].update(e['verdicts'])
        a['samples'] += [s for s in e['samples'] if s not in a['samples']][:3 - len(a['samples'])]
    shown = sorted(agg.items(), key=lambda kv: (kv[0] not in hot and kv[0] not in sweep_uas,
                                                'hot' not in kv[1]['verdicts'] and 'sweep' not in kv[1]['verdicts'],
                                                -kv[1]['requests']))[:args.limit]
    print(f'\nFamilies seen ({len(agg)}; "hot now" = blocking now, "was hot" = hot earlier in the period; '
          f'top {len(shown)}):')
    print(f"  {'family':8}  {'verdict':9} {'first seen':16}  {'last seen':16}  {'requests':>8} {'blocked':>7} "
          f"{'would':>6} {'IPs':>5}  {'F1':>5} {'F2':>5} {'OLD':>5}  client")
    for ua, a in shown:
        verdict = ('hot now' if ua in hot else 'sweep now' if ua in sweep_uas else
                   'was hot' if a['verdicts'] & {'hot', 'sweep'} else 'watch')
        fam = hot[ua]['family'] if ua in hot else a['family']
        print(f"  {fam:8}  {verdict:9} {a['first'][:16]:16}  {a['last'][:16]:16}  {a['requests']:>8} "
              f"{a['blocked']:>7} {a['would']:>6} {a['nets']:>5}  {a['evidence'].get('F1', 0):>5} "
              f"{a['evidence'].get('F2', 0):>5} {a['evidence'].get('OLD', 0):>5}  {short_ua(ua)}")
        for s in a['samples']:
            print(f'{"":12}e.g. {s[:110]}')
    if locks:
        print('\nOrigin lock refusals (direct, non-Cloudflare peers):')
        for day, e in sorted(locks.items()):
            print(f"  {day}  {e['refused']:>6} requests from about {e['peers']} peers; top: "
                  + ', '.join(f'{p} ({n})' for p, n in e['top'].most_common(5)))
    passes = [e for e in events if e['event'] == 'pass']
    events = [e for e in events if e['event'] != 'pass']
    if passes:
        print('\nChallenge button passes (blocked clients that clicked "kein Bot"; the false-positive meter):')
        per = collections.Counter((e['t'][:10], e.get('family', '?'), short_ua(e.get('ua', ''))) for e in passes)
        for (day, fam, ua), n in sorted(per.items()):
            print(f'  {day}  {n:>4}  {fam:12} {ua}')
    if events:
        print('\nChanges:')
        seen = set()
        events = [e for e in sorted(events, key=lambda e: e['t'])
                  if (e['event'], e['t'][:16], e.get('family'), e.get('mode')) not in seen
                  and not seen.add((e['event'], e['t'][:16], e.get('family'), e.get('mode')))]
        for e in events[-30:]:
            what = e.get('mode') or (f"rule {e['rule']}, {e['nets_at_trigger']} networks" if e['event'] == 'hot' else
                                     f"{e['nets']} networks, not blocked" if e['event'] == 'cluster' else '')
            print(f"  {e['t'][:16]}  {e['event']:8} {e.get('family', ''):8}  {what}  {short_ua(e.get('ua', ''))}")
    print('\nF1 = landing with a search-engine referrer on a URL that engine does not show; 3 unengaged networks in '
          '30 min make the user agent a hot family (f...). F2 = landing without referrer and without Sec-Fetch-User '
          'on an offer, outbound or filtered URL; it blocks only when 10 networks land on URLs a hot family forged '
          '(F2x, family d...). OLD = a referrerless landing without Sec-Fetch-User on any document page from desktop '
          'Chrome or Edge at least 6 majors behind the learned stable major, 10 networks in 30 min (family o...). '
          'S1 = one network and one browser-claiming user agent without any fetch metadata, 30+ referrerless '
          'documents an hour, no engagement (pair p...). SW = one fingerprint (user agent + Accept-Language) landing '
          'with Sec-Fetch-Site none or absent and no referrer (or a forged self referrer) on pages other than the home '
          'page from 10 unengaged networks in 30 min, user agent with < 3 genuinely engaged networks in 24 h (engaged = '
          'same-origin internal page view or soft navigation, or an outbound click); blocks that fingerprint\'s blind '
          'desktop landings (sweep s...). RT = a script runtime or HTTP library (Bun, node, undici, axios, '
          'python-requests, aiohttp, httpx, Go-http-client, okhttp, Java, ...; not curl, Wget, Python-urllib or Dart) '
          'fetching documents from 5 networks outside the owner\'s in 24 h: plain 403 (runtime r...). '
          'No family forms on a user agent '
          'with 3 or more engaged networks in 24 h. cluster = rotating referrerless cluster, listed only. A desktop '
          'Chromium browser with blind fetch metadata and a forged search referrer is blocked per request on every '
          'document page (block-blind). Never blocked: crawlers, OpenAI egress and Signature-Agent chatgpt.com, '
          "Google's Chrome prefetch proxy, utm_source and "
          'AI-assistant landings, genuine cross-site clicks. Every block shows the button page; passes are listed '
          'above. IPs = distinct addresses (IPv6 per /64) per day, summed over days.')


def cmd_policy(args) -> None:
    p = Policy.load(robots_file=args.robots_file, src=args.src)
    if args.nginx:
        print(p.nginx_conf(), end='')
        return
    print('source', p.source, '| search path', p.search_path, '| filter params', len(p.filter_params))
    for u in args.urls:
        print(f'{p.unshowable(u) or "showable":18} {u}')


def set_switch_text(name: str, text: str, label: str) -> None:
    path = os.path.join(CONFIG['nginx_dir'], name)
    old = switch_state(name)
    write_atomic(path, text)
    if subprocess.run(['/usr/sbin/nginx', '-t', '-q']).returncode != 0:
        write_atomic(path, old)
        sys.exit('nginx -t failed; unchanged')
    subprocess.run(['/usr/sbin/nginx', '-s', 'reload'], check=True)
    os.makedirs(CONFIG['state_dir'], exist_ok=True)
    ledger_append(CONFIG['state_dir'], [{'event': 'switch', 't': now_iso(time.time()), 'mode': label}])
    print(label)


def set_switch(name: str, var: str, on: bool, label: str) -> None:
    path = os.path.join(CONFIG['nginx_dir'], name)
    old = switch_state(name)
    write_atomic(path, f'# {label} (set {now_iso(time.time())})\nmap $host ${var} {{ default {1 if on else 0}; }}\n')
    if subprocess.run(['/usr/sbin/nginx', '-t', '-q']).returncode != 0:
        write_atomic(path, old)
        sys.exit('nginx -t failed; unchanged')
    subprocess.run(['/usr/sbin/nginx', '-s', 'reload'], check=True)
    os.makedirs(CONFIG['state_dir'], exist_ok=True)
    ledger_append(CONFIG['state_dir'], [{'event': 'switch', 't': now_iso(time.time()), 'mode': label}])
    print(label)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('run')
    r.add_argument('--from-start', action='store_true')
    r.add_argument('--observe', action='store_true', help='compute verdicts only, never write nginx files')
    r.add_argument('--state-dir')
    r.add_argument('--pass-server', action='store_true', help='serve the challenge button issuer')
    r.add_argument('--seed-combined', help='warm up from a combined-format access log')
    r.add_argument('--seed-hours', type=float, default=24)
    r.set_defaults(fn=cmd_run)
    ps = sub.add_parser('pass-server')
    ps.set_defaults(fn=cmd_pass_server)
    bf = sub.add_parser('backfill')
    bf.add_argument('day')
    bf.add_argument('--apply', action='store_true')
    bf.set_defaults(fn=cmd_backfill)
    wd = sub.add_parser('watchdog')
    wd.set_defaults(fn=cmd_watchdog)
    ls = sub.add_parser('learn-stable')
    ls.add_argument('paths', nargs='+')
    ls.add_argument('--state-dir')
    ls.set_defaults(fn=cmd_learn_stable)
    sd = sub.add_parser('seed')
    sd.add_argument('path', nargs='+', help='combined access log and/or guard log, oldest first')
    sd.add_argument('--until', help='ISO time: use the combined log only before this (the guard log takes over)')
    sd.add_argument('--hours', type=float, default=24)
    sd.add_argument('--state-dir')
    sd.set_defaults(fn=cmd_seed)
    lg = sub.add_parser('ledger')
    lg.add_argument('--days', type=int, default=7)
    lg.add_argument('--limit', type=int, default=15)
    lg.add_argument('--state-dir')
    lg.set_defaults(fn=cmd_ledger)
    po = sub.add_parser('policy')
    po.add_argument('--robots-file')
    po.add_argument('--src')
    po.add_argument('--nginx', action='store_true')
    po.add_argument('urls', nargs='*')
    po.set_defaults(fn=cmd_policy)
    mo = sub.add_parser('mode')
    mo.add_argument('mode', choices=['enforce', 'shadow'])
    mo.set_defaults(fn=lambda a: set_switch('mode.conf', 'evg_enforce', a.mode == 'enforce', f'guard mode {a.mode}'))
    lk = sub.add_parser('lock')
    lk.add_argument('state', choices=['on', 'off'])
    lk.set_defaults(fn=lambda a: set_switch('origin-lock.conf', 'evg_origin_lock', a.state == 'on',
                                            f'origin lock {a.state}'))
    bd = sub.add_parser('blind-docs', help='blind rule on every document page (on) or only unshowable URLs (off)')
    bd.add_argument('state', choices=['on', 'off'])
    bd.set_defaults(fn=lambda a: set_switch('blind-docs.conf', 'evg_blind_docs', a.state == 'on',
                                            f'blind on all document pages {a.state}'))
    sw = sub.add_parser('sweep', help='broad-sweep rule SW (CG2): on = blocks, off = logs would-sweep')
    sw.add_argument('state', choices=['on', 'off'])
    sw.set_defaults(fn=lambda a: set_switch('sweep.conf', 'evg_sweep_enforce', a.state == 'on',
                                            f'sweep rule SW {a.state}'))
    rt = sub.add_parser('runtime', help='script-runtime rule RT (CG2 r2): on = plain 403, off = logs would-runtime')
    rt.add_argument('state', choices=['on', 'off'])
    rt.set_defaults(fn=lambda a: set_switch('runtime.conf', 'evg_runtime_enforce', a.state == 'on',
                                            f'runtime rule RT {a.state}'))
    ch = sub.add_parser('challenge')
    ch.add_argument('state', choices=['on', 'off', 'preview'])
    ch.set_defaults(fn=lambda a: set_switch_text(
        'challenge.conf', f'# challenge page {a.state} (set {now_iso(time.time())})\n'
        + {'on': 'map $server_port $evg_challenge_sw { default 1; }\n',
           'off': 'map $server_port $evg_challenge_sw { default 0; }\n',
           'preview': 'map $server_port $evg_challenge_sw { default 0; 3303 1; }\n'}[a.state], f'challenge {a.state}'))
    args = ap.parse_args()
    args.fn(args)


if __name__ == '__main__':
    main()
