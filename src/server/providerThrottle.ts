export class ProviderThrottleError extends Error {}

type ProviderSlot = { tail: Promise<void>; lastStarted: number; blockedUntil: number };

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new ProviderThrottleError("Presupuesto de comprobación agotado."));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new ProviderThrottleError("Presupuesto de comprobación agotado."));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return abortable(Promise.resolve(), signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = new Promise<void>((resolve) => { timer = setTimeout(resolve, milliseconds); });
  return abortable(work, signal).finally(() => { if (timer) clearTimeout(timer); });
}

/** Instance-local scheduling: no persistent identifiers or private application data. */
export function createProviderThrottle(options: { now?: () => number; signal?: AbortSignal } = {}) {
  const now = options.now ?? Date.now;
  const slots = new Map<string, ProviderSlot>();
  const slotFor = (origin: string) => {
    let slot = slots.get(origin);
    if (!slot) { slot = { tail: Promise.resolve(), lastStarted: -Infinity, blockedUntil: 0 }; slots.set(origin, slot); }
    return slot;
  };
  const checkAvailable = (slot: ProviderSlot) => {
    if (options.signal?.aborted) throw new ProviderThrottleError("Presupuesto de comprobación agotado.");
    if (slot.blockedUntil > now()) throw new ProviderThrottleError(`HTTP 429: fuente en pausa; reintento en ${Math.ceil((slot.blockedUntil - now()) / 1000)} s.`);
  };
  return {
    rateLimited(origin: string, retryAfter: string | null): void {
      const at = now();
      const value = retryAfter?.trim() ?? "";
      const httpDate = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value);
      const proposed = /^\d+$/.test(value) ? at + Number(value) * 1000 : httpDate ? Date.parse(value) : NaN;
      // Even Retry-After: 0 must not cause an immediate retry storm.
      const until = Number.isFinite(proposed) ? Math.max(at + 1000, proposed) : at + 60_000;
      const slot = slotFor(origin);
      slot.blockedUntil = Math.max(slot.blockedUntil, until);
    },
    async run<T>(origin: string, intervalMs: number, work: () => Promise<T>): Promise<T> {
      const slot = slotFor(origin);
      const previous = slot.tail;
      let release!: () => void;
      slot.tail = new Promise<void>((resolve) => { release = resolve; });
      try {
        await abortable(previous, options.signal);
        checkAvailable(slot);
        await pause(Math.max(0, slot.lastStarted + intervalMs - now()), options.signal);
        checkAvailable(slot);
        slot.lastStarted = now();
        return await work();
      } finally { release(); }
    },
  };
}
