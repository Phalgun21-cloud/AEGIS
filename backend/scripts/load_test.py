"""Many-candidates load test: everyone signs in, starts at the same release second, auto-saves
every answer and submits, with deliberate races (parallel saves, double submits).

Runs a real AEGIS server (uvicorn, real thread pool) against an EMPTY database of your choice,
then checks the results in the database: one attempt per candidate, every answer stored, every
receipt hash reproducible, and the audit chain intact.

    # throwaway SQLite file (quick)
    .venv\\Scripts\\python scripts/load_test.py --candidates 200 --database-url sqlite:///loadtest.db

    # MySQL: create an empty database first (MySQL Workbench, as root):
    #   CREATE DATABASE aegis_loadtest CHARACTER SET utf8mb4;
    #   GRANT ALL PRIVILEGES ON aegis_loadtest.* TO 'aegis'@'localhost';
    .venv\\Scripts\\python scripts/load_test.py --candidates 300 \\
        --database-url "mysql+pymysql://aegis:<password>@localhost:3306/aegis_loadtest"

It refuses to run against a database that already has users, so it can't touch real data.
"""

import argparse
import os
import random
import secrets
import socket
import statistics
import sys
import tempfile
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent

WORDS = """apple river motion carbon prism lattice vector quantum orbit signal fossil glacier
harbor island jungle kernel ledger magnet nectar oxygen pencil quartz rocket saddle timber
umbrella valley walnut xenon yeast zephyr anchor bridge canyon desert engine falcon garnet
helium iris jasper koala lemon marble nickel olive pepper quiver radish silver tundra urchin
violet willow yarrow zinc amber basil cedar dahlia ember fennel ginger hazel indigo juniper
kelp lilac mango nutmeg onyx pearl quince rosemary saffron thyme ultramarine vanilla wasabi
almond bamboo cobalt dune eclipse fjord geyser horizon igloo jetty kiln lagoon mesa nebula
oasis plateau quarry reef savanna tide upland volcano wetland atoll bayou cove delta estuary
""".split()  # noqa: SIM905


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--database-url", required=True, help="an EMPTY database")
    p.add_argument("--candidates", type=int, default=200)
    p.add_argument("--paper-size", type=int, default=10, help="questions per paper")
    p.add_argument("--race-share", type=float, default=0.1, help="share doing parallel requests")
    return p.parse_args()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Stats:
    def __init__(self):
        self.lock = threading.Lock()
        self.times: dict[str, list[float]] = defaultdict(list)
        self.codes: dict[str, Counter] = defaultdict(Counter)

    def add(self, phase: str, seconds: float, code: int) -> None:
        with self.lock:
            self.times[phase].append(seconds)
            self.codes[phase][code] += 1

    def report(self) -> None:
        print(
            f"\n{'phase':<16}{'requests':>9}{'p50 ms':>9}{'p95 ms':>9}{'max ms':>9}  status codes"
        )
        for phase, ts in self.times.items():
            ts = sorted(ts)
            p95 = ts[min(len(ts) - 1, int(len(ts) * 0.95))]
            codes = ", ".join(f"{c}x{n}" for c, n in sorted(self.codes[phase].items()))
            print(
                f"{phase:<16}{len(ts):>9}{statistics.median(ts) * 1000:>9.0f}"
                f"{p95 * 1000:>9.0f}{ts[-1] * 1000:>9.0f}  {codes}"
            )

    def server_errors(self) -> int:
        return sum(n for c in self.codes.values() for code, n in c.items() if code >= 500)


