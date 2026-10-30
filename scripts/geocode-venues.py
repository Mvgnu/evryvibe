"""One-off, cached Nominatim lookup of public venue addresses; never writes DB.

Input: JSON array of {id, slug, name, address, city, country} exported from venues.
Review returned OSM objects before importing coordinates. No scheduled runs or
autocomplete: https://operations.osmfoundation.org/policies/nominatim/
"""
import argparse
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("input", type=Path)
parser.add_argument("cache", type=Path)
parser.add_argument("--names", action="store_true", help="Search venue names instead of addresses")
args = parser.parse_args()
endpoint = os.environ.get("EVRYVIBE_GEOCODER_URL", "https://nominatim.openstreetmap.org/search")
if urllib.parse.urlparse(endpoint).scheme != "https":
    raise ValueError("Geocoder must use HTTPS")
venues = json.loads(args.input.read_text())
cache = json.loads(args.cache.read_text()) if args.cache.exists() else {}
for venue in venues:
    query = (f"{venue['name']}, {venue['city']}" if args.names else venue["address"]) + f", {venue['country']}"
    key = endpoint + "?" + urllib.parse.urlencode({"q": query, "format": "jsonv2", "addressdetails": 1, "namedetails": 1, "limit": 5})
    if key not in cache:
        request = urllib.request.Request(key, headers={
            "User-Agent": "EVRYVIBE-VenueCoordinates/1.0 (https://evryvibe.com; legal@evryvibe.com)",
            "Accept": "application/json",
        })
        # Fail closed on provider errors/rate limits. No retry loop.
        with urllib.request.urlopen(request, timeout=25) as response:
            results = json.load(response)
        if not isinstance(results, list) or len(results) > 5:
            raise ValueError("Invalid geocoder response")
        cache[key] = results
        temporary = args.cache.with_suffix(args.cache.suffix + ".tmp")
        temporary.write_text(json.dumps(cache, ensure_ascii=False, indent=2))
        temporary.replace(args.cache)
        # Single process, more than one second after every response.
        time.sleep(1.1)
    print(json.dumps({"slug": venue["slug"], "query": query, "results": cache[key]}, ensure_ascii=False), flush=True)
