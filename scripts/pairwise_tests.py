"""Pairwise test of the POST /api/appointments request over HTTP.

  python scripts/pairwise_tests.py --base-url http://localhost:3000
  python scripts/pairwise_tests.py --base-url https://asa-challenge.fibosolutions.com

Five parameters (caller, vehicle, service, dealership, start time) would give 3 x 4 x 3 x 3 x 6 = 648 combinations.
The generator keeps the rows needed to cover every pair of values. The expected status follows the documented precedence:

  no token -> 401, wrong role (staff) -> 403, malformed body -> 400, bad start time -> 422, unknown record -> 404, otherwise 201

Valid bookings are cancelled again, so the script is safe on the live site.
"""

import argparse
import datetime as dt

from asa_client import Api, Results, find_free_start
from pairwise import all_pairs_covered, pairwise

PARAMETERS = {
    "caller": ["customer", "staff", "anonymous"],
    "vehicle": ["own", "someone-elses", "unknown", "empty"],
    "service": ["valid", "unknown", "empty"],
    "dealership": ["valid", "unknown", "empty"],
    "start": ["valid", "malformed", "missing", "off-grid", "past", "beyond-horizon"],
}


def expected_status(row):
    if row["caller"] == "anonymous":
        return 401
    if row["caller"] == "staff":
        return 403
    if row["vehicle"] == "empty" or row["service"] == "empty" or row["dealership"] == "empty" or row["start"] in ("malformed", "missing"):
        return 400
    if row["start"] in ("off-grid", "past", "beyond-horizon"):
        return 422
    if row["vehicle"] != "own" or row["service"] == "unknown" or row["dealership"] == "unknown":
        return 404
    return 201


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:3000")
    args = ap.parse_args()
    api = Api(args.base_url)
    r = Results()
    wick, winston = api.login("JoinWick"), api.login("Winston")
    tokens = {"customer": wick, "staff": winston, "anonymous": None}

    rows = pairwise(PARAMETERS)
    # Pairwise rarely produces the all-valid row and isolates no single fault, so add the baseline and every
    # one-factor-at-a-time variation of it.
    baseline = {"caller": "customer", "vehicle": "own", "service": "valid", "dealership": "valid", "start": "valid"}
    extra = [baseline]
    for name, values in PARAMETERS.items():
        extra += [{**baseline, name: v} for v in values if v != baseline[name]]
    rows += [e for e in extra if e not in rows]
    full = 1
    for v in PARAMETERS.values():
        full *= len(v)
    r.check(f"design covers every pair: {len(rows)} rows (pairwise + baseline + one-factor-at-a-time) instead of {full}", all_pairs_covered(PARAMETERS, rows))

    valid_start = find_free_start(api, wick, "kensington", "oil-change", vehicle="wick-mustang", min_days=25)
    now = dt.datetime.now(dt.timezone.utc)
    fmt = lambda t: t.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    starts = {
        "valid": valid_start,
        "malformed": "tomorrow",
        "off-grid": fmt(dt.datetime.fromisoformat(valid_start.replace("Z", "+00:00")) + dt.timedelta(minutes=7)),
        "past": fmt((now - dt.timedelta(days=2)).replace(minute=0, second=0, microsecond=0)),
        "beyond-horizon": fmt((now + dt.timedelta(days=90)).replace(minute=0, second=0, microsecond=0)),
    }
    vehicles = {"own": "wick-mustang", "someone-elses": "bond-db5", "unknown": "no-such-vehicle", "empty": ""}
    services = {"valid": "oil-change", "unknown": "no-such-service", "empty": ""}
    dealerships = {"valid": "kensington", "unknown": "no-such-dealership", "empty": ""}

    created = []
    try:
        for n, row in enumerate(rows, 1):
            body = {"vehicleId": vehicles[row["vehicle"]], "serviceTypeId": services[row["service"]], "dealershipId": dealerships[row["dealership"]]}
            if row["start"] != "missing":
                body["startTime"] = starts[row["start"]]
            status, resp = api.call("POST", "/appointments", tokens[row["caller"]], body)
            want = expected_status(row)
            label = f"#{n:02d} " + " / ".join(f"{k}={v}" for k, v in row.items())
            r.check(f"{label} -> {want}", status == want, f"got {status}: {resp}")
            if status == 201:
                created.append(resp["id"])
    finally:
        for appt_id in created:
            api.call("POST", f"/appointments/{appt_id}/cancel", wick)
        print(f"\nCleaned up {len(created)} test booking(s).")
    r.finish()


if __name__ == "__main__":
    main()
