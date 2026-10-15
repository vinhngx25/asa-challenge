"""Input sweep: every text field and parameter the API accepts, with boundary lengths and hostile values.

  python scripts/input_tests.py --base-url http://localhost:3000
  python scripts/input_tests.py --base-url https://asa-challenge.fibosolutions.com

Fields covered
  login        username (max 32), password (max 32)
  booking      vehicleId, serviceTypeId, dealershipId (max 64 each)
  availability dealershipId, serviceTypeId, vehicleId (max 64 each), date
  list         dealershipId (max 64), from, to, status
  paths        appointment id in GET /appointments/{id} and POST /appointments/{id}/cancel (max 64)
  header       Authorization

For each field: empty, one character, limit - 1, the limit, limit + 1, far over the limit, and hostile values (HTML, SQL-like,
path traversal, control characters, unicode, emoji, whitespace only, very long). Rules checked:
  1. no server error (5xx) for any value;
  2. every 4xx answer from the application has the JSON error shape with a request id;
  3. at the limit the value is accepted as well formed (the answer is 401 or 404, not 400); one over the limit is 400;
  4. nothing sent comes back unescaped in an answer (no reflected "<script", the API stores no free text).
Safe on the live site: no booking is created.
"""

import argparse
import urllib.error
import urllib.parse
import urllib.request

from asa_client import Api, Results

LIMIT = {"username": 32, "password": 32, "id": 64}

HOSTILE = {
    "html": '<script>alert(1)</script><img src=x onerror=alert(2)>',
    "sql": "' OR 1=1 --",
    "traversal": "../../etc/passwd",
    "encoded-null": "%00%2e%2e",
    "control": "a\u0000b\u0007c\td",
    "newline": "line1\nline2\r\nline3",
    "unicode": "ünï©ødé–日本語العربية",
    "emoji": "\U0001F697" * 8,
    "spaces": "     ",
    "quotes": "\"'`\\",
}

START = "2030-01-08T10:00:00.000Z"  # beyond the booking horizon: the id checks come first, so no booking can happen


