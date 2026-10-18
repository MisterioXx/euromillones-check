import test from "node:test";
import assert from "node:assert/strict";
import { createProviderThrottle } from "../src/server/providerThrottle.js";

test("requests to the same origin are serialised and their starts are spaced", async () => {
  const throttle = createProviderThrottle();
  const starts: number[] = [];
  let active = 0;
  const work = async () => {
    assert.equal(active++, 0);
    starts.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
  };
  await Promise.all([throttle.run("one", 35, work), throttle.run("one", 35, work), throttle.run("one", 35, work)]);
  assert.ok(starts[1] - starts[0] >= 34);
  assert.ok(starts[2] - starts[1] >= 34);
});

test("Retry-After seconds suppress requests until expiry and do not block another origin", async () => {
  let clock = 100_000; let calls = 0;
  const throttle = createProviderThrottle({ now: () => clock });
  throttle.rateLimited("one", "120");
  const work = async () => { calls++; };
  await assert.rejects(throttle.run("one", 0, work), /120 s/);
  await throttle.run("two", 0, work);
  clock += 119_999;
  await assert.rejects(throttle.run("one", 0, work), /1 s/);
  assert.equal(calls, 1);
  clock++;
  await throttle.run("one", 0, work);
  assert.equal(calls, 2);
});

test("Retry-After HTTP dates and the default 60-second cooldown are respected", async () => {
  let clock = Date.parse("2026-10-18T12:00:00Z");
  const throttle = createProviderThrottle({ now: () => clock });
  throttle.rateLimited("dated", "Sun, 18 Oct 2026 12:02:00 GMT");
  throttle.rateLimited("missing", null);
  throttle.rateLimited("invalid", "not a date");
  throttle.rateLimited("negative", "-1");
  await assert.rejects(throttle.run("dated", 0, async () => {}), /120 s/);
  await assert.rejects(throttle.run("missing", 0, async () => {}), /60 s/);
  await assert.rejects(throttle.run("invalid", 0, async () => {}), /60 s/);
  await assert.rejects(throttle.run("negative", 0, async () => {}), /60 s/);
  clock += 60_000;
  await throttle.run("missing", 0, async () => {});
  await assert.rejects(throttle.run("dated", 0, async () => {}), /60 s/);
});

test("a queued request observes a rate limit received by the request ahead of it", async () => {
  const throttle = createProviderThrottle(); let calls = 0;
  const first = throttle.run("one", 0, async () => {
    calls++;
    await Promise.resolve();
    throttle.rateLimited("one", "30");
  });
  const second = throttle.run("one", 0, async () => { calls++; });
  await first;
  await assert.rejects(second, /HTTP 429/);
  assert.equal(calls, 1);
});

test("the cron signal cancels a spacing delay without starting its request", async () => {
  const controller = new AbortController();
  const throttle = createProviderThrottle({ signal: controller.signal });
  let calls = 0;
  await throttle.run("one", 0, async () => { calls++; });
  const waiting = throttle.run("one", 60_000, async () => { calls++; });
  const rejection = assert.rejects(waiting, /Presupuesto/);
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await rejection;
  assert.equal(calls, 1);
});

test("an aborted queue does not wait for a previous request to finish", async () => {
  const controller = new AbortController();
  const throttle = createProviderThrottle({ signal: controller.signal });
  let finish!: () => void;
  const first = throttle.run("one", 0, () => new Promise<void>((resolve) => { finish = resolve; }));
  await new Promise((resolve) => setTimeout(resolve, 1));
  const queued = throttle.run("one", 0, async () => { assert.fail("must not start"); });
  const rejection = assert.rejects(queued, /Presupuesto/);
  controller.abort();
  await rejection;
  finish(); await first;
});
