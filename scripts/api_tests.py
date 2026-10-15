"""Black-box API tests: login, roles, validation, booking, cancel, data isolation.

  python scripts/api_tests.py --base-url http://localhost:3000

Expects the seeded demo data. Bookings made by the script are cancelled at the end.
"""

import argparse

from asa_client import Api, Results, find_free_start


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:3000")
    args = ap.parse_args()
    api = Api(args.base_url)
    r = Results()

    # Login
    status, body = api.call("GET", "/health")
    r.check("health is public", status == 200 and body["status"] == "ok")
    for user, pw in [("joinwick", "JoinWick"), ("JoinWick", "joinwick"), ("JoinWick", "Join Wick"), ("Nobody", "x")]:
        s, b = api.call("POST", "/auth/login", body={"username": user, "password": pw})
        r.check(f"login rejects {user!r}/{pw!r}", s == 401 and b["error"]["code"] == "INVALID_CREDENTIALS")
    s, b = api.call("POST", "/auth/login", body={"username": ""})
    r.check("login validates the body", s == 400 and b["error"]["code"] == "INVALID_INPUT")

    wick, bond, winston = api.login("JoinWick"), api.login("JamesBond"), api.login("Winston")
    s, me = api.call("GET", "/me", winston)
    r.check("/me reports the staff role", s == 200 and me["role"] == "staff" and me["displayName"] == "Winston Scott")

    # Closed without a token
    for path in ["/catalog", "/appointments", "/vehicles", "/me"]:
        s, _ = api.call("GET", path)
        r.check(f"{path} needs a token", s == 401)
    s, _ = api.call("GET", "/appointments", "garbage.token.value")
    r.check("a forged token is rejected", s == 401)

    # Catalog and seed data
    s, cat = api.call("GET", "/catalog", wick)
    bays = sum(len(d["bays"]) for d in cat["dealerships"])
    techs = sum(len(d["technicians"]) for d in cat["dealerships"])
    r.check("catalog: 3 dealerships, 5 bays, 13 technicians, 24 services",
            (len(cat["dealerships"]), bays, techs, len(cat["services"])) == (3, 5, 13, 24),
            f"{len(cat['dealerships'])}/{bays}/{techs}/{len(cat['services'])}")
    durations = sorted({svc["durationMinutes"] for svc in cat["services"]})
    r.check("service durations are 30, 60, 120 and 240 minutes", durations == [30, 60, 120, 240], str(durations))

    # Roles and isolation
    s, v = api.call("GET", "/vehicles", wick)
    r.check("JoinWick has 3 vehicles", s == 200 and len(v) == 3)
    s, v = api.call("GET", "/vehicles", bond)
    r.check("JamesBond has 4 vehicles", s == 200 and len(v) == 4)
    s, _ = api.call("GET", "/vehicles", winston)
    r.check("staff has no vehicles endpoint (403)", s == 403)

    s, mine = api.call("GET", "/appointments", wick)
    r.check("customer sees only their own bookings", s == 200 and mine and all(a["customer"] == "JoinWick" for a in mine))
    s, theirs = api.call("GET", "/appointments", bond)
    r.check("the other customer sees a different set", theirs and not ({a["id"] for a in mine} & {a["id"] for a in theirs}))
    s, everything = api.call("GET", "/appointments", winston)
    r.check("staff sees both customers' bookings", {a["customer"] for a in everything} == {"JoinWick", "JamesBond"})
    s, brum = api.call("GET", "/appointments?dealershipId=birmingham", winston)
    r.check("staff dealership filter works", s == 200 and brum and all(a["dealershipId"] == "birmingham" for a in brum))
    s, cancelled = api.call("GET", "/appointments?status=CANCELLED", winston)
    r.check("staff status filter works", s == 200 and cancelled and all(a["status"] == "CANCELLED" for a in cancelled))

    s, _ = api.call("GET", f"/appointments/{mine[0]['id']}", bond)
    r.check("a customer cannot open another customer's booking (403)", s == 403)
    s, _ = api.call("POST", f"/appointments/{mine[0]['id']}/cancel", bond)
    r.check("a customer cannot cancel another customer's booking (403)", s == 403)

    # Booking validation
    start = find_free_start(api, wick, "manchester", "oil-change")
    good = {"vehicleId": "wick-mustang", "serviceTypeId": "oil-change", "dealershipId": "manchester", "startTime": start}
    s, b = api.call("POST", "/appointments", winston, good)
    r.check("staff cannot create bookings (403)", s == 403)
    s, b = api.call("POST", "/appointments", bond, good)
    r.check("a customer cannot book someone else's vehicle (404)", s == 404)
    s, b = api.call("POST", "/appointments", wick, {**good, "startTime": "tomorrow"})
    r.check("bad start time format is INVALID_INPUT", s == 400 and b["error"]["code"] == "INVALID_INPUT")
    s, b = api.call("POST", "/appointments", wick, {**good, "startTime": start.replace(":00:00", ":15:00")})
    r.check("start off the 30 minute grid is INVALID_START_TIME", s == 422 and b["error"]["code"] == "INVALID_START_TIME")
    s, b = api.call("POST", "/appointments", wick, {**good, "dealershipId": "atlantis"})
    r.check("unknown dealership is 404", s == 404)

    # Full lifecycle: book, clash, cancel frees, rebook
    created = []
    try:
        s, first = api.call("POST", "/appointments", wick, good)
        r.check("booking returns 201 with bay, technician, vehicle and customer",
                s == 201 and first["bayId"].startswith("manchester-bay") and first["technicianId"] and first["customer"] == "JoinWick" and first["vehicleId"] == "wick-mustang")
        if s == 201:
            created.append((wick, first["id"]))
            s, again = api.call("POST", "/appointments", wick, good)
            r.check("same vehicle, same time again is VEHICLE_BUSY", s == 409 and again["error"]["code"] == "VEHICLE_BUSY")
            other = {**good, "vehicleId": "bond-db5"}
            s, clash = api.call("POST", "/appointments", bond, other)
            r.check("another customer, same single bay: SLOT_UNAVAILABLE with alternatives",
                    s == 409 and clash["error"]["code"] == "SLOT_UNAVAILABLE" and len(clash["error"].get("alternatives", [])) > 0)
            s, av = api.call("GET", f"/availability?dealershipId=manchester&serviceTypeId=oil-change&date={start[:10]}", bond)
            slot = next((x for x in av["slots"] if x["startTime"] == start), None)
            r.check("availability shows the booked time as unavailable", slot is not None and slot["available"] is False)

            s, cancelled_appt = api.call("POST", f"/appointments/{first['id']}/cancel", wick)
            r.check("owner cancels (200, status CANCELLED)", s == 200 and cancelled_appt["status"] == "CANCELLED")
            s, twice = api.call("POST", f"/appointments/{first['id']}/cancel", wick)
            r.check("cancelling twice is ALREADY_CANCELLED", s == 409 and twice["error"]["code"] == "ALREADY_CANCELLED")
            s, rebook = api.call("POST", "/appointments", bond, other)
            r.check("the freed slot can be booked by someone else", s == 201)
            if s == 201:
                created.append((bond, rebook["id"]))
            s, back = api.call("POST", "/appointments", wick, {**good, "dealershipId": "kensington"})
            if s == 201:
                created.append((wick, back["id"]))
            r.check("the cancelled vehicle is free again for another dealership at that time", s == 201, str(back))

            s, staff_cancel = api.call("POST", f"/appointments/{rebook['id']}/cancel", winston)
            r.check("staff can cancel a customer's booking", s == 200)
            created = [c for c in created if c[1] != rebook["id"]]
    finally:
        for token, appt_id in created:
            api.call("POST", f"/appointments/{appt_id}/cancel", token)

    r.finish()


if __name__ == "__main__":
    main()
