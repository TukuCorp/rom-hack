// Decompile every function in the current program with Ghidra's decompiler.
//
// Headless usage:
//   analyzeHeadless <projDir> <projName> -process <file> -noanalysis +//     -scriptPath <thisDir> -postScript DecompileAll.java <outDir> [chunkSize] [timeoutSec]
//
// Resumable: completed function entry addresses are appended to <outDir>\done.txt,
// and any address already listed there is skipped on the next run.
// Progress:   <outDir>\progress.txt is rewritten after every finished function.
// Output:     <outDir>\chunk-00000.c, chunk-00001.c, ... (records are delimited)

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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;

public class DecompileAll extends GhidraScript {

    /** One decompiled function, self-describing so parallel results need no ordering. */
    private static class Rec {
        String addr;
        String name;
        String sig;
        String code;
        boolean failed;
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

    private static File outDir;
    private static int chunkSize = 500;
    private static int timeout = 60;
    private static int chunkIndex = 0;
    private static int inChunk = 0;
    private static long okCount = 0;
    private static long failCount = 0;
    private static long total = 0;
    private static BufferedWriter chunkWriter;
    private static BufferedWriter doneWriter;
    private static volatile String consumerError = null;

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 1) {
            println("usage: DecompileAll <outDir> [chunkSize] [timeoutSec]");
            return;
        }
        outDir = new File(args[0]);
        if (!outDir.isDirectory() && !outDir.mkdirs()) {
            println("cannot create output dir: " + outDir);
            return;
        }
        if (args.length > 1) {
            chunkSize = Integer.parseInt(args[1]);
        }
        if (args.length > 2) {
            timeout = Integer.parseInt(args[2]);
        }

        Set<String> done = new HashSet<String>();
        File doneFile = new File(outDir, "done.txt");
        if (doneFile.isFile()) {
            BufferedReader r = new BufferedReader(new FileReader(doneFile));
            String line;
            while ((line = r.readLine()) != null) {
                line = line.trim();
                if (!line.isEmpty()) {
                    done.add(line);
                }
            }
            r.close();
        }
        println("DecompileAll: resuming with " + done.size() + " already-completed functions");
        doneWriter = new BufferedWriter(new FileWriter(doneFile, true));

        // Resume chunk numbering after any chunks already present, so a rerun into
        // an existing output directory cannot overwrite an earlier pass's records.
        int maxSeen = -1;
        File[] existing = outDir.listFiles();
        if (existing != null) {
            for (File f : existing) {
                String n = f.getName();
                if (n.startsWith("chunk-") && n.endsWith(".c")) {
                    try {
                        int idx = Integer.parseInt(n.substring(6, n.length() - 2));
                        if (idx > maxSeen) {
                            maxSeen = idx;
                        }
                    }
                    catch (NumberFormatException ignored) {
                        /* a chunk name we do not understand is left alone */
                    }
                }
            }
        }
        chunkIndex = maxSeen + 1;
        println("DecompileAll: starting at chunk index " + chunkIndex);
        openChunk();

        List<Function> todo = new ArrayList<Function>();
        long skipped = 0;
        FunctionIterator fit = currentProgram.getFunctionManager().getFunctions(true);
        while (fit.hasNext()) {
            Function f = fit.next();
            if (f.isExternal() || f.getBody() == null || f.getBody().getNumAddresses() == 0) {
                skipped++;
                continue;
            }
            if (done.contains(f.getEntryPoint().toString())) {
                continue;
            }
            todo.add(f);
        }
        total = todo.size();
        println("DecompileAll: queued " + total + " functions (skipped " + skipped
            + " external/bodyless/" + done.size() + " already-done)");
        writeProgress();

        QCallback<Function, Rec> cb = new QCallback<Function, Rec>() {
            @Override
            public Rec process(Function f, TaskMonitor monitor) throws Exception {
                Rec rec = new Rec();
                rec.addr = f.getEntryPoint().toString();
                rec.name = f.getName();
                rec.sig = f.getPrototypeString(false, false);
                DecompInterface di = TL.get();
                if (!di.openProgram(currentProgram)) {
                    rec.failed = true;
                    return rec;
                }
                DecompileResults res = di.decompileFunction(f, timeout, monitor);
                if (res == null || !res.decompileCompleted()) {
                    rec.failed = true;
                    return rec;
                }
                DecompiledFunction df = res.getDecompiledFunction();
                if (df == null) {
                    rec.failed = true;
                    return rec;
                }
                rec.code = df.getC();
                return rec;
            }
        };

        ParallelDecompiler.decompileFunctions(cb, currentProgram, todo.iterator(), new Consumer<Rec>() {
            @Override
            public void accept(Rec rec) {
                try {
                    emit(rec);
                }
                catch (Exception e) {
                    consumerError = e.toString();
                }
            }
        }, monitor);

        flushChunk();
        synchronized (LOCK) {
            doneWriter.flush();
            doneWriter.close();
        }
        writeProgress();
        if (consumerError != null) {
            println("DecompileAll: WRITE ERROR: " + consumerError);
        }
        println("DecompileAll: finished. ok=" + okCount + " failed=" + failCount
            + " chunks=" + (chunkIndex + 1) + " outDir=" + outDir);
    }

    private static void emit(Rec rec) throws Exception {
        synchronized (LOCK) {
            if (rec.failed || rec.code == null) {
                failCount++;
            }
            else {
                if (inChunk >= chunkSize) {
                    flushChunk();
                    openChunk();
                }
                chunkWriter.write("/* ===== " + rec.addr + "  " + rec.name + " ===== */");
                chunkWriter.newLine();
                chunkWriter.write("/* " + rec.sig + " */");
                chunkWriter.newLine();
                chunkWriter.write(rec.code);
                chunkWriter.newLine();
                chunkWriter.write("/* ===== end " + rec.addr + " ===== */");
                chunkWriter.newLine();
                chunkWriter.newLine();
                inChunk++;
                okCount++;
            }
            doneWriter.write(rec.addr);
            doneWriter.newLine();
            if ((okCount + failCount) % 200 == 0) {
                doneWriter.flush();
                chunkWriter.flush();
                writeProgressLocked();
            }
        }
    }

    private static void openChunk() {
        try {
            chunkWriter = new BufferedWriter(new FileWriter(
                new File(outDir, String.format("chunk-%05d.c", chunkIndex))));
            inChunk = 0;
        }
        catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static void flushChunk() {
        try {
            if (chunkWriter != null) {
                chunkWriter.flush();
                chunkWriter.close();
            }
            chunkIndex++;
            inChunk = 0;
        }
        catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private static void writeProgress() {
        synchronized (LOCK) {
            writeProgressLocked();
        }
    }

    private static void writeProgressLocked() {
        try {
            BufferedWriter w = new BufferedWriter(
                new FileWriter(new File(outDir, "progress.txt"), false));
            w.write("total=" + total);
            w.newLine();
            w.write("ok=" + okCount);
            w.newLine();
            w.write("failed=" + failCount);
            w.newLine();
            w.write("chunks=" + chunkIndex);
            w.newLine();
            w.write("updated=" + new java.util.Date());
            w.newLine();
            w.close();
        }
        catch (Exception e) {
            /* progress is best-effort */
        }
    }
}
