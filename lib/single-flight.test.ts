import { describe, expect, it, vi } from "vitest";
import { createSingleFlight } from "./single-flight";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("createSingleFlight", () => {
  it("shares one job between callers that arrive while it is running", async () => {
    const run = createSingleFlight<number>();
    const job = deferred<number>();
    const start = vi.fn(() => job.promise);
    const a = run("k", start);
    const b = run("k", start);
    expect(start).toHaveBeenCalledTimes(1);
    job.resolve(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
  });

  it("starts a new job once the previous one has finished", async () => {
    const run = createSingleFlight<number>();
    const start = vi.fn(async () => 1);
    await run("k", start);
    await run("k", start);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("does not hand a result built for one key to a caller with another key", async () => {
    const run = createSingleFlight<string>();
    const first = deferred<string>();
    const a = run("one", () => first.promise);
    const b = run("two", async () => "second");
    expect(await b).toBe("second");
    first.resolve("first");
    expect(await a).toBe("first");
  });

  it("shares a failure with everyone waiting, then allows a fresh attempt", async () => {
    const run = createSingleFlight<number>();
    const job = deferred<number>();
    const start = vi.fn(() => job.promise);
    const a = run("k", start);
    const b = run("k", start);
    job.reject(new Error("boom"));
    await expect(a).rejects.toThrow("boom");
    await expect(b).rejects.toThrow("boom");
    expect(start).toHaveBeenCalledTimes(1);
    expect(await run("k", async () => 5)).toBe(5);
  });
});
