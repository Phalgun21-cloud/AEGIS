# AEGIS security review (Phase 5)

This is the builder's own review of AEGIS, done during Phase 5. It is not an independent
audit, and AEGIS makes no claim of being impossible to breach. Before AEGIS is used for a
real examination, someone who did not build it should review it (see the last section).

## What AEGIS protects

| Asset | Threat | Main controls |
|---|---|---|
| Question content | Leak before the exam | AES-256-GCM per item, key wrapped with RSA-3072 (vault); plaintext deleted on approval; admins see metadata only |
| Exam paper | Opened early | Sealed under its own key; `open_paper` refuses before `start_at` for every role; release is a time check, not a scheduler action |
| Candidate answers | Lost, altered, or disputed | Server-side deadline, auto-save, one-way submit with SHA-256 receipt, compare-and-set finalisation |
| Audit trail | Edited or truncated to hide actions | Hash chain, chain-head row, optional on-chain anchoring of the head (testnet/local only) |
| Accounts | Takeover, misuse of roles | bcrypt, httpOnly session cookie, CSRF header, rate-limited sign-in, server-side role checks on every route |

## Controls verified by tests

- **Role boundaries.** `tests/test_security.py` walks every API route. Anonymous callers get 401
  and every other role gets 403. A new route without a guard fails the build.
- **Time lock.** The paper does not open one second before `start_at`. Before release, no route
  any role can call contains question text. A sealed paper copied onto another exam won't
  decrypt, because the AAD binds it to its record.
- **Sessions.** The cookie is `HttpOnly` and `SameSite=Strict`, and in production also `Secure`
  with the `__Host-` prefix. The token never reaches page scripts. Writes made with the cookie
  need `X-AEGIS-CSRF: 1`. Login sets a cookie only when that header is sent, which blocks login
  CSRF. The monitor WebSocket checks `Origin`.
- **Abuse limits.** Sign-in is limited per IP, and failures are limited per IP and account. Request
  bodies over 5 MB are refused, and so are account passwords outside 10–15 characters.
- **Transport and headers.** HSTS and https-only CORS in production, with no-content CSP,
  `X-Frame-Options: DENY`, `nosniff` and `no-store` on the API. Pages get a CSP and anti-framing
  headers. Production refuses to start with a weak JWT secret, a missing vault key, or http
  origins.
- **Concurrency.** A 200-candidate load test (`backend/scripts/load_test.py`) verifies one attempt
  per candidate, every stored answer, every receipt hash, and an intact audit chain. It found
  three bugs, all fixed:
  - the audit chain could fork under parallel commits;
  - release and submit events were recorded more than once;
  - the connection pool ran out at the release second.

## Residual risks (accepted or open)

1. **A dishonest administrator.** An admin can create a candidate account, enrol it, move a
   sealed exam's start time earlier, and read the paper once it opens. Every one of those
   steps is audited, and they trigger blockchain anchoring, so the trail can't be quietly
   rewritten. They are not prevented, though. *Recommended:* a two-person rule for reschedules
   and enrolment changes, and keeping the people who run exams apart from those who manage
   accounts.
2. **The vault key sits on the API server.** Anyone who controls the API host or its
   environment can decrypt everything. *Recommended for production:* keep the key in a managed
   KMS/HSM so it can't be exported, and limit who can reach the host.
3. **A database administrator can rewrite the audit log.** That includes the chain-head row.
   Such a rewrite can only be detected when anchoring is enabled, because the on-chain head
   then stops matching.
4. **No MFA, password change or password reset.** Admin accounts are the most valuable
   target. *Recommended:* add TOTP for admins, plus a password change flow that invalidates
   existing sessions.
5. **Stateless tokens.** Signing out deletes the cookie, but a stolen token stays valid until it
   expires (default 30 minutes idle). Deactivating a user takes effect at once.
6. **Rate limits are counted per process.** Several API instances each keep their own counts.
   Behind proxies, uvicorn must trust only the real proxy (`FORWARDED_ALLOW_IPS`), or clients
   can forge `X-Forwarded-For`. An exam centre where every candidate shares one IP needs a
   higher per-IP limit.
7. **The page CSP allows inline scripts.** Next.js needs this unless nonce middleware is added.
   React escaping and the absence of any raw-HTML rendering limit the exposure.
8. **Client-side exam integrity.** There is no proctoring or browser lockdown. AEGIS secures the
   paper and the record, not the room.
9. **Dependencies.**
   - Next.js is on 16.3.6. One remaining advisory (fixed in 16.3.8) affects features AEGIS does
     not use. Upgrade before deploying.
   - Python dependencies have not been scanned (`pip-audit`); scan them before launch.
10. **SQLite is for development and tests only.** Its locking is coarse. Use MySQL for every real
    deployment, and rerun the load test against it.

## Before a real exam

- [ ] Independent security review by someone who didn't build AEGIS
- [ ] Load test on the production MySQL tier with the expected number of candidates
- [ ] Vault key backed up offline. Without it, approved questions and papers can't be decrypted
- [ ] Production secrets set: `JWT_SECRET`, `VAULT_PRIVATE_KEY`, https `CORS_ORIGINS`
- [ ] Next.js ≥ 16.3.8; `npm audit` and `pip-audit` clean
- [ ] A dry-run exam end to end (Phase 7)
