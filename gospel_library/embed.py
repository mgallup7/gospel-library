"""Meaning vectors: every paragraph of the library embedded once, so search
can find a passage by what it says and not only by the words it uses.

The model is BAAI's bge-small-en-v1.5 in its ONNX form (Xenova's repository
on the Hugging Face Hub), run here with onnxruntime and the same int8 file
the app runs in the browser, so a query embedded on the device lands in the
same space as the paragraphs embedded by the nightly job.

Storage: ``vectors(paragraph_id, v)`` in the working database holds each
vector as 384 signed bytes (the float value times 127). The device bundle
carries only the sign bits (48 bytes a paragraph, ``vecbits``), which the
engine scores asymmetrically against the full query vector; that keeps the
download small and the ranking close to the real thing. Paragraphs that
vanish (a page refetched, its paragraphs rewritten) lose their rows and the
new paragraphs are embedded on the next run.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import numpy as np

from . import config

log = logging.getLogger("gospel.embed")

MODEL_REPO = "Xenova/bge-small-en-v1.5"
MODEL_NAME = "bge-small-en-v1.5"
MODEL_FILES = {
    "model_quantized.onnx": "onnx/model_quantized.onnx",
    "tokenizer.json": "tokenizer.json",
    "config.json": "config.json",
}
HF_BASE = "https://huggingface.co"
DIMS = 384
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
MAX_TOKENS = 256     # a paragraph longer than this is embedded from its first 256 tokens
POOLING = "cls"      # bge pools the [CLS] token

SCHEMA = """
CREATE TABLE IF NOT EXISTS vectors(
  paragraph_id INTEGER PRIMARY KEY,
  v BLOB NOT NULL
);
"""


def model_dir() -> Path:
    return config.DATA_DIR / "model" / MODEL_NAME


def ensure_model(dest: Path | None = None) -> Path:
    """The model files, downloaded from the Hub when they are not here yet."""
    import requests

    dest = dest or model_dir()
    dest.mkdir(parents=True, exist_ok=True)
    for name, remote in MODEL_FILES.items():
        target = dest / name
        if target.exists() and target.stat().st_size > 1000:
            continue
        url = f"{HF_BASE}/{MODEL_REPO}/resolve/main/{remote}"
        log.info("downloading %s", url)
        with requests.get(url, stream=True, timeout=(15, 300)) as r:
            r.raise_for_status()
            tmp = target.with_suffix(target.suffix + ".part")
            with tmp.open("wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
            tmp.replace(target)
    # the vocabulary alone, for the app's own tokenizer
    vocab = dest / "vocab.txt"
    if not vocab.exists():
        tok = json.loads((dest / "tokenizer.json").read_text(encoding="utf-8"))
        items = sorted(tok["model"]["vocab"].items(), key=lambda kv: kv[1])
        vocab.write_text("\n".join(t for t, _ in items) + "\n", encoding="utf-8")
    return dest


class Embedder:
    """Texts in, unit vectors out, through the ONNX model."""

    def __init__(self, path: Path | None = None, *, threads: int | None = None):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        path = path or model_dir()
        self.path = path
        self.tokenizer = Tokenizer.from_file(str(path / "tokenizer.json"))
        self.tokenizer.enable_truncation(MAX_TOKENS)
        self.tokenizer.no_padding()
        opts = ort.SessionOptions()
        if threads:
            opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(path / "model_quantized.onnx"), opts, providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.session.get_inputs()}
        self.output = self.session.get_outputs()[0].name

    def encode(self, texts: list[str], *, query: bool = False) -> np.ndarray:
        if not texts:
            return np.zeros((0, DIMS), dtype=np.float32)
        if query:
            texts = [QUERY_PREFIX + t for t in texts]
        encs = self.tokenizer.encode_batch(texts)
        length = max(len(e.ids) for e in encs)
        ids = np.zeros((len(encs), length), dtype=np.int64)
        mask = np.zeros((len(encs), length), dtype=np.int64)
        for i, e in enumerate(encs):
            ids[i, : len(e.ids)] = e.ids
            mask[i, : len(e.ids)] = 1
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.inputs:
            feed["token_type_ids"] = np.zeros_like(ids)
        out = self.session.run([self.output], feed)[0]  # [n, length, dims]
        if POOLING == "cls":
            vec = out[:, 0, :]
        else:
            m = mask[:, :, None].astype(np.float32)
            vec = (out * m).sum(axis=1) / np.maximum(m.sum(axis=1), 1e-9)
        norm = np.linalg.norm(vec, axis=1, keepdims=True)
        return (vec / np.maximum(norm, 1e-9)).astype(np.float32)


def to_int8(vec: np.ndarray) -> bytes:
    return np.clip(np.rint(vec * 127), -127, 127).astype(np.int8).tobytes()


def to_bits(v: bytes) -> bytes:
    """The sign bits of an int8 vector, 8 to a byte, most significant first."""
    a = np.frombuffer(v, dtype=np.int8)
    return np.packbits(a >= 0).tobytes()


def ensure_schema(conn) -> None:
    conn.executescript(SCHEMA)


def embed_missing(conn, embedder: Embedder, *, batch: int = 64, minutes: float | None = None, progress_every: int = 5000) -> dict:
    """Embed every verse and paragraph that has no vector yet; drop vectors of paragraphs that are gone."""
    ensure_schema(conn)
    gone = conn.execute("DELETE FROM vectors WHERE paragraph_id NOT IN (SELECT rowid FROM paragraphs)").rowcount
    rows = conn.execute(
        "SELECT p.rowid, p.text FROM paragraphs p WHERE p.kind IN ('verse', 'para') AND p.rowid NOT IN (SELECT paragraph_id FROM vectors) ORDER BY p.rowid"
    ).fetchall()
    todo = [(r[0], r[1]) for r in rows if r[1] and len(r[1].split()) >= 2]
    log.info("%d paragraphs to embed (%d stale vectors dropped)", len(todo), gone)
    started = time.monotonic()
    deadline = started + minutes * 60 if minutes else None
    done = 0
    for i in range(0, len(todo), batch):
        if deadline and time.monotonic() > deadline:
            log.info("time budget reached with %d paragraphs left", len(todo) - done)
            break
        chunk = todo[i : i + batch]
        vecs = embedder.encode([t for _, t in chunk])
        conn.executemany("INSERT OR REPLACE INTO vectors(paragraph_id, v) VALUES (?, ?)", [(pid, to_int8(vecs[j])) for j, (pid, _) in enumerate(chunk)])
        done += len(chunk)
        if done % progress_every < batch:
            conn.commit()
            log.info("%d / %d embedded (%.0f/s)", done, len(todo), done / max(1e-9, time.monotonic() - started))
    conn.commit()
    total = conn.execute("SELECT COUNT(*) FROM vectors").fetchone()[0]
    info = {"model": MODEL_NAME, "dims": DIMS, "count": total, "pooling": POOLING, "query_prefix": QUERY_PREFIX, "max_tokens": MAX_TOKENS,
            "embedded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "left": max(0, len(todo) - done)}
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('embeddings', ?)", (json.dumps(info),))
    conn.commit()
    log.info("vectors: %s", info)
    return info


def pack_bits(conn) -> int:
    """In a bundle database: the sign bits of every vector in ``vecbits``, and the int8 table dropped."""
    conn.execute("CREATE TABLE IF NOT EXISTS vecbits(paragraph_id INTEGER PRIMARY KEY, bits BLOB NOT NULL)")
    conn.execute("DELETE FROM vecbits")
    n = 0
    cur = conn.execute("SELECT paragraph_id, v FROM vectors ORDER BY paragraph_id")
    batch = []
    for pid, v in cur:
        batch.append((pid, to_bits(v)))
        n += 1
        if len(batch) >= 5000:
            conn.executemany("INSERT INTO vecbits(paragraph_id, bits) VALUES (?, ?)", batch)
            batch = []
    if batch:
        conn.executemany("INSERT INTO vecbits(paragraph_id, bits) VALUES (?, ?)", batch)
    conn.execute("DROP TABLE vectors")
    conn.commit()
    return n


def smoke_test(conn, embedder: Embedder, queries: list[str], *, k: int = 5, chunk: int = 50000) -> list[tuple[str, list[tuple[float, str, str]]]]:
    """The top paragraphs for a few queries, scored against the int8 vectors: a check that it all fits together.
    The vectors are read in chunks, so a library of half a million paragraphs does not need them all in memory at once."""
    qvs = embedder.encode(list(queries), query=True) if queries else np.zeros((0, DIMS), dtype=np.float32)
    best: list[list[tuple[float, int]]] = [[] for _ in queries]
    cur = conn.execute("SELECT paragraph_id, v FROM vectors ORDER BY paragraph_id")
    while True:
        rows = cur.fetchmany(chunk)
        if not rows:
            break
        ids = np.array([r[0] for r in rows], dtype=np.int64)
        mat = np.frombuffer(b"".join(r[1] for r in rows), dtype=np.int8).reshape(len(rows), DIMS).astype(np.float32) / 127.0
        scores = mat @ qvs.T  # [n, queries]
        for qi in range(len(queries)):
            col = scores[:, qi]
            top = np.argpartition(-col, min(k, len(col) - 1))[:k] if len(col) > k else np.arange(len(col))
            best[qi] = sorted(best[qi] + [(float(col[i]), int(ids[i])) for i in top], key=lambda t: -t[0])[:k]
    out = []
    for qi, q in enumerate(queries):
        found = []
        for score, pid in best[qi]:
            r = conn.execute("SELECT p.text, d.title FROM paragraphs p JOIN documents d ON d.id = p.document_id WHERE p.rowid = ?", (pid,)).fetchone()
            found.append((score, r[1] if r else "?", (r[0] if r else "")[:120]))
        out.append((q, found))
    return out
