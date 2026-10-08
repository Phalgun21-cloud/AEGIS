import pytest

from app.services import vault


def test_seal_roundtrip():
    payload = {"stem": "What is 2 + 2?", "options": ["3", "4"], "correct_option": 1}
    blob = vault.seal(payload, "aegis:question:1")
    assert payload["stem"].encode() not in blob.ciphertext
    assert (
        vault.unseal(blob.ciphertext, blob.nonce, blob.wrapped_key, "aegis:question:1") == payload
    )


def test_each_seal_uses_a_fresh_data_key_and_nonce():
    a = vault.seal({"x": 1}, "ctx")
    b = vault.seal({"x": 1}, "ctx")
    assert a.wrapped_key != b.wrapped_key
    assert a.nonce != b.nonce
    assert a.sha256 == b.sha256  # same plaintext digest


def test_tampered_ciphertext_is_rejected():
    blob = vault.seal({"x": 1}, "ctx")
    tampered = bytes([blob.ciphertext[0] ^ 1]) + blob.ciphertext[1:]
    with pytest.raises(vault.VaultError):
        vault.unseal(tampered, blob.nonce, blob.wrapped_key, "ctx")


def test_blob_cannot_be_moved_to_another_record():
    blob = vault.seal({"x": 1}, "aegis:question:1")
    with pytest.raises(vault.VaultError):
        vault.unseal(blob.ciphertext, blob.nonce, blob.wrapped_key, "aegis:question:2")


def test_wrapped_key_is_rsa_sized_not_raw_aes_key():
    blob = vault.seal({"x": 1}, "ctx")
    assert len(blob.wrapped_key) == 384  # RSA-3072 OAEP output, not the 32-byte AES key
