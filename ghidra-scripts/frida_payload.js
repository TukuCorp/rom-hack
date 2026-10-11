'use strict';

// IsLeapYear lives at image base + 0x2669c, and takes its argument in EAX.
const TARGET_RVA = 0x2669c;

function resolveExport(name) {
  try {
    if (typeof Module.findGlobalExportByName === "function") {
      const p = Module.findGlobalExportByName(name);
      if (p) return p;
    }
  } catch (e) {}
  try {
    if (typeof Module.findExportByName === "function") {
      const p = Module.findExportByName(null, name);
      if (p) return p;
    }
  } catch (e) {}
  return null;
}

const mod = Process.findModuleByName("testleap.exe");
if (!mod) {
  send({ kind: "fatal", why: "testleap.exe module not found" });
} else {
  const target = mod.base.add(TARGET_RVA);
  send({ kind: "resolved", base: mod.base.toString(), addr: target.toString() });

  // A trampoline, because NativeFunction assumes a stack-based ABI and this function
  // reads its argument from EAX. Bytes: mov eax,imm32 ; call rel32 ; ret
  const PAGE = Memory.alloc(Process.pageSize);
  Memory.protect(PAGE, Process.pageSize, "rwx");
  const rel = target.sub(PAGE.add(10)).toInt32();
  PAGE.add(5).writeU8(0xE8);
  PAGE.add(6).writeS32(rel);
  PAGE.add(10).writeU8(0xC3);
  const trampoline = new NativeFunction(PAGE, "uint8", []);

  let inDirect = false;

  Interceptor.attach(target, {
    onEnter: function () { this.year = this.context.eax & 0xffff; this.direct = inDirect; },
    onLeave: function (retval) {
      send({ kind: "hook", year: this.year, ret: retval.toInt32() & 0xff, direct: this.direct });
    }
  });

  function callIsLeap(y) {
    PAGE.writeU8(0xB8);
    PAGE.add(1).writeU32(y & 0xffff);
    inDirect = true;
    try { return trampoline(); } finally { inDirect = false; }
  }

  const years = [0, 1, 4, 100, 400, 1600, 1700, 1800, 1900, 1996, 2000,
                 2023, 2024, 2100, 2400, 32004, 65532, 65535];
  const direct = [];
  years.forEach(function (y) { direct.push([y, callIsLeap(y)]); });
  send({ kind: "direct", results: direct });
}

const API_ARGS = {
  "RegOpenKeyExW": 1,
  "RegQueryValueExW": 1,
  "CreateFileW": 0,
  "FindFirstFileW": 0,
  "GetFileVersionInfoSizeW": 0
};

Object.keys(API_ARGS).forEach(function (name) {
  const p = resolveExport(name);
  if (!p) { send({ kind: "api-missing", name: name }); return; }
  const idx = API_ARGS[name];
  Interceptor.attach(p, {
    onEnter: function (args) {
      let s = "";
      try { s = args[idx].isNull() ? "" : args[idx].readUtf16String(); } catch (e) { s = "<unreadable>"; }
      send({ kind: "api", name: name, value: s });
    }
  });
  send({ kind: "api-hooked", name: name });
});
