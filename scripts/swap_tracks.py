#!/usr/bin/env python3
"""
Move one registration onto different tracks.

Price-neutral by construction: only beginner_track_id / advanced_track_id are
rewritten. sku, has_capstone and amount_paid are never touched, so a bundle
stays a bundle at the same price. A replacement track must sit in the same
segment as the slot it fills, which is what keeps that guarantee true.

DRY RUN unless --commit is passed. Nothing is written without it.

    # look, change nothing
    python scripts/swap_tracks.py --email someone@example.com --beginner python --advanced ai

    # actually do it
    python scripts/swap_tracks.py --email someone@example.com --beginner python --advanced ai --commit

    # by order id instead
    python scripts/swap_tracks.py --order-id PFE-XXXXXXXXXX --advanced cybersecurity --commit

Database comes from --db-url, else $DATABASE_URL. The host is printed on every
run -- read it before trusting the output. A shell-exported DATABASE_URL beats
anything in .env, which is exactly how a migration once went to the wrong
database, so pass --db-url when you care.

Requires psycopg2 (already installed):  pip install psycopg2-binary
"""

import argparse
import json
import os
import sys

import psycopg2
import psycopg2.extras

# Mirrors occupiesSeat() in src/lib/registration/capacity.ts: a seat is held by
# a settled row, or by a pending one still inside the 30 minute hold.
OCCUPYING = """(
    payment_status IN ('success', 'comped')
    OR (payment_status = 'pending' AND created_at > now() - interval '30 minutes')
)"""

CAPSTONE_SLUG = "capstone"


def die(message):
    print(f"\nABORTED: {message}\nNothing was written.")
    sys.exit(1)


def main():
    ap = argparse.ArgumentParser(
        description="Swap a registration's tracks. Dry run unless --commit.",
    )
    who = ap.add_mutually_exclusive_group(required=True)
    who.add_argument("--email", help="registrant email (case-insensitive)")
    who.add_argument("--order-id", help="order id, e.g. PFE-XXXXXXXXXX")
    ap.add_argument("--beginner", help="slug of the new beginner track, e.g. python")
    ap.add_argument("--advanced", help="slug of the new advanced track, e.g. ai")
    ap.add_argument("--db-url", default=os.environ.get("DATABASE_URL"))
    ap.add_argument("--commit", action="store_true", help="actually write the change")
    args = ap.parse_args()

    if not args.beginner and not args.advanced:
        die("give --beginner and/or --advanced")
    if not args.db_url:
        die("no database url: pass --db-url or set DATABASE_URL")

    host = args.db_url.split("@")[-1].split("/")[0]
    mode = "COMMIT" if args.commit else "DRY RUN"
    print(f"[{mode}] connected to {host}\n")

    conn = psycopg2.connect(args.db_url)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        if args.email:
            cur.execute(
                "SELECT * FROM pferegistration WHERE lower(email) = lower(%s) FOR UPDATE",
                (args.email,),
            )
        else:
            cur.execute(
                "SELECT * FROM pferegistration WHERE order_id = %s FOR UPDATE",
                (args.order_id,),
            )
        matches = cur.fetchall()

        print(f"matched {len(matches)} registration(s)")
        for m in matches:
            print(
                f"  {m['order_id']}  {m['name']}  <{m['email']}>  "
                f"sku={m['sku']} status={m['payment_status']} "
                f"paid={m['amount_paid']} capstone={m['has_capstone']}"
            )
        if len(matches) != 1:
            conn.rollback()
            die("expected exactly one matching registration")

        reg = matches[0]

        cur.execute("SELECT id, slug, name, segment, dates, capacity, enabled FROM tracks")
        tracks = cur.fetchall()
        by_slug = {t["slug"]: t for t in tracks}
        by_id = {t["id"]: t for t in tracks}

        # Resolve each requested move, checking segment and capacity.
        changes = {}
        for flag, slug, column, segment in (
            ("--beginner", args.beginner, "beginner_track_id", "beginner"),
            ("--advanced", args.advanced, "advanced_track_id", "advanced"),
        ):
            if not slug:
                continue
            target = by_slug.get(slug)
            if not target:
                conn.rollback()
                die(f"{flag}: no track with slug '{slug}'")
            if not target["enabled"]:
                conn.rollback()
                die(f"{flag}: {target['name']} is disabled")
            if target["segment"] != segment:
                conn.rollback()
                die(
                    f"{flag}: {target['name']} is a {target['segment']} track. "
                    f"Swapping across segments would change what was bought."
                )

            cur.execute(
                f"""SELECT count(*) AS used FROM pferegistration
                     WHERE (beginner_track_id = %s OR advanced_track_id = %s)
                       AND {OCCUPYING}""",
                (target["id"], target["id"]),
            )
            used = cur.fetchone()["used"]
            print(f"  seats {target['name']}: {used}/{target['capacity']}")
            if used >= target["capacity"]:
                conn.rollback()
                die(f"{target['name']} is full")

            changes[column] = target

        old_b = by_id.get(reg["beginner_track_id"])
        old_a = by_id.get(reg["advanced_track_id"])
        new_b = changes.get("beginner_track_id", old_b)
        new_a = changes.get("advanced_track_id", old_a)

        def describe(b, a):
            parts = [t["name"] for t in (b, a) if t]
            if reg["has_capstone"]:
                parts.append("Capstone Day")
            return " + ".join(parts) or "(nothing)"

        print(f"\nBEFORE: {describe(old_b, old_a)}")
        print(f"AFTER : {describe(new_b, new_a)}")

        if new_b is old_b and new_a is old_a:
            conn.rollback()
            print("\nAlready on those tracks. Nothing to do.")
            return

        # Entitled dates come from whatever tracks the row ends up holding.
        # Existing attendance keys are preserved rather than pruned -- losing a
        # recorded attendance is worse than carrying a key nobody renders.
        new_dates = []
        for t in (new_b, new_a):
            if t:
                new_dates += t["dates"]
        if reg["has_capstone"] and CAPSTONE_SLUG in by_slug:
            new_dates += by_slug[CAPSTONE_SLUG]["dates"]

        attendance = dict(reg["attendance"] or {})
        added = [d for d in sorted(set(new_dates)) if d not in attendance]
        for d in added:
            attendance[d] = False
        if added:
            print(f"attendance: adding {', '.join(added)} (existing marks kept)")
        else:
            print("attendance: unchanged (same days)")

        sets, params = [], []
        for column, target in changes.items():
            sets.append(f"{column} = %s")
            params.append(target["id"])
        sets.append("attendance = %s::jsonb")
        params.append(json.dumps(attendance))
        params.append(reg["id"])

        cur.execute(
            f"UPDATE pferegistration SET {', '.join(sets)} WHERE id = %s "
            f"RETURNING order_id, sku, beginner_track_id, advanced_track_id, "
            f"has_capstone, amount_paid, payment_status, attendance",
            params,
        )
        after = cur.fetchone()

        if not args.commit:
            conn.rollback()
            print("\nDRY RUN -- rolled back. Re-run with --commit to apply.")
            return

        conn.commit()
        print("\n=== COMMITTED ===")
        print(
            f"  {after['order_id']}  sku={after['sku']} paid={after['amount_paid']} "
            f"status={after['payment_status']}"
        )
        print(
            f"  tracks: {by_id.get(after['beginner_track_id'], {}).get('name', '-')} + "
            f"{by_id.get(after['advanced_track_id'], {}).get('name', '-')} + "
            f"capstone={after['has_capstone']}"
        )
    except Exception as exc:  # noqa: BLE001 - surface anything, write nothing
        conn.rollback()
        die(str(exc))
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
