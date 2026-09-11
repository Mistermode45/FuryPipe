#!/usr/bin/env python3
# Grade the constant-cost style sweep (mirror of ../sweep/grade_sweep.py).
#   per-label  = right hex id under the right label (needs read + row-assoc)
#   bag-of-ids = gold ids found ANYWHERE in output (isolates pure glyph reading)
# All arms are 5x8 / identical token cost, so any delta is a free readability win.
import json, os, re, sys
from collections import Counter

D = "/tmp/style"
golds = json.load(open(f"{D}/golds.json"))
TAG = sys.argv[1] if len(sys.argv) > 1 else "opus"
ARMS = ["prod", "onebit", "color", "grid", "cgrid"]
LINE = re.compile(r"^\s*([A-E])\s*[:.]\s*`?([0-9a-fA-F]{12})`?\s*$")
HEX12 = re.compile(r"[0-9a-fA-F]{12}")

print(f"tag={TAG}  (all arms 5x8, ~35 img tokens — constant cost)")
print(f"{'style':8s} {'per-label':>10s} {'bag-of-ids':>11s}  pages  top confusions")
for k in ARMS:
    if k not in golds: continue
    lab_hit=lab_tot=bag_hit=bag_tot=pages=bad=0
    conf=Counter()
    for i in range(len(golds[k])):
        p=f"{D}/out_{TAG}_{k}_{i}.txt"
        if not os.path.exists(p) or os.path.getsize(p)==0: bad+=1; continue
        txt=open(p).read()
        labeled={}
        for ln in txt.splitlines():
            m=LINE.match(ln.strip())
            if m: labeled[m.group(1)]=m.group(2).lower()
        allids={h.lower() for h in HEX12.findall(txt)}
        gold=golds[k][i]
        pages+=1
        for lbl,gid in gold.items():
            bag_tot+=1
            if gid in allids: bag_hit+=1
        if len(labeled)==5:
            for lbl,gid in gold.items():
                lab_tot+=1
                g=labeled.get(lbl,"")
                if g==gid: lab_hit+=1
                elif len(g)==12:
                    for a,b in zip(gid,g):
                        if a!=b: conf[(a,b)]+=1
    lp=f"{100*lab_hit/lab_tot:.0f}%" if lab_tot else "--"
    bp=f"{100*bag_hit/bag_tot:.0f}%" if bag_tot else "--"
    cf=", ".join(f"{a}->{b}x{n}" for (a,b),n in sorted(conf.items(),key=lambda x:-x[1])[:6])
    print(f"{k:8s} {lab_hit:2d}/{lab_tot:<2d} {lp:>4s} {bag_hit:2d}/{bag_tot:<2d} {bp:>4s}  {pages}pg b{bad}  {cf}")