def shaped(status, body):
    """True when a client error is the application's JSON error with a request id."""
    return isinstance(body, dict) and isinstance(body.get("error"), dict) and bool(body["error"].get("requestId"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:3000")
    args = ap.parse_args()
    api = Api(args.base_url)
    r = Results()
    wick, staff = api.login("JoinWick"), api.login("Winston")

    problems = []  # (field, label, status, detail)

    def probe(field, label, status, body):
        if status >= 500:
            problems.append((field, label, status, "server error"))
        elif status >= 400 and status not in (413, 414, 431) and not shaped(status, body):
            problems.append((field, label, status, f"not the error shape: {str(body)[:60]}"))
        if body is not None and "<script" in str(body).lower():
            problems.append((field, label, status, "hostile text reflected in the answer"))

    def values_for(limit):
        v = {"empty": "", "one": "a"}
        if limit:
            v.update({f"limit-1": "a" * (limit - 1), "limit": "a" * limit, "limit+1": "a" * (limit + 1)})
        v.update({"300": "a" * 300, "3000": "a" * 3000})
        v.update(HOSTILE)
        return v

    def q(v):
        return urllib.parse.quote(v, safe="")

    # name: (limit, caller(value) -> (status, body), expected status at limit, and what "well formed" gives)
    fields = {
        "login.username": (LIMIT["username"], lambda v: api.call("POST", "/auth/login", body={"username": v, "password": "x"}), {401}),
        "login.password": (LIMIT["password"], lambda v: api.call("POST", "/auth/login", body={"username": "JoinWick", "password": v}), {401}),
        "booking.vehicleId": (LIMIT["id"], lambda v: api.call("POST", "/appointments", wick, {"vehicleId": v, "serviceTypeId": "oil-change", "dealershipId": "kensington", "startTime": START}), {404, 422}),
        "booking.serviceTypeId": (LIMIT["id"], lambda v: api.call("POST", "/appointments", wick, {"vehicleId": "wick-mustang", "serviceTypeId": v, "dealershipId": "kensington", "startTime": START}), {404, 422}),
        "booking.dealershipId": (LIMIT["id"], lambda v: api.call("POST", "/appointments", wick, {"vehicleId": "wick-mustang", "serviceTypeId": "oil-change", "dealershipId": v, "startTime": START}), {404, 422}),
        "availability.dealershipId": (LIMIT["id"], lambda v: api.call("GET", f"/availability?dealershipId={q(v)}&serviceTypeId=oil-change&date=2030-01-08", wick), {404}),
        "availability.serviceTypeId": (LIMIT["id"], lambda v: api.call("GET", f"/availability?dealershipId=kensington&serviceTypeId={q(v)}&date=2030-01-08", wick), {404}),
        "availability.vehicleId": (LIMIT["id"], lambda v: api.call("GET", f"/availability?dealershipId=kensington&serviceTypeId=oil-change&date=2030-01-08&vehicleId={q(v)}", wick), {404}),
        "availability.date": (None, lambda v: api.call("GET", f"/availability?dealershipId=kensington&serviceTypeId=oil-change&date={q(v)}", wick), None),
        "list.dealershipId": (LIMIT["id"], lambda v: api.call("GET", f"/appointments?dealershipId={q(v)}", staff), {200}),
        "list.from": (None, lambda v: api.call("GET", f"/appointments?from={q(v)}", staff), None),
        "list.to": (None, lambda v: api.call("GET", f"/appointments?to={q(v)}", staff), None),
        "list.status": (None, lambda v: api.call("GET", f"/appointments?status={q(v)}", staff), None),
        "path.appointmentId (get)": (LIMIT["id"], lambda v: api.call("GET", f"/appointments/{q(v)}", wick), {404}),
        "path.appointmentId (cancel)": (LIMIT["id"], lambda v: api.call("POST", f"/appointments/{q(v)}/cancel", wick), {404}),
    }

    for name, (limit, call, at_limit_ok) in fields.items():
        count = 0
        for label, v in values_for(limit).items():
            if name.startswith("path.") and v == "":
                continue  # an empty path segment is a different route
            status, body = call(v)
            probe(name, label, status, body)
            count += 1
            if limit and label == "limit":
                ok = status in at_limit_ok
                r.check(f"{name}: exactly {limit} characters is accepted as well formed", ok, f"got {status} {str(body)[:80]}")
            if limit and label == "limit+1":
                r.check(f"{name}: {limit + 1} characters is invalid input (400)", status == 400 and shaped(status, body), f"got {status}")
            if limit and label == "empty" and not name.startswith("path."):
                r.check(f"{name}: empty is invalid input (400)", status == 400, f"got {status}")
        r.check(f"{name}: {count} values (boundaries and hostile text) give no server error and a clean error shape", not [p for p in problems if p[0] == name], str([p for p in problems if p[0] == name][:3]))

    # Authorization header variants
    def with_auth(header_value):
        req = urllib.request.Request(f"{api.base}/api/appointments", method="GET")
        if header_value is not None:
            req.add_header("Authorization", header_value)
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.status, None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                import json
                return e.code, json.loads(raw)
            except Exception:
                return e.code, None

    variants = {"missing": None, "empty": "", "scheme only": "Bearer", "scheme and space": "Bearer ", "basic": "Basic dXNlcjpwYXNz",
                "short garbage": "Bearer x", "1 KB": "Bearer " + "a" * 1024, "7 KB": "Bearer " + "a" * 7000, "html": "Bearer <script>alert(1)</script>"}
    for label, hv in variants.items():
        status, body = with_auth(hv)
        probe("header.Authorization", label, status, body)
        r.check(f"Authorization header {label!r}: refused without a server error", status in (400, 401, 413, 414, 431) , f"got {status}")

    r.finish()


if __name__ == "__main__":
    main()
