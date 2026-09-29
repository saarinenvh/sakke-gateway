import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";
import { connectDatabase } from "./database.js";

const RETRY_DELAY_MS = 1_000;

// Constructing a DataSource opens no connection; initialize() is what the
// test controls.
function unconnectedDataSource(): DataSource {
  return new DataSource({ type: "mariadb", host: "unused" });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("connectDatabase", () => {
  it("keeps retrying until the database answers, then resolves with it", async () => {
    const dataSource = unconnectedDataSource();
    const initialize = vi.spyOn(dataSource, "initialize")
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce(dataSource);

    const connected = connectDatabase(dataSource, RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(2 * RETRY_DELAY_MS);

    await expect(connected).resolves.toBe(dataSource);
    expect(initialize).toHaveBeenCalledTimes(3);
  });

  it("waits the retry delay between attempts", async () => {
    const dataSource = unconnectedDataSource();
    const initialize = vi.spyOn(dataSource, "initialize").mockRejectedValue(new Error("connect ECONNREFUSED"));

    void connectDatabase(dataSource, RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1);
    expect(initialize).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(initialize).toHaveBeenCalledTimes(2);
  });
});
