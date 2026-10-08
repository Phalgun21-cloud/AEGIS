"""Vault crypto.

Envelope encryption: every protected blob (one approved question, one generated paper)
gets its own random AES-256-GCM data key. That data key is wrapped with the vault's RSA
public key (RSA-OAEP-SHA256) and stored next to the ciphertext. RSA is never used for
bulk data. An AAD string binds each ciphertext to its record, so a blob can't be moved
to another row and still decrypt.

MVP key custody: the RSA private key lives in a platform secret (VAULT_PRIVATE_KEY).
HSM/KMS custody is future scope.
"""

import hashlib
import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings

_OAEP = padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


class VaultError(Exception):
    pass


@dataclass(frozen=True)
class SealedBlob:
    ciphertext: bytes
    nonce: bytes
    wrapped_key: bytes
    sha256: str  # digest of the plaintext, for integrity/audit references


def generate_private_key_pem() -> bytes:
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )


@lru_cache
def _private_key() -> rsa.RSAPrivateKey:
    s = get_settings()
    if s.vault_private_key:
        pem = s.vault_private_key.replace("\n", "\n").encode()
    else:
        path = Path(s.vault_private_key_file)
        if not path.exists():
            if s.is_production:
                raise VaultError("vault private key is not configured")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(generate_private_key_pem())
            os.chmod(path, 0o600)
        pem = path.read_bytes()
    key = serialization.load_pem_private_key(pem, password=None)
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
        raise VaultError("vault key must be an RSA key of at least 2048 bits")
    return key


def seal(payload: dict, aad: str) -> SealedBlob:
    plaintext = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    data_key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    ciphertext = AESGCM(data_key).encrypt(nonce, plaintext, aad.encode())
    wrapped = _private_key().public_key().encrypt(data_key, _OAEP)
    return SealedBlob(ciphertext, nonce, wrapped, hashlib.sha256(plaintext).hexdigest())


def unseal(ciphertext: bytes, nonce: bytes, wrapped_key: bytes, aad: str) -> dict:
    try:
        data_key = _private_key().decrypt(wrapped_key, _OAEP)
        plaintext = AESGCM(data_key).decrypt(nonce, ciphertext, aad.encode())
    except VaultError:
        raise
    except Exception as exc:  # InvalidTag, ValueError from RSA
        raise VaultError("vault blob failed integrity check") from exc
    return json.loads(plaintext)
