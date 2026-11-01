"""The device bundle: the library, compressed and encrypted, plus a manifest.

Format "GLIB1": a small JSON header followed by fixed-size chunks of the
gzip-compressed database, each chunk sealed with AES-256-GCM. The key is
derived from a passphrase with PBKDF2-HMAC-SHA256. A browser can decrypt and
inflate it with nothing but WebCrypto and DecompressionStream, chunk by chunk,
without holding the whole thing in memory twice.

    magic        b"GLIB1\\n"
    header_len   uint32 big-endian
    header       JSON: salt, iterations, nonce_prefix, chunk_size, chunks, ...
    chunk*       uint32 big-endian ciphertext length, then the ciphertext

The same format carries the nightly job's private state between runs.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import os
import sqlite3
import struct
import tempfile
import zlib
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .db import counts as db_counts

MAGIC = b"GLIB1\n"
CHUNK = 4 * 1024 * 1024
ITERATIONS = 310_000


def _aesgcm():
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as exc:  # pragma: no cover
        raise SystemExit("the 'cryptography' package is needed for bundles: pip install cryptography") from exc
    return AESGCM


def derive_key(passphrase: str, salt: bytes, iterations: int = ITERATIONS) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", passphrase.encode("utf-8"), salt, iterations, dklen=32)


def encrypt_file(src: Path, dst: Path, passphrase: str, *, compress: bool = True, extra: dict | None = None) -> dict:
    """Write src as an encrypted bundle at dst. Returns the header."""
    AESGCM = _aesgcm()
    salt = os.urandom(16)
    nonce_prefix = os.urandom(8)
    key = derive_key(passphrase, salt)
    aead = AESGCM(key)
    plain_size = src.stat().st_size
    sha = hashlib.sha256()
    header = {
        "format": "GLIB1",
        "salt": base64.b64encode(salt).decode(),
        "iterations": ITERATIONS,
        "nonce_prefix": base64.b64encode(nonce_prefix).decode(),
        "chunk_size": CHUNK,
        "compressed": compress,
        "plain_size": plain_size,
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    header.update(extra or {})

    # Pass 1: compress to a temporary stream so the chunk count is known.
    tmp = Path(tempfile.mkstemp(prefix="glib-", suffix=".gz", dir=dst.parent)[1])
    try:
        with src.open("rb") as fin:
            if compress:
                with gzip.open(tmp, "wb", compresslevel=6) as fout:
                    while True:
                        block = fin.read(1 << 20)
                        if not block:
                            break
                        sha.update(block)
                        fout.write(block)
            else:
                with tmp.open("wb") as fout:
                    while True:
                        block = fin.read(1 << 20)
                        if not block:
                            break
                        sha.update(block)
                        fout.write(block)
        payload_size = tmp.stat().st_size
        chunks = max(1, -(-payload_size // CHUNK))
        header["sha256"] = sha.hexdigest()
        header["payload_size"] = payload_size
        header["chunks"] = chunks
        head = json.dumps(header, separators=(",", ":")).encode("utf-8")

        with tmp.open("rb") as fin, dst.open("wb") as fout:
            fout.write(MAGIC)
            fout.write(struct.pack(">I", len(head)))
            fout.write(head)
            for i in range(chunks):
                block = fin.read(CHUNK)
                nonce = nonce_prefix + struct.pack(">I", i)
                ct = aead.encrypt(nonce, block, struct.pack(">I", i))
                fout.write(struct.pack(">I", len(ct)))
                fout.write(ct)
    finally:
        tmp.unlink(missing_ok=True)
    header["bundle_size"] = dst.stat().st_size
    return header


def read_header(src: Path) -> dict:
    with src.open("rb") as fin:
        if fin.read(len(MAGIC)) != MAGIC:
            raise ValueError(f"{src} is not a GLIB1 bundle")
        (n,) = struct.unpack(">I", fin.read(4))
        return json.loads(fin.read(n).decode("utf-8"))


def decrypt_file(src: Path, dst: Path, passphrase: str) -> dict:
    """Inverse of encrypt_file. Raises ValueError on a wrong passphrase."""
    AESGCM = _aesgcm()
    with src.open("rb") as fin:
        if fin.read(len(MAGIC)) != MAGIC:
            raise ValueError(f"{src} is not a GLIB1 bundle")
        (n,) = struct.unpack(">I", fin.read(4))
        header = json.loads(fin.read(n).decode("utf-8"))
        key = derive_key(passphrase, base64.b64decode(header["salt"]), header["iterations"])
        aead = AESGCM(key)
        prefix = base64.b64decode(header["nonce_prefix"])
        decomp = zlib.decompressobj(16 + zlib.MAX_WBITS) if header.get("compressed", True) else None
        sha = hashlib.sha256()
        with dst.open("wb") as fout:
            for i in range(header["chunks"]):
                (clen,) = struct.unpack(">I", fin.read(4))
                ct = fin.read(clen)
                try:
                    block = aead.decrypt(prefix + struct.pack(">I", i), ct, struct.pack(">I", i))
                except Exception as exc:  # InvalidTag
                    raise ValueError("wrong passphrase or damaged bundle") from exc
                out = decomp.decompress(block) if decomp else block
                sha.update(out)
                fout.write(out)
            if decomp:
                tail = decomp.flush()
                sha.update(tail)
                fout.write(tail)
    if header.get("sha256") and sha.hexdigest() != header["sha256"]:
        raise ValueError("bundle contents did not verify")
    return header


# ---------------------------------------------------------------------------

def content_version(conn: sqlite3.Connection) -> str:
    """Changes only when the text of the library changes, not when it was fetched."""
    h = hashlib.sha256()
    for uri, digest in conn.execute("SELECT uri, content_hash FROM documents ORDER BY uri"):
        h.update(f"{uri}:{digest}\n".encode("utf-8"))
    return h.hexdigest()[:16]


def build(out_dir: Path, passphrase: str, *, db_path: Path = config.DB_PATH, skills_path: Path | None = None) -> dict:
    """Create out_dir/library.bin and out_dir/manifest.json from the library.

    If a private skills file (data/skills.json: how Ask should write for its
    owner) is present, it is sealed alongside as skills.bin and listed in the
    manifest, so the app can fetch and unlock it with the same passphrase.
    """
    from .db import stats

    if skills_path is None:
        skills_path = config.DATA_DIR / "skills.json"

    out_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    version = content_version(conn)
    s = stats(conn)
    cached = db_counts(conn)
    # Keep the counts current inside the copy the devices receive.
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('counts', ?)", (json.dumps(cached),))
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('bundle', ?)",
                 (json.dumps({"version": version, "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}),))
    conn.commit()
    compact = out_dir / "library.compact.sqlite"
    compact.unlink(missing_ok=True)
    conn.execute("VACUUM INTO ?", (str(compact),))
    conn.close()

    extra = {"version": version, "kind": "library"}
    header = encrypt_file(compact, out_dir / "library.bin", passphrase, extra=extra)
    compact.unlink(missing_ok=True)
    manifest = {
        "format": "GLIB1",
        "version": version,
        "built_at": header["built_at"],
        "file": "library.bin",
        "bundle_size": header["bundle_size"],
        "plain_size": header["plain_size"],
        "sha256": header["sha256"],
        "documents": s["documents"],
        "verses": cached["verses"],
        "paragraphs": cached["paragraphs"],
        "talks": s["talks"],
        "latest_conference": s["latest_conference"],
        "collections": [{"slug": c["slug"], "title": c["title"], "docs": c["docs"]} for c in s["collections"]],
    }
    if skills_path.exists():
        json.loads(skills_path.read_text(encoding="utf-8"))  # must be valid JSON before it is sealed
        sh = encrypt_file(skills_path, out_dir / "skills.bin", passphrase, extra={"kind": "skills"})
        manifest["skills"] = {"file": "skills.bin", "sha256": sh["sha256"], "size": sh["bundle_size"], "built_at": sh["built_at"]}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    return manifest
