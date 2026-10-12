#!/usr/bin/env python3
"""Surgical fixes for ranking-tier zlib.b64 payloads before decode."""
from pathlib import Path

root = Path("scripts/ranking-tier-payloads")

# Create: replace corrupted token (Tensorflow -> npz) using byte literals
cp = root / "src__components__CreateTournamentModal.tsx.zlib.b64"
ct = cp.read_text()
bad = "".join(chr(c) for c in [0x54, 0x65, 0x6E, 0x73, 0x6F, 0x72, 0x66, 0x6C, 0x6F, 0x77])
good = "".join(chr(c) for c in [0x6E, 0x70, 0x7A])
if bad in ct:
    ct = ct.replace(bad, good, 1)
    cp.write_text(ct if ct.endswith("\n") else ct + "\n")
    print("fixed Create payload")
else:
    print("Create payload already clean or unexpected")

# Edit: Z@509 -> R, W@1682 -> V, insert H@12608
ep = root / "src__components__EditTournamentModal.tsx.zlib.b64"
et_raw = ep.read_text().strip()
et = list(et_raw)
changed = False
if len(et) >= 1683 and et[509] == "Z" and et[1682] == "W":
    et[509] = "R"
    et[1682] = "V"
    et.insert(12608, "H")
    changed = True
elif len(et) >= 15488 and et[509] == "R" and et[1682] == "V" and et[12608] == "H":
    print("Edit payload already clean")
else:
    # maybe already fixed length but check md5 path later
    print("Edit payload state:", len(et), et[509] if len(et)>509 else None, et[1682] if len(et)>1682 else None)

if changed:
    out = "".join(et) + "\n"
    ep.write_text(out)
    print("fixed Edit payload", len(et))
