"""Build a retry resume-list: done.txt minus any address with no exported record."""
import os, shutil, sys

main = r"C:\Users\tukum\Downloads\rom-hack\leap-decompiled"
retry = r"C:\Users\tukum\Downloads\rom-hack\leap-decompiled-retry"
os.makedirs(retry, exist_ok=True)

recorded = set()
with open(os.path.join(main, "index.tsv"), encoding="utf-8", errors="replace") as fh:
    for line in fh:
        parts = line.rstrip("\n").split("\t")
        if parts and parts[0]:
            recorded.add(parts[0])

done = [l.strip() for l in open(os.path.join(main, "done.txt"), encoding="utf-8", errors="replace") if l.strip()]
failed = [a for a in done if a not in recorded]
keep = [a for a in done if a in recorded]

with open(os.path.join(retry, "done.txt"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(keep) + "\n")

print("recorded addresses :", len(recorded))
print("done entries       :", len(done))
print("failed to retry    :", len(failed))
print("retry done.txt has :", len(keep))
print("retry list sample  :", ", ".join(sorted(failed)[:6]))

