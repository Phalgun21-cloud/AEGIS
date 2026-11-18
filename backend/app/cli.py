"""Operator commands.

    python -m app.cli create-user --role admin --email admin@example.org --name "Exam Admin"
    python -m app.cli set-password --domain aegis-exam.com   (or --email someone@example.org)
    python -m app.cli generate-vault-key [--out keys/vault_private.pem]
    python -m app.cli verify-audit

Passwords are prompted for (never passed on the command line, which shells record).
"""

import argparse
import getpass
import os
import sys
from pathlib import Path

from sqlalchemy import select

from app.core.security import hash_password
from app.db import SessionLocal
from app.models import Role, User
from app.schemas import PASSWORD_MAX, PASSWORD_MIN
from app.services import audit
from app.services.vault import generate_private_key_pem


def create_user(args: argparse.Namespace) -> int:
    password = getpass.getpass(f"Password ({PASSWORD_MIN}-{PASSWORD_MAX} chars): ")
    if not PASSWORD_MIN <= len(password) <= PASSWORD_MAX:
        print(f"Password must be {PASSWORD_MIN}-{PASSWORD_MAX} characters.", file=sys.stderr)
        return 1
    if getpass.getpass("Repeat password: ") != password:
        print("Passwords do not match.", file=sys.stderr)
        return 1
    email = args.email.strip().lower()
    with SessionLocal() as db:
        if db.execute(select(User.id).where(User.email == email)).first():
            print(f"{email} already exists.", file=sys.stderr)
            return 1
        user = User(
            email=email,
            full_name=args.name,
            password_hash=hash_password(password),
            role=Role(args.role),
            is_active=True,
        )
        db.add(user)
        db.flush()
        audit.record(
            db,
            "user.created",
            entity_type="user",
            entity_id=user.id,
            details={"role": user.role.value, "via": "cli"},
        )
        db.commit()
        print(f"Created {user.role.value} #{user.id} <{email}>")
    return 0


def set_password(args: argparse.Namespace) -> int:
    """Set one new password on an account, or on every account in an email domain."""
    if bool(args.email) == bool(args.domain):
        print("Give exactly one of --email or --domain.", file=sys.stderr)
        return 1
    password = getpass.getpass(f"New password ({PASSWORD_MIN}-{PASSWORD_MAX} chars): ")
    if not PASSWORD_MIN <= len(password) <= PASSWORD_MAX:
        print(f"Password must be {PASSWORD_MIN}-{PASSWORD_MAX} characters.", file=sys.stderr)
        return 1
    if getpass.getpass("Repeat password: ") != password:
        print("Passwords do not match.", file=sys.stderr)
        return 1
    with SessionLocal() as db:
        if args.email:
            query = select(User).where(User.email == args.email.strip().lower())
        else:
            domain = args.domain.strip().lower().lstrip("@")
            query = select(User).where(User.email.like(f"%@{domain}"))
        users = db.execute(query).scalars().all()
        if not users:
            print("No matching accounts.", file=sys.stderr)
            return 1
        new_hash = hash_password(password)  # bcrypt is slow; one hash serves every account
        for user in users:
            user.password_hash = new_hash
            audit.record(
                db,
                "user.password_set",
                entity_type="user",
                entity_id=user.id,
                details={"via": "cli"},
            )
        db.commit()
        for user in users:
            print(f"  {user.role.value:<9} {user.email}")
        print(f"Password updated for {len(users)} account(s).")
    return 0


def generate_vault_key(args: argparse.Namespace) -> int:
    out = Path(args.out)
    if out.exists():
        print(f"{out} already exists; refusing to overwrite a vault key.", file=sys.stderr)
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(generate_private_key_pem())
    os.chmod(out, 0o600)
    print(f"Wrote {out}. Back it up securely: losing it makes the vault unreadable.")
    return 0


def verify_audit(_: argparse.Namespace) -> int:
    with SessionLocal() as db:
        report = audit.verify_chain(db)
    print(report)
    return 0 if report.valid else 2


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(required=True)

    p = sub.add_parser("create-user")
    p.add_argument("--role", required=True, choices=[r.value for r in Role])
    p.add_argument("--email", required=True)
    p.add_argument("--name", required=True)
    p.set_defaults(func=create_user)

    p = sub.add_parser("set-password")
    p.add_argument("--email", help="one account")
    p.add_argument("--domain", help="every account whose email ends in @DOMAIN")
    p.set_defaults(func=set_password)

    p = sub.add_parser("generate-vault-key")
    p.add_argument("--out", default="keys/vault_private.pem")
    p.set_defaults(func=generate_vault_key)

    p = sub.add_parser("verify-audit")
    p.set_defaults(func=verify_audit)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
