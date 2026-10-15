"""Boundary value tests over HTTP: field lengths, body shapes, date and time formats, horizon and grid edges.

  python scripts/boundary_tests.py --base-url http://localhost:3000
  python scripts/boundary_tests.py --base-url https://asa-challenge.fibosolutions.com

Business-rule boundaries that need a controlled clock (lead time to the millisecond, cancel cut-off, clock changes,
a full one-bay day) are covered by backend/test/boundary.integration.test.ts. Everything here is safe to run on the live site:
bookings made are cancelled again.
"""

import argparse
import datetime as dt
import json
import urllib.error
import urllib.parse
import urllib.request

from asa_client import Api, Results, find_free_start


def raw_post(base, path, data, token=None):
    """POST a raw string body (to send malformed JSON)."""
    req = urllib.request.Request(f"{base}/api{path}", data=data.encode(), method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "null")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:3000")
    args = ap.parse_args()
    api = Api(args.base_url)
    r = Results()

    # Login field lengths
    login = lambda u, p: api.call("POST", "/auth/login", body={"username": u, "password": p})[0]
    r.check("login: empty username -> 400", login("", "x") == 400)
    r.check("login: empty password -> 400", login("x", "") == 400)
    r.check("login: 1 char each -> 401 (valid shape, wrong credentials)", login("a", "b") == 401)
    r.check("login: username 31 chars -> 401", login("a" * 31, "b") == 401)
    r.check("login: username 32 chars (the limit) -> 401", login("a" * 32, "b") == 401)
    r.check("login: username 33 chars -> 400", login("a" * 33, "b") == 400)
    r.check("login: password 31 chars -> 401", login("a", "b" * 31) == 401)
    r.check("login: password 32 chars (the limit) -> 401", login("a", "b" * 32) == 401)
    r.check("login: password 33 chars -> 400", login("a", "b" * 33) == 400)

    # Body shapes
    r.check("body: malformed JSON -> 400", raw_post(api.base, "/auth/login", "{not json")[0] == 400)
    r.check("body: JSON array -> 400", raw_post(api.base, "/auth/login", "[]")[0] == 400)
    r.check("body: JSON null -> 400", raw_post(api.base, "/auth/login", "null")[0] == 400)
    r.check("body: wrong field types -> 400", api.call("POST", "/auth/login", body={"username": 1, "password": 2})[0] == 400)
    r.check("body: missing password -> 400", api.call("POST", "/auth/login", body={"username": "JoinWick"})[0] == 400)
    r.check("body: extra fields are ignored -> 200", api.call("POST", "/auth/login", body={"username": "JoinWick", "password": "JoinWick", "x": 1})[0] == 200)

    token = api.login("JoinWick")

    # Availability date
    def avail(date):
        return api.call("GET", f"/availability?dealershipId=kensington&serviceTypeId=mot&date={urllib.parse.quote(date)}", token)

    for bad in ["", "2026-02-30", "2027-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-1-1", "26-01-01", "abcd-ef-gh", "2026/01/01", "0000-01-01"]:
        r.check(f"availability date {bad!r} -> 400", avail(bad)[0] == 400)
    for good in ["2028-02-29", "2026-12-31", "2027-01-01", "1999-12-31", "2100-01-03"]:
        r.check(f"availability date {good!r} -> 200", avail(good)[0] == 200)
    s, past = avail("1999-12-31")
    r.check("a date in the past has no available slots", s == 200 and not any(x["available"] for x in past["slots"]))
    s, sunday = avail("2030-01-06")  # a Sunday
    r.check("Sunday is closed with no slots", s == 200 and sunday["open"] is False and sunday["slots"] == [])

    # Availability on both sides of the clock changes (Kensington opens 08:00 local)
    s, bst = avail("2030-07-02")
    s2, gmt = avail("2030-01-08")
    r.check("summer day opens 07:00Z, winter day opens 08:00Z",
            bst["slots"][0]["startTime"].endswith("T07:00:00.000Z") and gmt["slots"][0]["startTime"].endswith("T08:00:00.000Z"))
    r.check("both days list the same number of slots", len(bst["slots"]) == len(gmt["slots"]))

    # Start time formats
    start = find_free_start(api, token, "kensington", "fluid-check", vehicle="wick-mustang")
    body = {"vehicleId": "wick-mustang", "serviceTypeId": "fluid-check", "dealershipId": "kensington", "startTime": start}
    for bad in ["", "tomorrow", "2026-10-21", "2026-10-21T10:00", "2026-10-21 10:00:00Z", 20261021, None, "2026-10-21T10:00:00+01:00"]:
        s, b = api.call("POST", "/appointments", token, {**body, "startTime": bad})
        r.check(f"startTime {bad!r} -> 400", s == 400 and b["error"]["code"] == "INVALID_INPUT")

    # Grid: exact slot start succeeds; +/- 1 ms, 1 min, 29 min fail
    base = dt.datetime.fromisoformat(start.replace("Z", "+00:00"))
    for delta in [dt.timedelta(milliseconds=-1), dt.timedelta(milliseconds=1), dt.timedelta(minutes=-1), dt.timedelta(minutes=1), dt.timedelta(minutes=-29), dt.timedelta(minutes=29)]:
        t = (base + delta).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        s, b = api.call("POST", "/appointments", token, {**body, "startTime": t})
        r.check(f"start off the grid by {delta // dt.timedelta(milliseconds=1):+d} ms -> 422", s == 422 and b["error"]["code"] == "INVALID_START_TIME")

    # Too soon and beyond the horizon
    now = dt.datetime.now(dt.timezone.utc)
    def at(delta):
        t = now + delta
        t = t.replace(minute=0 if t.minute < 30 else 30, second=0, microsecond=0)
        return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    s, b = api.call("POST", "/appointments", token, {**body, "startTime": at(dt.timedelta(minutes=-30))})
    r.check("a start in the past -> 422", s == 422 and b["error"]["code"] == "INVALID_START_TIME")
    s, b = api.call("POST", "/appointments", token, {**body, "startTime": at(dt.timedelta(minutes=30))})
    r.check("a start 30 minutes ahead (under the 60 minute lead) -> 422", s == 422 and b["error"]["code"] == "INVALID_START_TIME")
    s, b = api.call("POST", "/appointments", token, {**body, "startTime": at(dt.timedelta(days=61))})
    r.check("a start 61 days ahead (beyond the horizon) -> 422", s == 422 and b["error"]["code"] == "INVALID_START_TIME")

    # The one valid start books and cancels
    s, ok = api.call("POST", "/appointments", token, body)
    r.check("the exact valid start books (201)", s == 201)
    if s == 201:
        s, c = api.call("POST", f"/appointments/{ok['id']}/cancel", token)
        r.check("and cancels (200)", s == 200 and c["status"] == "CANCELLED")

    # List filters
    r.check("list: from=yesterday -> 400", api.call("GET", "/appointments?from=yesterday", token)[0] == 400)
    r.check("list: status=DONE -> 400", api.call("GET", "/appointments?status=DONE", token)[0] == 400)
    r.check("list: valid range -> 200", api.call("GET", "/appointments?from=2026-01-01T00:00:00Z&to=2030-01-01T00:00:00Z", token)[0] == 200)

    r.finish()


if __name__ == "__main__":
    main()
