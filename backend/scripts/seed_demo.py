"""Fill an AEGIS deployment with demo data, through its public API.

Creates authors, reviewers and candidates; writes ~90 questions and runs them through review
(most approved into the vault, some rejected, some left in the queue or as drafts); schedules
exams in every state (draft, sealed upcoming, live, closed with results) and has the
candidates take them. Takes about 5 minutes, because closed exams have to really run.

It only uses the API as an admin would, so it works the same locally and on the deployed site
(through the web app's /api proxy). Run it once per deployment; it stops if the demo accounts
already exist.

    cd backend
    # local (npm run dev running)
    .venv\\Scripts\\python scripts/seed_demo.py --admin-email you@example.com
    # deployed site
    .venv\\Scripts\\python scripts/seed_demo.py --base-url https://<site>.vercel.app/api ^
        --admin-email you@yourdomain.com --out D:\\aegis-secrets\\demo-credentials.md

The admin password is prompted for (or read from AEGIS_ADMIN_PASSWORD). The demo accounts'
generated passwords are written to --out; keep that file out of the repository.
"""

import argparse
import getpass
import os
import random
import secrets
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from demo_questions import BANK, EXTRA, MARKS

REPO = Path(__file__).resolve().parents[2]
DOMAIN = "example.org"

FIRST = ["Aarav", "Diya", "Vihaan", "Ananya", "Arjun", "Isha", "Kabir", "Meera", "Rohan", "Saanvi", "Aditya", "Kavya", "Reyansh", "Priya", "Ishaan", "Nisha", "Vivaan", "Tara", "Dhruv", "Riya", "Arnav", "Zara", "Sai", "Neha", "Krishna", "Pooja", "Yash", "Aisha", "Dev", "Sneha", "Om", "Myra", "Rahul", "Kiara", "Nikhil", "Anika", "Siddharth", "Leela", "Varun", "Asha"]
LAST = ["Sharma", "Patel", "Iyer", "Reddy", "Kulkarni", "Nair", "Gupta", "Desai", "Joshi", "Menon", "Rao", "Singh", "Kapoor", "Bhat", "Chatterjee", "Pillai", "Mehta", "Das", "Shah", "Verma"]


class Api:
    def __init__(self, base: str, token: str | None = None):
        self.base = base.rstrip("/")
        self.http = httpx.Client(timeout=120)
        self.token = token

    def call(self, method: str, path: str, **kw) -> httpx.Response:
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        for attempt in range(6):
            r = self.http.request(method, self.base + path, headers=headers, **kw)
            if r.status_code == 429:  # sign-in throttle: wait as told
                time.sleep(int(r.headers.get("Retry-After", "10")) + 1)
                continue
            if r.status_code in (502, 503, 504) and attempt < 5:  # waking free instance
                time.sleep(10)
                continue
            return r
        return r

    def ok(self, method: str, path: str, **kw):
        r = self.call(method, path, **kw)
        if r.status_code >= 400:
            sys.exit(f"{method} {path} failed: {r.status_code} {r.text[:500]}")
        return r.json() if r.content else None

    def login(self, email: str, password: str) -> "Api":
        r = self.call("POST", "/auth/login", data={"username": email, "password": password})
        if r.status_code != 200:
            sys.exit(f"Sign-in failed for {email}: {r.status_code} {r.text[:300]}")
        return Api(self.base, r.json()["access_token"])


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def wait_until(when: datetime, label: str) -> None:
    left = (when - datetime.now(UTC)).total_seconds()
    if left > 0:
        print(f"  waiting {int(left)}s {label}...", flush=True)
        time.sleep(left)


