"""For delta.spec.mjs: from a published test library, build a delta to a copy with one chapter's
title changed, the way the nightly job builds one (gospel_library.delta), and a manifest that
lists it. Usage: python3 delta-fixture.py <library.bin> <manifest.json> <out dir> <passphrase>
Writes <out>/delta-<from>.bin and <out>/manifest.json, and prints what it built as JSON."""
import json, shutil, sqlite3, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from gospel_library import bundle, delta  # noqa: E402

URI, TITLE = "/scriptures/bofm/moro/10", "Moroni 10, revised"

library, manifest, out, passphrase = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4]
out.mkdir(parents=True, exist_ok=True)
old, new = out / "old.sqlite", out / "new.sqlite"
bundle.decrypt_file(library, old, passphrase)
oc = sqlite3.connect(old)
v_from = delta.library_version(oc)
snap = delta.take_snapshot(oc, v_from)
oc.close()

shutil.copy(old, new)
old.unlink()
nc = sqlite3.connect(new)
assert nc.execute("UPDATE documents SET title = ?, content_hash = content_hash || '-revised' WHERE uri = ?", (TITLE, URI)).rowcount == 1, f"{URI} is not in the library"
nc.commit()
v_to = delta.library_version(nc)
# a build writes its version into the copy it ships (bundle.build); the device reads it from there on launch
nc.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('bundle', ?)", (json.dumps({"version": v_to, "built_at": "2026-11-09T06:00:00Z"}),))
nc.commit()
info = delta.build_delta(nc, new, snap, v_to, out / f"delta-{v_from}.bin", passphrase)
nc.close()
new.unlink()
assert info and info["documents_changed"] == 1, info

m = json.loads(manifest.read_text())
m.update(version=v_to, built_at="2026-11-09T06:00:00Z")
m["deltas"] = [{k: info[k] for k in ("from", "file", "size", "sha256", "documents_changed", "documents_removed")}]
(out / "manifest.json").write_text(json.dumps(m, indent=1))
print(json.dumps({"from": v_from, "to": v_to, "uri": URI, "title": TITLE, "file": info["file"]}))
