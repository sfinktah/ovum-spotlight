import re
import logging
from typing import List, Dict
from urllib.parse import quote_plus, urlparse

# noinspection PyUnresolvedReferences,PyPackageRequirements
from server import PromptServer
# noinspection PyPackageRequirements
from aiohttp import web, ClientSession, ClientTimeout

logger = logging.getLogger(__name__)

# Spotlight demo and helpers
SPOTLIGHT_API_BASE = '/ovum/spotlight'


@PromptServer.instance.routes.get(f"{SPOTLIGHT_API_BASE}/google")
async def spotlight_google(request: web.Request):
    """Fetch Google search results for a query and return simplified JSON.
    Attempts live fetch; on error, returns a fallback linking to Google search page.  Probably doesn't work, but is a good example.
    Uses Google's 'udm=14' Web results view for simpler, more stable HTML and relays client cookies to avoid consent interstitials.
    """
    q = request.query.get('q') or ''
    if not q:
        return web.json_response({"error": True, "message": "missing q"}, status=400)
    results: List[Dict[str, str]] = []
    live_ok = False
    try:
        timeout = ClientTimeout(total=8)
        # Relay client cookies (helps bypass consent in some regions). If missing, add a minimal CONSENT cookie.
        client_cookie = request.headers.get('Cookie') or request.headers.get('cookie') or ''
        outgoing_cookie = client_cookie.strip()
        if 'CONSENT=' not in outgoing_cookie:
            outgoing_cookie = (outgoing_cookie + '; ' if outgoing_cookie else '') + 'CONSENT=YES+'
        accept_lang = request.headers.get('Accept-Language') or request.headers.get('accept-language') or 'en-US,en;q=0.9'
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": accept_lang,
            "Referer": "https://www.google.com/",
            "Cookie": outgoing_cookie,
        }
        # Use udm=14 to get the Web results-only view with simpler markup
        url = f"https://www.google.com/search?hl=en&gl=us&pws=0&num=10&udm=14&q={quote_plus(q)}"
        async with ClientSession(timeout=timeout) as sess:
            async with sess.get(url, headers=headers) as resp:
                html = await resp.text()
        # Try to extract results from direct links first (udm=14 often uses direct outbound links)
        link_direct_pattern = re.compile(
            r'<a[^>]+href="(https?://[^"]+)"[^>]*>\s*(?:<h3[^>]*>(.*?)</h3>)?',
            re.IGNORECASE | re.DOTALL
        )
        link_redirect_pattern = re.compile(
            r'<a href="/url\?q=([^"&]+)[^>]*>\s*(?:<h3[^>]*>(.*?)</h3>)?',
            re.IGNORECASE | re.DOTALL
        )
        urls: List[str] = []
        titles: List[str] = []
        # Helper to add a match if valid and not a Google internal URL
        def add_match(u_raw: str, t_raw: str):
            u = u_raw.strip()
            if not u.lower().startswith('http'):
                return
            try:
                netloc = urlparse(u).netloc.lower()
            except Exception:
                netloc = ''
            if netloc.endswith('.google.com') or netloc.endswith('.googleusercontent.com') or netloc.endswith('.gstatic.com') or netloc.endswith('.google'):
                # Allow sites.google.com (actual user content)
                if not netloc.startswith('sites.google.com'):
                    return
            if u in urls:
                return
            t = re.sub(r'<[^>]+>', '', (t_raw or '').strip())
            urls.append(u)
            titles.append(t or u)
        for m in link_direct_pattern.finditer(html):
            add_match(m.group(1), m.group(2) or '')
            if len(urls) >= 10:
                break
        if len(urls) < 10:
            for m in link_redirect_pattern.finditer(html):
                add_match(m.group(1), m.group(2) or '')
                if len(urls) >= 10:
                    break
        # Try to capture snippets; use common containers, but keep best-effort only
        snippets: List[str] = []
        snippet_patterns = [
            re.compile(r'<div class="VwiC3b[^>]*>(.*?)</div>', re.IGNORECASE | re.DOTALL),
            re.compile(r'<span class="MUxGbd[^>]*>(.*?)</span>', re.IGNORECASE | re.DOTALL),
        ]
        for pat in snippet_patterns:
            for m in pat.finditer(html):
                s = re.sub(r'<[^>]+>', '', (m.group(1) or '')).strip()
                if s:
                    snippets.append(s)
            if len(snippets) >= len(urls):
                break
        for i, u in enumerate(urls):
            results.append({
                "title": titles[i] if i < len(titles) else u,
                "url": u,
                "snippet": snippets[i] if i < len(snippets) else ''
            })
        live_ok = len(results) > 0
    except Exception as e:
        logger.info(f"[ovum] spotlight google fetch failed: {e}")
        live_ok = False
    if not live_ok:
        # Fallback: single link to Google search page (use Web results view)
        gurl = f"https://www.google.com/search?hl=en&gl=us&pws=0&num=10&udm=14&q={quote_plus(q)}"
        results = [{
            "title": f"Open Google search for '{q}'",
            "url": gurl,
            "snippet": "Live results unavailable; click to open in browser."
        }]
    return web.json_response({"q": q, "results": results})


@PromptServer.instance.routes.get(f"{SPOTLIGHT_API_BASE}/age")
async def spotlight_age(request: web.Request):
    """Proxy to agify.io to predict age from a given name.
    Returns JSON: { name, age, count }.
    """
    name = request.query.get('name') or ''
    if not name:
        return web.json_response({"error": True, "message": "missing name"}, status=400)
    try:
        timeout = ClientTimeout(total=30)
        url = f"https://api.agify.io/?name={quote_plus(name)}"
        async with ClientSession(timeout=timeout) as sess:
            async with sess.get(url) as resp:
                data = await resp.json()
        # Normalize response
        age = data.get('age') if isinstance(data, dict) else None
        count = data.get('count') if isinstance(data, dict) else None
        return web.json_response({"name": name, "age": age, "count": count})
    except Exception as e:
        logger.info(f"[ovum] spotlight age fetch failed: {e}")
        return web.json_response(
            {"name": name, "age": None, "count": None, "error": True, "message": "fetch failed"}, status=502)