def make_people(rng: random.Random, n: int, used: set[str]) -> list[str]:
    names = []
    while len(names) < n:
        name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        if name not in used:
            used.add(name)
            names.append(name)
    return names


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--base-url", default="http://localhost:3000/api",
                    help="the web app's /api address (default: local dev)")
    ap.add_argument("--admin-email", required=True)
    ap.add_argument("--candidates", type=int, default=30)
    ap.add_argument("--out", default=str(REPO / "demo-credentials.local.md"),
                    help="where the demo accounts' passwords are written")
    ap.add_argument("--seed", type=int, default=None, help="random seed (names, answers)")
    args = ap.parse_args()
    rng = random.Random(args.seed)

    root = Api(args.base_url)
    health = root.call("GET", "/health/db")
    if health.status_code != 200:
        sys.exit(f"API not healthy at {args.base_url}: {health.status_code} {health.text[:200]}")
    password = os.environ.get("AEGIS_ADMIN_PASSWORD") or getpass.getpass("Admin password: ")
    admin = root.login(args.admin_email, password)
    if admin.ok("GET", "/auth/me")["role"] != "admin":
        sys.exit(f"{args.admin_email} is not an admin")

    existing = {u["email"] for u in admin.ok("GET", "/users")}
    if any(e.startswith("demo.") and e.endswith("@" + DOMAIN) for e in existing):
        sys.exit("Demo accounts already exist here; the demo data has been seeded before.")

    # ---------- users ----------
    print("Creating users...", flush=True)
    used: set[str] = set()
    plan = [("author", 4), ("reviewer", 3), ("candidate", args.candidates)]
    accounts: dict[str, list[dict]] = {}
    for role, n in plan:
        accounts[role] = []
        for i, name in enumerate(make_people(rng, n, used), start=1):
            email = f"demo.{role}{i:02d}@{DOMAIN}"
            pw = secrets.token_urlsafe(12)
            u = admin.ok("POST", "/users",
                         json={"email": email, "full_name": name, "password": pw, "role": role})
            accounts[role].append({"id": u["id"], "email": email, "name": name, "password": pw})
    write_credentials(Path(args.out), args.base_url, accounts)
    print(f"  {sum(len(v) for v in accounts.values())} users; passwords in {args.out}", flush=True)

    sessions = {
        role: [root.login(a["email"], a["password"]) for a in accounts[role]]
        for role in ("author", "reviewer")
    }

    # ---------- questions ----------
    print("Writing and reviewing questions...", flush=True)
    authors, reviewers = sessions["author"], sessions["reviewer"]
    answer_key: dict[str, tuple[int, str]] = {}  # stem -> (correct option, difficulty)
    k = 0
    for subject, topics in BANK.items():
        for topic, items in topics.items():
            for difficulty, stem, options, correct in items:
                answer_key[stem] = (correct, difficulty)
                author = authors[k % len(authors)]
                reviewer = reviewers[k % len(reviewers)]
                k += 1
                q = author.ok("POST", "/questions", json={
                    "subject": subject, "topic": topic, "difficulty": difficulty,
                    "marks": MARKS[difficulty], "stem": stem, "options": options,
                    "correct_option": correct,
                })
                author.ok("POST", f"/questions/{q['id']}/submit")
                reviewer.ok("POST", f"/reviews/{q['id']}/approve", json={})
        for i, (topic, difficulty, stem, options, correct) in enumerate(EXTRA[subject]):
            author, reviewer = authors[i % len(authors)], reviewers[i % len(reviewers)]
            q = author.ok("POST", "/questions", json={
                "subject": subject, "topic": topic, "difficulty": difficulty,
                "marks": MARKS[difficulty], "stem": stem, "options": options,
                "correct_option": correct,
            })
            if i == 0:
                continue  # stays a draft
            author.ok("POST", f"/questions/{q['id']}/submit")
            if i == 2:
                reviewer.ok("POST", f"/reviews/{q['id']}/reject", json={
                    "feedback": "Too close to an existing vault question; please make the "
                                "distractors more plausible and add an explanation.",
                })
            # i == 1, 3: left in the review queue
    print(f"  {k} approved, {sum(len(v) for v in EXTRA.values())} draft/queued/rejected",
          flush=True)

    # ---------- exams ----------
    print("Scheduling exams...", flush=True)
    candidate_ids = [c["id"] for c in accounts["candidate"]]
    candidate_ids += [u["id"] for u in admin.ok("GET", "/users?role=candidate")
                      if u["id"] not in candidate_ids]  # existing candidates see them too
    full_blueprint = {
        subject: [{"topic": t, "difficulty": d, "count": 1}
                  for t in topics for d in ("easy", "medium", "hard")]
        for subject, topics in BANK.items()
    }
    now = datetime.now(UTC)
    day = now.replace(hour=4, minute=30, second=0, microsecond=0)  # 10:00 IST

    def exam(title, subject, start, minutes, end=None, blueprint=True, generate=True,
             enrol=True, instructions="Answer every question. Each has exactly one correct "
                                      "option. There is no negative marking."):
        body = {"title": title, "subject": subject, "instructions": instructions,
                "duration_minutes": minutes, "start_at": iso(start)}
        if end:
            body["end_at"] = iso(end)
        e = admin.ok("POST", "/exams", json=body)
        if blueprint:
            admin.ok("PUT", f"/exams/{e['id']}/blueprint", json=full_blueprint[subject])
        if generate:
            admin.ok("POST", f"/exams/{e['id']}/generate")
        if enrol:
            admin.ok("POST", f"/exams/{e['id']}/candidates", json={"candidate_ids": candidate_ids})
        return e

    exam("Data Structures & Networking Midterm", "Computer Science", day + timedelta(days=3), 60)
    exam("Mathematics Unit Test 2", "Mathematics", day + timedelta(days=6), 45)
    exam("Physics Term Exam", "Physics", day + timedelta(days=10), 90)
    exam("Mathematics End-Semester (draft)", "Mathematics", day + timedelta(days=21), 120,
         generate=False, enrol=False)
    exam("Computer Science Re-test (draft)", "Computer Science", day + timedelta(days=30), 60,
         blueprint=False, generate=False, enrol=False)

    # These run now: three short quizzes that close within minutes, and a long live session.
    start = datetime.now(UTC) + timedelta(seconds=90)
    quiz_end = start + timedelta(minutes=3)
    quizzes = [
        exam(f"{s} Weekly Quiz", s, start, 2, end=quiz_end,
             instructions="Short practice quiz. Two minutes.")
        for s in BANK
    ]
    live = exam("Physics Practice Session", "Physics", start, 45, end=start + timedelta(hours=6),
                instructions="Open practice session. Start any time in the next six hours.")
    print(f"  {len(quizzes) + 5 + 1} exams; quizzes and practice session open at "
          f"{start:%H:%M:%S} UTC", flush=True)

    # ---------- candidates take the exams ----------
    wait_until(start + timedelta(seconds=3), "for the exams to open")
    print("Candidates taking exams...", flush=True)
    ability = {c["email"]: rng.uniform(0.35, 0.95) for c in accounts["candidate"]}

    def take(api: Api, cand: dict, exam_id: int, answer_share: float, submit: bool,
             r: random.Random) -> bool:
        att = api.ok("POST", f"/candidate/exams/{exam_id}/start")
        answers = {}
        for q in att["questions"]:
            if r.random() > answer_share:
                continue
            correct, difficulty = answer_key[q["stem"]]
            p = ability[cand["email"]] - {"easy": -0.1, "medium": 0.05, "hard": 0.2}[difficulty]
            wrong = [i for i in range(len(q["options"])) if i != correct]
            answers[str(q["question_id"])] = correct if r.random() < p else r.choice(wrong)
        items = list(answers.items())
        half = len(items) // 2
        base = f"/candidate/attempts/{att['attempt_id']}"
        for chunk in (items[:half], items[half:]):  # two auto-saves, like the exam page
            if chunk and api.call("PUT", f"{base}/answers",
                                  json={"answers": dict(chunk)}).status_code == 409:
                return True  # past the deadline: the server auto-submits it
        if submit:
            api.ok("POST", f"{base}/submit")
        return True

    def candidate(cand: dict, plan: list[tuple], seed: float) -> int:
        r = random.Random(seed)
        api = root.login(cand["email"], cand["password"])  # one sign-in per candidate
        return sum(take(api, cand, *job, r) for job in plan)

    work = []
    for c in accounts["candidate"]:
        plan = []
        for q in quizzes:
            roll = rng.random()
            if roll < 0.12:
                continue  # absent
            # most submit; a few leave it to the auto-submit at the deadline
            plan.append((q["id"], rng.uniform(0.8, 1.0), roll > 0.2))
        if rng.random() < 0.4:
            plan.append((live["id"], rng.uniform(0.2, 0.7), False))  # still in progress
        work.append((c, plan, rng.random()))
    with ThreadPoolExecutor(max_workers=6) as pool:
        attempts = sum(f.result() for f in [pool.submit(candidate, *w) for w in work])
    print(f"  {attempts} attempts", flush=True)

    # ---------- results ----------
    wait_until(quiz_end + timedelta(seconds=20), "for the quizzes to close")
    print("Results:", flush=True)
    for q in quizzes:
        res = admin.ok("GET", f"/exams/{q['id']}/results")
        print(f"  {q['title']}: {res['candidates']} candidates, average {res['average']}"
              f" / {res['total_marks']}", flush=True)
    chain = admin.ok("GET", "/audit/verify")
    print(f"Audit chain: {chain}", flush=True)
    print(f"Done. Demo account passwords: {args.out}")


def write_credentials(path: Path, base_url: str, accounts: dict[str, list[dict]]) -> None:
    lines = [
        "# AEGIS demo accounts (generated by scripts/seed_demo.py; keep out of git)",
        "",
        f"API: {base_url}  (sign in on the web app's /login page)",
        "",
        "| Role | Name | Email | Password |",
        "|---|---|---|---|",
    ]
    for role, rows in accounts.items():
        lines += [f"| {role} | {a['name']} | {a['email']} | `{a['password']}` |" for a in rows]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
