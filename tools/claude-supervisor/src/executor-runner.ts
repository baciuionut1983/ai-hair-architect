// Real-I/O glue that turns a spawned executor child process into a
// single ExecutorOutcome -- the ONE place that reads `stdout`/`stderr`
// off a real ChildProcess and feeds it through stream-events.ts's own
// pure parsing/reduction. Kept deliberately small and dependency-light:
// it accepts anything shaped like an EventEmitter with `stdout`/`stderr`
// readables (real ChildProcessByStdio<null, Readable, Readable> from
// claude-cli.ts's spawnExecutor satisfies this structurally), so tests
// exercise the REAL buffering/parsing logic against a fake in-process
// EventEmitter double instead of a real OS process -- the same "pure
// logic, thin untested-by-necessity OS glue" split this package already
// documents for claude-cli.ts itself, except the actual line-buffering
// and reduction here ARE fully testable without a real spawn.
import type { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

import { combineExecutorResult, parseStreamJsonLine, type ExecutorOutcome, type ParsedStreamEvent } from "./stream-events.js";

export interface ObservableExecutorProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
}

// stdout arrives in arbitrary chunk boundaries (a real OS pipe never
// guarantees one write == one line) -- this buffers until a newline
// before ever handing a line to parseStreamJsonLine, and flushes any
// trailing partial line once the process closes (the real live smoke
// test's own final line had no trailing newline).
export function observeExecutorProcess(child: ObservableExecutorProcess): Promise<ExecutorOutcome> {
  return new Promise((resolveOutcome) => {
    const events: ParsedStreamEvent[] = [];
    let stdoutBuffer = "";
    let stderrText = "";

    const pushLine = (line: string): void => {
      const parsed = parseStreamJsonLine(line);
      if (parsed !== null) events.push(parsed);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        pushLine(stdoutBuffer.slice(0, newlineIndex));
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrText += chunk.toString();
    });

    child.on("close", (exitCode: number | null) => {
      if (stdoutBuffer.length > 0) pushLine(stdoutBuffer);
      resolveOutcome(combineExecutorResult(events, { exitCode, stderrText }));
    });
  });
}
