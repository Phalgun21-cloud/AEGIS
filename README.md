# AEGIS – Secure Digital Examination Infrastructure

*Integrity in Every Examination.*

AEGIS governs the examination lifecycle: question creation → review → encrypted vault →
blueprint → AI-assisted paper generation → encryption → scheduled release → candidate exam →
submission → audit & analytics.

## Layout

| Folder | What |
|---|---|
| `frontend/` | Next.js + TypeScript + Tailwind |
| `backend/` | FastAPI + SQLAlchemy + Alembic (MySQL) |
| `contracts/` | Hardhat audit-anchoring contract (Phase 4, not yet created) |

## Run locally (Windows PowerShell)

Prerequisites: Git, Node 20+, Python 3.12+, MySQL Server 8 (the `MySQL80` Windows service
that MySQL Workbench uses). Docker is not required; `docker-compose.yml` is only an
alternative way to get MySQL.

```powershell
# 1. Database (once): open MySQL Workbench as root and run backend/scripts/mysql_setup.sql
#    after replacing CHANGE_ME with a password of your choice.

# 2. Backend
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.example .env          # then put your MySQL password into DATABASE_URL
alembic upgrade head
python -m app.cli create-user --role admin --email you@example.com --name "Exam Admin"
uvicorn app.main:app --reload --port 8000
# http://localhost:8000/health   http://localhost:8000/docs

# 3. Frontend (new terminal)
cd frontend
copy .env.example .env.local
npm install
npm run dev
# http://localhost:3000
```

The vault key is generated at `backend/keys/vault_private.pem` on first use in development.
Back it up: without it, approved questions and sealed papers cannot be decrypted.
`backend/keys/` is git-ignored.

## Checks

```powershell
cd backend;  pytest -q; ruff check .
cd frontend; npm run lint; npm run build
```

CI (`.github/workflows/ci.yml`) runs the same checks on every push and pull request.

## Backend API (Phase 2)

Every route except `/health*` and `/auth/login` requires a JWT, and each is limited to
its role. Interactive docs are at `/docs`.

| Role | Routes |
|---|---|
| any | `POST /auth/login`, `GET /auth/me` |
| Admin | `/users`; `/exams` (create, blueprint, `generate`, `manifest`, `candidates`, `monitor`, `results`, `stats/overview`); `/bank`, `/bank/summary`; `/audit`, `/audit/verify`; WebSocket `/ws/exams/{id}/monitor` |
| Author | `POST/PATCH/DELETE /questions`, `/questions/mine`, `/questions/{id}/submit`, `PUT /questions/{id}/image` |
| Reviewer | `/reviews/queue`, `/reviews/{id}/similar`, `/reviews/{id}/approve`, `/reviews/{id}/reject` |
| Candidate | `/candidate/exams`, `/candidate/exams/{id}/start`, `/candidate/attempts/{id}` (+ `/answers`, `/submit`) |

### How the security pieces fit

- **Vault.** On approval a question's content is encrypted with its own AES-256-GCM key,
  that key is wrapped with the vault RSA-3072 key (OAEP-SHA256), and the plaintext is
  removed from the `questions` table. Admins see only metadata (topic, difficulty, marks).
- **Paper.** Generation decrypts the approved pool in memory, drops near-duplicates
  (TF-IDF cosine ≥ `DUPLICATE_THRESHOLD`), fills each blueprint row with least-used
  questions first, and seals the assembled paper under a new per-exam key.
- **Release.** `open_paper` refuses to decrypt before `start_at` for every role, including
  admin. The background release engine moves exams `sealed → live → closed` and
  auto-submits attempts at their deadline. A stopped scheduler can delay a release, but
  it can't make one happen early.
- **Attempts.** The server fixes the deadline at first start (never past `end_at`).
  Answers auto-save with `PUT …/answers`. Submission is one-way and returns a SHA-256
  receipt of the answers.
- **Audit.** Every significant action is appended to `audit_logs`, and each entry's
  hash includes the previous entry's hash. `GET /audit/verify` (or
  `python -m app.cli verify-audit`) detects any edited or deleted row.

## Status

- Phase 1 (foundation): complete.
- Phase 2 (backend services): complete. Auth/RBAC, question workflow with image upload,
  review with duplicate check, vault crypto, exams and blueprints, AI-assisted generation,
  release engine, candidate service, hash-chained audit and a WebSocket live monitor.
  40 automated tests.
- Next: Phase 3, the role-based frontend pages.
