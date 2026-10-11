import importlib.util, os
spec = importlib.util.spec_from_file_location("cc", r"C:\Users\tukum\Downloads\rom-hack\ghidra-scripts\crosscheck_export.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
d = r"C:\Users\tukum\Downloads\rom-hack\leap-decomp-test"
addrs = [l.strip() for l in open(os.path.join(d, "done.txt"), encoding="utf-8") if l.strip()]
want = set(addrs[:5]) | set(addrs[-5:])
got = m.fetch_code(d, want)
print("requested", len(want), "extracted", len(got))
for a in sorted(got)[:2]:
    print("---", a, "chars", len(got[a]))
    print(m.norm(got[a])[:160].replace(chr(10), " | "))
print("norm strips CRLF:", m.norm("a\r\nb\r\n") == "a\nb")
print("norm trims trailing ws:", m.norm("x   \n y  ") == "x\n y")
print("norm collapses nothing else:", m.norm("a  b") == "a  b")
