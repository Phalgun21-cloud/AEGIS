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
| `contracts/` | Hardhat `AuditAnchor` contract for optional blockchain audit anchoring |

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
# http://localhost:3000   (single link: the frontend proxies /api/* and the
#                          monitor WebSocket to the backend; API docs at /api/docs)
```

### Everyday start (one command)

Easiest: **double-click `start-aegis.cmd`** in the project folder. It opens a window running
the API and web app (close that window to stop them) and opens the sign-in page.

Or, after the one-time setup above, start everything from the project root:

```powershell
npm install        # first time only (installs the launcher)
npm run dev        # applies migrations, starts API :8000 and web app :3000 together
```

Open http://localhost:3000. If the landing page shows **API unreachable**, the backend
isn't running. Start it with `npm run dev`, not `npm run dev` inside `frontend/`, which
only starts the web app.

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

## Frontend (Phase 3)

One origin, http://localhost:3000. Sign-in sends each role to its own area. A user who
opens another role's pages is redirected back to their own.

| Role | Pages |
|---|---|
| Admin | Dashboard; Exams (create, blueprint with live bank counts, AI paper generator with shortfall report, candidate enrolment, schedule, live monitor over WebSocket with polling fallback, results); Question Bank (metadata and coverage only); Users; Audit Logs (filter, paging, chain verification) |
| Author | My Questions (filtered by status, reviewer feedback shown), editor with options, answer key, explanation and image upload; save draft / submit |
| Reviewer | Queue with full question, marked answer, image, TF-IDF duplicate check; approve, or reject with feedback |
| Candidate | My Exams; instructions with countdown to release; exam screen with server-synced timer, question navigator, debounced auto-save with retry, submit confirmation, auto-submit at time-up; SHA-256 receipt |

The session token is kept in `sessionStorage`, so it is cleared when the tab closes.
Moving it to an httpOnly cookie is planned for hardening (Phase 5).

## Blockchain audit anchoring (Phase 4, optional)

Each audit entry's hash covers the previous one, so writing the newest hash to a blockchain
fixes every earlier entry. After that, even someone with full database access can't
quietly edit or delete audit history: **Audit Logs → Blockchain anchors → Verify against
chain** compares the database with the on-chain record. Only hashes go on-chain, never
question content or personal data. Testnet / local only; the deploy script refuses mainnet.

- **Contract:** `contracts/contracts/AuditAnchor.sol`. Only the owner can write. Entry ids
  must strictly increase, so a rolled-back or truncated audit log can't be re-anchored.
- **When it anchors:** the release engine anchors automatically after critical events
  (question approved, paper generated/discarded/released, submissions, exam closed), at
  most every `ANCHOR_MIN_INTERVAL_SECONDS`. Admins can also press **Anchor now**.
- **Before anchoring** it re-verifies the database chain and refuses to anchor tampered
  data. It also refuses if the contract already holds a newer checkpoint, which means a
  rolled-back log or a contract shared between environments. Use one contract per
  environment.

### Try it on a local chain

```powershell
npm run chain            # terminal 1: local Hardhat blockchain on :8545 (keep it open)
npm run deploy:local     # terminal 2: deploys AuditAnchor and prints its address
```

Then in `backend/.env` set `ANCHOR_ENABLED=true`, `ANCHOR_RPC_URL=http://127.0.0.1:8545`,
`ANCHOR_CONTRACT_ADDRESS=<printed address>` and `ANCHOR_PRIVATE_KEY=` the key of Hardhat
**Account #0** shown by `npm run chain` (a public dev key that only works on the local
chain). Restart AEGIS. The local chain forgets everything when stopped, so redeploy each
time.

### Sepolia testnet

1. Create a **test-only** wallet, for example a new MetaMask account. Never use one
   holding real funds.
2. Get free Sepolia ETH from a faucet, and a Sepolia RPC URL from a provider such as
   Alchemy or Infura.
3. Copy `contracts/.env.example` to `contracts/.env`, then fill in `SEPOLIA_RPC_URL` and
   `DEPLOYER_PRIVATE_KEY`.
4. Run `npm run deploy:sepolia`. It writes `contracts/deployments/sepolia.json`.
5. In `backend/.env` set `ANCHOR_ENABLED=true`, `ANCHOR_RPC_URL=<Sepolia RPC URL>`,
   `ANCHOR_CONTRACT_ADDRESS=<address>` and `ANCHOR_PRIVATE_KEY=<same test wallet key>`.
   Each anchor costs a little test ETH.

Checks: `npm run test:contracts` (contract tests); the backend tests cover anchoring with
an in-memory chain.

## Status

- Phase 1 (foundation): complete.
- Phase 2 (backend services): complete. Auth/RBAC, question workflow with image upload,
  review with duplicate check, vault crypto, exams and blueprints, AI-assisted generation,
  release engine, candidate service, hash-chained audit and a WebSocket live monitor.
  40 automated tests.
- Phase 3 (frontend): complete. Role-based pages for Admin, Author, Reviewer and
  Candidate, checked end to end in a browser (author → reject → fix → approve →
  blueprint → generate → release → attempt → submit / auto-submit → results → audit).
- Phase 4 (blockchain audit, optional): complete. AuditAnchor contract with 7 tests,
  Web3.py anchoring with automatic triggers and verification, admin UI panel; verified
  on a local Hardhat chain, including tamper detection. Sepolia deployment needs your
  own test wallet and RPC URL (see above).
- Next: Phase 5, hardening and testing.
