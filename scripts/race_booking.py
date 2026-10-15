"""Simulates rare concurrency cases against a running API and proves nobody gets double booked.

  python scripts/race_booking.py --base-url http://localhost:3000
  python scripts/race_booking.py --base-url https://asa-challenge.fibosolutions.com

Every scenario fires its requests at the same instant (threads released by one barrier).
All bookings made by the script are cancelled at the end.
"""

import argparse
import threading

from asa_client import BOND_VEHICLES, WICK_VEHICLES, Api, Results, find_free_start


def fire(api, attempts):
    """attempts: list of (token, body). Returns a list of (status, body) in the same order."""
    barrier = threading.Barrier(len(attempts))
    out = [None] * len(attempts)

    def run(i, token, body):
        barrier.wait()
        out[i] = api.call("POST", "/appointments", token, body)

    threads = [threading.Thread(target=run, args=(i, t, b)) for i, (t, b) in enumerate(attempts)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:3000")
    args = ap.parse_args()
    api = Api(args.base_url)
    res = Results()
    wick, bond = api.login("JoinWick"), api.login("JamesBond")
    all_vehicles = [(wick, v) for v in WICK_VEHICLES] + [(bond, v) for v in BOND_VEHICLES]
    created = []  # (token, appointment id)

    def keep(results, tokens):
        for (status, body), tok in zip(results, tokens):
            if status == 201:
                created.append((tok, body["id"]))

    try:
        # 1. One bay, seven vehicles, one slot.
        start = find_free_start(api, wick, "manchester", "oil-change")
        attempts = [(t, {"vehicleId": v, "serviceTypeId": "oil-change", "dealershipId": "manchester", "startTime": start}) for t, v in all_vehicles]
        out = fire(api, attempts)
        keep(out, [t for t, _ in all_vehicles])
        wins = [o for o in out if o[0] == 201]
        losses = [o for o in out if o[0] == 409]
        res.check("1 bay, 7 simultaneous requests: exactly one booking succeeds", len(wins) == 1, f"{len(wins)} succeeded")
        res.check("1 bay, 7 simultaneous requests: the other six get 409", len(losses) == 6, f"{[o[0] for o in out]}")
        res.check("losers receive SLOT_UNAVAILABLE or VEHICLE_BUSY with a request id",
                  all(o[1]["error"]["code"] in ("SLOT_UNAVAILABLE", "VEHICLE_BUSY") and o[1]["error"]["requestId"] for o in losses))

        # 2. Two bays and two qualified technicians, seven vehicles.
        start = find_free_start(api, wick, "kensington", "mot")
        attempts = [(t, {"vehicleId": v, "serviceTypeId": "mot", "dealershipId": "kensington", "startTime": start}) for t, v in all_vehicles]
        out = fire(api, attempts)
        keep(out, [t for t, _ in all_vehicles])
        wins = [o[1] for o in out if o[0] == 201]
        res.check("2 bays + 2 qualified technicians: exactly two succeed", len(wins) == 2, f"{len(wins)} succeeded")
        res.check("the two winners hold different bays", len({w["bayId"] for w in wins}) == len(wins))
        res.check("the two winners hold different technicians", len({w["technicianId"] for w in wins}) == len(wins))

        # 3. The same vehicle submitted five times at once (double click, retry storm).
        start = find_free_start(api, wick, "birmingham", "mot", vehicle="wick-charger")
        body = {"vehicleId": "wick-charger", "serviceTypeId": "mot", "dealershipId": "birmingham", "startTime": start}
        out = fire(api, [(wick, body)] * 5)
        keep(out, [wick] * 5)
        res.check("same vehicle x5 at once: exactly one booking", sum(1 for o in out if o[0] == 201) == 1, f"{[o[0] for o in out]}")

        # 4. Overlapping jobs of different lengths racing for the one Manchester bay.
        start = find_free_start(api, wick, "manchester", "full-service", vehicle="wick-mustang")
        long_job = {"vehicleId": "wick-mustang", "serviceTypeId": "full-service", "dealershipId": "manchester", "startTime": start}
        short_job = {"vehicleId": "bond-db5", "serviceTypeId": "fluid-check", "dealershipId": "manchester", "startTime": start}
        out = fire(api, [(wick, long_job), (bond, short_job)])
        keep(out, [wick, bond])
        res.check("overlapping jobs, one bay: exactly one wins", sum(1 for o in out if o[0] == 201) == 1, f"{[o[0] for o in out]}")

        # 5. Cancel and rebook racing: the freed slot is taken by exactly one newcomer.
        start = find_free_start(api, wick, "manchester", "oil-change")
        first = api.call("POST", "/appointments", wick, {"vehicleId": "wick-mustang", "serviceTypeId": "oil-change", "dealershipId": "manchester", "startTime": start})
        res.check("setup booking created", first[0] == 201)
        if first[0] == 201:
            appt_id = first[1]["id"]
            blocked = api.call("POST", "/appointments", bond, {"vehicleId": "bond-db5", "serviceTypeId": "oil-change", "dealershipId": "manchester", "startTime": start})
            res.check("slot is blocked while the booking stands", blocked[0] == 409)
            api.call("POST", f"/appointments/{appt_id}/cancel", wick)
            rivals = [(bond, {"vehicleId": v, "serviceTypeId": "oil-change", "dealershipId": "manchester", "startTime": start}) for v in BOND_VEHICLES]
            out = fire(api, rivals)
            keep(out, [bond] * len(rivals))
            res.check("after cancel, four rivals race: exactly one takes the freed slot", sum(1 for o in out if o[0] == 201) == 1, f"{[o[0] for o in out]}")
    finally:
        cancelled = 0
        for token, appt_id in created:
            status, _ = api.call("POST", f"/appointments/{appt_id}/cancel", token)
            cancelled += status == 200
        print(f"\nCleaned up {cancelled} test booking(s).")
    res.finish()


if __name__ == "__main__":
    main()
