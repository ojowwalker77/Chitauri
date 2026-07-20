// FILE: terminalPerformance.ts
// Purpose: Lightweight opt-in measurements for terminal output parse latency.
// Layer: Terminal runtime diagnostics
// Exports: observeTerminalWriteParsed
// Depends on: Browser performance APIs and localStorage

interface TerminalWriteSample {
  runtimeKey: string;
  bytes: number;
  latencyMs: number;
  queuedAt: number;
  parsedAt: number;
}

declare global {
  interface Window {
    __chitauriTerminalPerf?: {
      samples: TerminalWriteSample[];
      reset: () => void;
    };
  }
}

const TERMINAL_PERF_STORAGE_KEY = "teacode:terminal-perf";
const MAX_TERMINAL_PERF_SAMPLES = 200;

// Resolved once. This gate is checked on every parsed write — roughly 60x/second
// per streaming terminal — and a synchronous localStorage read at that rate is a
// real main-thread cost for a debug flag that cannot change without a reload.
let terminalPerfEnabledCache: boolean | null = null;

function terminalPerfEnabled(): boolean {
  if (terminalPerfEnabledCache !== null) {
    return terminalPerfEnabledCache;
  }
  try {
    terminalPerfEnabledCache = window.localStorage.getItem(TERMINAL_PERF_STORAGE_KEY) === "1";
  } catch {
    terminalPerfEnabledCache = false;
  }
  return terminalPerfEnabledCache;
}

function getTerminalPerfStore() {
  window.__chitauriTerminalPerf ??= {
    samples: [],
    reset() {
      this.samples.length = 0;
    },
  };
  return window.__chitauriTerminalPerf;
}

// Records a write only after xterm reports that its parser consumed the data.
export function observeTerminalWriteParsed(input: {
  runtimeKey: string;
  bytes: number;
  queuedAt: number;
}): void {
  if (!terminalPerfEnabled()) return;

  const parsedAt = performance.now();
  const sample: TerminalWriteSample = {
    runtimeKey: input.runtimeKey,
    bytes: input.bytes,
    queuedAt: input.queuedAt,
    parsedAt,
    latencyMs: parsedAt - input.queuedAt,
  };
  const store = getTerminalPerfStore();
  store.samples.push(sample);
  if (store.samples.length > MAX_TERMINAL_PERF_SAMPLES) {
    store.samples.splice(0, store.samples.length - MAX_TERMINAL_PERF_SAMPLES);
  }
}
