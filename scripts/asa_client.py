"""Tiny HTTP client shared by the test scripts. Standard library only, so nothing needs installing."""

import datetime as dt
import json
import sys
import urllib.error
import urllib.request

PASSWORDS = {"JoinWick": "JoinWick", "JamesBond": "JamesBond", "Winston": "Winston"}
WICK_VEHICLES = ["wick-mustang", "wick-chevelle", "wick-charger"]
BOND_VEHICLES = ["bond-db5", "bond-esprit", "bond-dbs", "bond-2000gt"]


class Api:
    def __init__(self, base_url):
        self.base = base_url.rstrip("/")

    def call(self, method, path, token=None, body=None):
        """Returns (status, parsed JSON or None). Never raises on HTTP errors."""
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.base}/api{path}", data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                raw = res.read()
                return res.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, (json.loads(raw) if raw else None)
            except ValueError:
                return e.code, {"raw": raw.decode(errors="replace")}

    def login(self, username, password=None):
        status, body = self.call("POST", "/auth/login", body={"username": username, "password": password or PASSWORDS[username]})
        if status != 200:
            sys.exit(f"Login failed for {username}: {status} {body}")
        return body["token"]


def find_free_start(api, token, dealership, service, vehicle=None, min_days=30, wanted_free_hours=None):
    """Searches forward from today+min_days for an open day and returns the ISO start of a free slot near mid-morning."""
    day = dt.date.today() + dt.timedelta(days=min_days)
    for _ in range(40):
        q = f"/availability?dealershipId={dealership}&serviceTypeId={service}&date={day.isoformat()}"
        if vehicle:
            q += f"&vehicleId={vehicle}"
        status, body = api.call("GET", q, token)
        if status == 200 and body["open"]:
            free = [s["startTime"] for s in body["slots"] if s["available"]]
            if free:
                return free[len(free) // 3]
        day += dt.timedelta(days=1)
    sys.exit("Could not find a free day to test with")


class Results:
    """Collects PASS/FAIL lines and sets the exit code."""

    def __init__(self):
        self.failed = 0
        self.total = 0

    def check(self, name, ok, detail=""):
        self.total += 1
        if not ok:
            self.failed += 1
        print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not ok else ""))

    def finish(self):
        print(f"\n{self.total - self.failed}/{self.total} checks passed")
        sys.exit(1 if self.failed else 0)
