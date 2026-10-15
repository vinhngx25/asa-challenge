"""Post-deploy smoke test: is the deployed site up, secured and able to book?

  python scripts/smoke_test.py --base-url https://asa-challenge.fibosolutions.com
"""

import argparse
import urllib.request

from asa_client import Api, Results, find_free_start


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    args = ap.parse_args()
    base = args.base_url.rstrip("/")
    api = Api(base)
    r = Results()

    with urllib.request.urlopen(base + "/", timeout=30) as res:
        html = res.read().decode()
        r.check("home page is served over HTTPS" if base.startswith("https") else "home page is served", res.status == 200 and "<div id=\"root\">" in html)
        r.check("HSTS header present", base.startswith("http://") or "max-age" in (res.headers.get("Strict-Transport-Security") or ""))
        r.check("CSP header present", "default-src" in (res.headers.get("Content-Security-Policy") or "") or base.startswith("http://"))
    with urllib.request.urlopen(base + "/book", timeout=30) as res:
        r.check("deep link /book serves the app", res.status == 200 and "<div id=\"root\">" in res.read().decode())

    s, b = api.call("GET", "/health")
    r.check("API health", s == 200 and b["status"] == "ok")
    s, _ = api.call("GET", "/catalog")
    r.check("API refuses data without a token", s == 401)
    s, b = api.call("GET", "/nope", api.login("JoinWick"))
    r.check("unknown API route is a real 404", s == 404)

    token = api.login("JoinWick")
    s, cat = api.call("GET", "/catalog", token)
    r.check("seed data present (3 dealerships, 24 services)", s == 200 and len(cat["dealerships"]) == 3 and len(cat["services"]) == 24)

    start = find_free_start(api, token, "kensington", "oil-change", vehicle="wick-charger", min_days=45)
    s, appt = api.call("POST", "/appointments", token, {"vehicleId": "wick-charger", "serviceTypeId": "oil-change", "dealershipId": "kensington", "startTime": start})
    r.check("booking works end to end", s == 201 and appt["status"] == "BOOKED")
    if s == 201:
        s, c = api.call("POST", f"/appointments/{appt['id']}/cancel", token)
        r.check("cancel works end to end", s == 200 and c["status"] == "CANCELLED")
    r.finish()


if __name__ == "__main__":
    main()