def main() -> int:
    args = parse_args()
    n = args.candidates

    # Configure the app before it's imported.
    os.environ.update(
        DATABASE_URL=args.database_url,
        ENVIRONMENT="development",
        SCHEDULER_ENABLED="true",
        SCHEDULER_INTERVAL_SECONDS="2",
        ANCHOR_ENABLED="false",
        # Everyone signs in from 127.0.0.1 here, like an exam centre behind one NAT address.
        LOGIN_ATTEMPTS_PER_IP_PER_MINUTE=str(n * 2 + 100),
        VAULT_PRIVATE_KEY="",
        VAULT_PRIVATE_KEY_FILE=str(Path(tempfile.mkdtemp()) / "vault_loadtest.pem"),
    )
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))

    import httpx
    import uvicorn
    from sqlalchemy import func, inspect, select

    import app.models  # noqa: F401
    from app.core.security import hash_password
    from app.db import Base, SessionLocal, engine
    from app.models import Attempt, Role, User
    from app.services.audit import verify_chain
    from app.services.lifecycle import answers_digest

    # ---------- empty database only ----------
    if inspect(engine).has_table("users"):
        with SessionLocal() as db:
            if db.execute(select(func.count(User.id))).scalar_one():
                print("Refusing: this database already has users. Use an empty one.")
                return 2
    if args.database_url.startswith("sqlite"):
        Base.metadata.create_all(engine)
    else:
        from alembic.config import Config

        from alembic import command

        command.upgrade(Config(str(BACKEND / "alembic.ini")), "head")

    password = secrets.token_urlsafe(16)  # throwaway, never printed
    pw_hash = hash_password(password)
    with SessionLocal() as db:
        staff = {
            role: User(
                email=f"{role.value}@loadtest.example.com",
                full_name=f"Load {role.value}",
                password_hash=pw_hash,
                role=role,
                is_active=True,
            )
            for role in (Role.ADMIN, Role.AUTHOR, Role.REVIEWER)
        }
        cands = [
            User(
                email=f"cand{i:05d}@loadtest.example.com",
                full_name=f"Candidate {i}",
                password_hash=pw_hash,
                role=Role.CANDIDATE,
                is_active=True,
            )
            for i in range(n)
        ]
        db.add_all([*staff.values(), *cands])
        db.commit()
        cand_ids = [c.id for c in cands]
        cand_emails = [c.email for c in cands]

    # ---------- real server ----------
    from app.main import app as fastapi_app

    port = free_port()
    server = uvicorn.Server(
        uvicorn.Config(fastapi_app, host="127.0.0.1", port=port, log_level="warning")
    )
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)
    base = f"http://127.0.0.1:{port}"
    stats = Stats()
    pool = ThreadPoolExecutor(max_workers=n)
    limits = httpx.Limits(max_connections=n + 10, max_keepalive_connections=n + 10)
    http = httpx.Client(base_url=base, timeout=120, limits=limits)

    def call(phase: str, method: str, url: str, token: str | None = None, **kw) -> httpx.Response:
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        t0 = time.perf_counter()
        r = http.request(method, url, headers=headers, **kw)
        took = time.perf_counter() - t0
        stats.add(phase, took, r.status_code)
        if took > 15:
            print(f"  slow: {method} {url} took {took:.0f}s ({r.status_code})")
        return r

    def login(email: str) -> str:
        r = call("login", "POST", "/auth/login", data={"username": email, "password": password})
        r.raise_for_status()
        return r.json()["access_token"]

    problems: list[str] = []
    print(f"AEGIS load test: {n} candidates, {args.paper_size}-question paper, {base}")

    # ---------- question bank + exam ----------
    admin, author, reviewer = (
        login(staff[r].email) for r in (Role.ADMIN, Role.AUTHOR, Role.REVIEWER)
    )
    rng = random.Random(7)
    for i in range(args.paper_size + 5):
        body = {
            "subject": "Mathematics",
            "topic": "Load",
            "difficulty": "easy",
            "marks": 1,
            "stem": f"Q{i}: " + " ".join(rng.sample(WORDS, 10)),
            "options": ["A", "B", "C", "D"],
            "correct_option": i % 4,
        }
        qid = call("setup", "POST", "/questions", author, json=body).json()["id"]
        call("setup", "POST", f"/questions/{qid}/submit", author)
        call("setup", "POST", f"/reviews/{qid}/approve", reviewer).raise_for_status()

    t0 = time.perf_counter()
    tokens = list(pool.map(login, cand_emails))
    print(f"  {n} candidates signed in concurrently in {time.perf_counter() - t0:.1f}s")

    # Scheduled well ahead, then moved to just after setup, so setup time can't eat into it.
    start = datetime.now(UTC).replace(microsecond=0) + timedelta(hours=1)
    exam = call(
        "setup",
        "POST",
        "/exams",
        admin,
        json={
            "title": "Load test",
            "subject": "Mathematics",
            "duration_minutes": 30,
            "start_at": start.isoformat(),
        },
    )
    exam.raise_for_status()
    eid = exam.json()["id"]
    bp = [{"topic": "Load", "difficulty": "easy", "count": args.paper_size}]
    call("setup", "PUT", f"/exams/{eid}/blueprint", admin, json=bp).raise_for_status()
    call("setup", "POST", f"/exams/{eid}/generate", admin).raise_for_status()
    call(
        "setup", "POST", f"/exams/{eid}/candidates", admin, json={"candidate_ids": cand_ids}
    ).raise_for_status()
    start = datetime.now(UTC).replace(microsecond=0) + timedelta(seconds=8)
    call(
        "setup", "PATCH", f"/exams/{eid}", admin, json={"start_at": start.isoformat()}
    ).raise_for_status()

    # Nobody gets in early, not even one second before.
    early = call("early-start", "POST", f"/candidate/exams/{eid}/start", tokens[0])
    if early.status_code != 409:
        problems.append(f"start before release returned {early.status_code}")
    while datetime.now(UTC) < start:
        time.sleep(0.05)

    # ---------- everyone starts at the release second ----------
    t0 = time.perf_counter()
    starts = list(
        pool.map(lambda tok: call("start", "POST", f"/candidate/exams/{eid}/start", tok), tokens)
    )
    print(f"  {n} candidates started at release in {time.perf_counter() - t0:.1f}s")
    attempts = []
    for r in starts:
        if r.status_code != 200:
            problems.append(f"start: {r.status_code} {r.text[:120]}")
            attempts.append(None)
            continue
        a = r.json()
        if len(a["questions"]) != args.paper_size:
            problems.append(f"attempt {a['attempt_id']} got {len(a['questions'])} questions")
        attempts.append(a)
    papers = {tuple(sorted(q["question_id"] for q in a["questions"])) for a in attempts if a}
    if len(papers) != 1:
        problems.append(f"candidates received {len(papers)} different papers")

    # ---------- answer every question (auto-save), with races ----------
    racers = set(range(int(n * args.race_share)))
    intended: dict[int, dict[str, int]] = {}

    def take_exam(i: int) -> dict | None:
        a, tok = attempts[i], tokens[i]
        if a is None:
            return None
        url = f"/candidate/attempts/{a['attempt_id']}/answers"
        mine = {str(q["question_id"]): random.randrange(len(q["options"])) for q in a["questions"]}
        intended[a["attempt_id"]] = mine
        for qid, choice in mine.items():
            r = call("save", "PUT", url, tok, json={"answers": {qid: choice}})
            if r.status_code != 200:
                problems.append(f"save: {r.status_code} {r.text[:120]}")
        submit = f"/candidate/attempts/{a['attempt_id']}/submit"
        if i in racers:
            # The same final answers saved three times at once, then a double submit.
            with ThreadPoolExecutor(3) as ex:
                list(
                    ex.map(
                        lambda _: call("save-race", "PUT", url, tok, json={"answers": mine}),
                        range(3),
                    )
                )
            with ThreadPoolExecutor(2) as ex:
                rs = list(ex.map(lambda _: call("submit-race", "POST", submit, tok), range(2)))
            receipts = {r.json()["answers_sha256"] for r in rs if r.status_code == 200}
            if len(receipts) != 1 or any(r.status_code != 200 for r in rs):
                problems.append(f"double submit gave {[r.status_code for r in rs]}, {receipts}")
            return rs[0].json()
        r = call("submit", "POST", submit, tok)
        if r.status_code != 200:
            problems.append(f"submit: {r.status_code} {r.text[:120]}")
            return None
        return r.json()

    t0 = time.perf_counter()
    receipts = [r for r in pool.map(take_exam, range(n)) if r]
    print(f"  all answers saved and submitted in {time.perf_counter() - t0:.1f}s")

    monitor = call("monitor", "GET", f"/exams/{eid}/monitor", admin).json()

    # ---------- verify in the database ----------
    with SessionLocal() as db:
        rows = db.execute(select(Attempt).where(Attempt.exam_id == eid)).scalars().all()
        by_id = {a.id: a for a in rows}
        if len(rows) != n:
            problems.append(f"{len(rows)} attempts stored for {n} candidates")
        if len({a.candidate_id for a in rows}) != len(rows):
            problems.append("a candidate has more than one attempt")
        for rc in receipts:
            a = by_id.get(rc["attempt_id"])
            if a is None or a.submitted_at is None:
                problems.append(f"attempt {rc['attempt_id']} not submitted in the database")
                continue
            if a.answers != intended[a.id]:
                problems.append(f"attempt {a.id}: stored answers differ from what was saved")
            if answers_digest(a) != rc["answers_sha256"]:
                problems.append(f"attempt {a.id}: receipt hash doesn't match stored answers")
        chain = verify_chain(db)
        if not chain.valid:
            problems.append(f"audit chain broken at entry {chain.first_broken_id}")

    server.should_exit = True
    stats.report()
    print(f"\nmonitor: {monitor.get('submitted')} submitted of {monitor.get('enrolled')} enrolled")
    print(f"audit chain: {'valid' if chain.valid else 'BROKEN'} ({chain.entries} entries)")
    if stats.server_errors():
        problems.append(f"{stats.server_errors()} server errors (5xx)")
    if problems:
        print(f"\nFAILED ({len(problems)} problems):")
        for p in problems[:30]:
            print("  -", p)
        return 1
    print(f"\nPASSED: {len(receipts)}/{n} candidates submitted, every answer and receipt verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
