// Exhaustively verify a DecompileAll export against a fresh decompilation.
//
// Upgrades the 25-function sample crosscheck into a full pass: every exported record is
// re-decompiled in this process and compared with the text on disk. What it can catch is
// export corruption -- truncated records, mixed-up addresses, missing or extra functions.
// What it cannot catch is decompiler error, since both sides come from the same decompiler.
//
// Usage: analyzeHeadless <proj> <name> -process leap.exe -noanalysis -scriptPath <dir> \\
//          -postScript VerifyExport.java <exportDir>

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.app.decompiler.parallel.ParallelDecompiler;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.util.task.TaskMonitor;
import generic.concurrent.QCallback;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

public class VerifyExport extends GhidraScript {

    private static class Rec {
        String addr;
        String name;
        String fresh;
    }

    private static final Object LOCK = new Object();
    private static final ThreadLocal<DecompInterface> TL = new ThreadLocal<DecompInterface>() {
        @Override
        protected DecompInterface initialValue() {
            DecompInterface di = new DecompInterface();
            di.setOptions(new DecompileOptions());
            di.toggleCCode(true);
            di.toggleSyntaxTree(true);
            return di;
        }
    };

    private static final Map<String, String> exported = new HashMap<String, String>();
    private static BufferedWriter mismatchWriter;
    private static BufferedWriter progressWriter;
    private static File outDir;
    private static long ok = 0;
    private static long bad = 0;
    private static long freshFailed = 0;
    private static long total = 0;

    private static String norm(String s) {
        if (s == null) {
            return null;
        }
        String[] parts = s.replace("\r\n", "\n").replace("\r", "\n").split("\n", -1);
        StringBuilder sb = new StringBuilder(s.length());
        for (int i = 0; i < parts.length; i++) {
            if (i > 0) {
                sb.append('\n');
            }
            sb.append(parts[i].replaceAll("[ \\t]+$", ""));
        }
        return sb.toString().trim();
    }

    private void loadExport(File dir) throws Exception {
        File[] entries = dir.listFiles();
        if (entries == null) {
            throw new IllegalStateException("cannot list " + dir);
        }
        int files = 0;
        for (File f : entries) {
            String n = f.getName();
            if (!n.startsWith("chunk-") || !n.endsWith(".c")) {
                continue;
            }
            files++;
            BufferedReader r = new BufferedReader(new FileReader(f));
            String line;
            String cur = null;
            StringBuilder body = new StringBuilder();
            boolean sawSig = false;
            while ((line = r.readLine()) != null) {
                if (line.startsWith("/* ===== ") && !line.startsWith("/* ===== end ")) {
                    int sp = line.indexOf("  ");
                    cur = sp > 0 ? line.substring("/* ===== ".length(), sp) : null;
                    body.setLength(0);
                    sawSig = false;
                    continue;
                }
                if (line.startsWith("/* ===== end ")) {
                    if (cur != null) {
                        exported.put(cur, norm(body.toString()));
                    }
                    cur = null;
                    continue;
                }
                if (cur != null) {
                    if (!sawSig) {
                        sawSig = true;
                        if (line.startsWith("/* ") && line.endsWith(" */")) {
                            continue;
                        }
                    }
                    body.append(line).append('\n');
                }
            }
            r.close();
        }
        println("VerifyExport: " + files + " chunks, " + exported.size() + " exported records");
    }

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("usage: VerifyExport <exportDir>");
            return;
        }
        outDir = new File(args[0]);
        loadExport(outDir);

        mismatchWriter = new BufferedWriter(new FileWriter(new File(outDir, "verify-mismatches.txt")));
        progressWriter = new BufferedWriter(new FileWriter(new File(outDir, "verify-progress.txt")));

        List<Function> todo = new ArrayList<Function>();
        FunctionIterator fit = currentProgram.getFunctionManager().getFunctions(true);
        while (fit.hasNext()) {
            Function f = fit.next();
            if (f.isExternal() || f.getBody() == null || f.getBody().getNumAddresses() == 0) {
                continue;
            }
            todo.add(f);
        }
        total = todo.size();
        println("VerifyExport: " + total + " functions with bodies to verify");
        writeProgress();

        QCallback<Function, Rec> cb = new QCallback<Function, Rec>() {
            @Override
            public Rec process(Function f, TaskMonitor monitor) throws Exception {
                Rec rec = new Rec();
                rec.addr = f.getEntryPoint().toString();
                rec.name = f.getName();
                DecompInterface di = TL.get();
                if (!di.openProgram(currentProgram)) {
                    return rec;
                }
                DecompileResults res = di.decompileFunction(f, 45, monitor);
                if (res != null && res.decompileCompleted()) {
                    DecompiledFunction df = res.getDecompiledFunction();
                    if (df != null) {
                        rec.fresh = df.getC();
                    }
                }
                return rec;
            }
        };

        ParallelDecompiler.decompileFunctions(cb, currentProgram, todo.iterator(), new Consumer<Rec>() {
            @Override
            public void accept(Rec rec) {
                try {
                    judge(rec);
                }
                catch (Exception e) {
                    println("VerifyExport: write error " + e);
                }
            }
        }, monitor);

        synchronized (LOCK) {
            mismatchWriter.flush();
            mismatchWriter.close();
            writeProgressLocked();
            progressWriter.flush();
            progressWriter.close();
        }
        println("VerifyExport: done. ok=" + ok + " mismatch=" + bad + " fresh-failed=" + freshFailed);
    }

    /** Compare one function fresh decompilation against what the export holds for it. */
    private static void judge(Rec rec) throws Exception {
        synchronized (LOCK) {
            String mine = exported.get(rec.addr);
            if (rec.fresh == null) {
                freshFailed++;
            }
            else if (mine == null) {
                bad++;
                mismatchWriter.write(rec.addr + "\tabsent from export\t" + rec.name);
                mismatchWriter.newLine();
            }
            else if (!mine.equals(norm(rec.fresh))) {
                bad++;
                mismatchWriter.write(rec.addr + "\ttext differs\t" + rec.name
                    + "\texport=" + mine.length() + "B fresh=" + norm(rec.fresh).length() + "B");
                mismatchWriter.newLine();
            }
            else {
                ok++;
            }
            long done = ok + bad + freshFailed;
            if (done % 500 == 0) {
                mismatchWriter.flush();
                writeProgressLocked();
            }
        }
    }

    private static void writeProgress() {
        synchronized (LOCK) {
            writeProgressLocked();
        }
    }

    private static void writeProgressLocked() {
        try {
            progressWriter.write("total=" + total);
            progressWriter.newLine();
            progressWriter.write("ok=" + ok);
            progressWriter.newLine();
            progressWriter.write("mismatch=" + bad);
            progressWriter.newLine();
            progressWriter.write("fresh-failed=" + freshFailed);
            progressWriter.newLine();
            progressWriter.write("exported-records=" + exported.size());
            progressWriter.newLine();
            progressWriter.write("updated=" + new java.util.Date());
            progressWriter.newLine();
            progressWriter.flush();
        }
        catch (Exception e) {
            /* best effort */
        }
    }
}
