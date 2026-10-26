import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafeMock = vi.fn();
const executeRawUnsafeMock = vi.fn();
const queryRawMock = vi.fn();
const executeRawMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRawUnsafe: queryRawUnsafeMock,
    $executeRawUnsafe: executeRawUnsafeMock,
    $queryRaw: queryRawMock,
    $executeRaw: executeRawMock,
  },
}));

const BUCKET_START = "2026-10-24T00:00:00.000Z";
const BUCKET_END = "2026-10-25T00:00:00.000Z";

async function loadEditor() {
  return import("@/lib/admin-traffic-editor");
}

describe("applyTrafficEdit", () => {
  beforeEach(() => {
    vi.resetModules();
    queryRawUnsafeMock.mockReset();
    executeRawUnsafeMock.mockReset();
    queryRawMock.mockReset();
    executeRawMock.mockReset();
    executeRawUnsafeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reduces page views by excluding rows in the edited bucket", async () => {
    queryRawUnsafeMock
      .mockResolvedValueOnce([{ c: 100 }])
      .mockResolvedValueOnce([{ c: 80 }]);

    const { applyTrafficEdit } = await loadEditor();
    const result = await applyTrafficEdit({
      granularity: "daily",
      series: "pageViews",
      bucketStart: BUCKET_START,
      bucketEnd: BUCKET_END,
      targetValue: 80,
    });

    expect(result).toEqual({ ok: true, value: 80 });
    expect(executeRawUnsafeMock).toHaveBeenCalledTimes(1);

    const updateSql = String(executeRawUnsafeMock.mock.calls[0][0]);
    expect(updateSql).toContain("manually_excluded = 1");
    expect(updateSql).toContain("event_type = 'page_view'");
    expect(updateSql).toContain("LIMIT 20");
  });

  it("increases page views by un-excluding rows in the edited bucket", async () => {
    queryRawUnsafeMock
      .mockResolvedValueOnce([{ c: 80 }])
      .mockResolvedValueOnce([{ c: 100 }]);

    const { applyTrafficEdit } = await loadEditor();
    const result = await applyTrafficEdit({
      granularity: "daily",
      series: "pageViews",
      bucketStart: BUCKET_START,
      bucketEnd: BUCKET_END,
      targetValue: 100,
    });

    expect(result).toEqual({ ok: true, value: 100 });

    const updateSql = String(executeRawUnsafeMock.mock.calls[0][0]);
    expect(updateSql).toContain("manually_excluded = 0");
    expect(updateSql).toContain("LIMIT 20");
  });

  it("is a no-op when the target already matches the current value", async () => {
    queryRawUnsafeMock.mockResolvedValueOnce([{ c: 42 }]);

    const { applyTrafficEdit } = await loadEditor();
    const result = await applyTrafficEdit({
      granularity: "daily",
      series: "pageViews",
      bucketStart: BUCKET_START,
      bucketEnd: BUCKET_END,
      targetValue: 42,
    });

    expect(result).toEqual({ ok: true, value: 42 });
    expect(executeRawUnsafeMock).not.toHaveBeenCalled();
  });

  it("scopes the newVisitors read predicate to the ev derived-table alias", async () => {
    queryRawUnsafeMock
      .mockResolvedValueOnce([{ c: 12 }])
      .mockResolvedValueOnce([{ c: 10 }]);

    const { applyTrafficEdit } = await loadEditor();
    await applyTrafficEdit({
      granularity: "daily",
      series: "newVisitors",
      bucketStart: BUCKET_START,
      bucketEnd: BUCKET_END,
      targetValue: 10,
    });

    // The first $queryRawUnsafe call is the current-value read. The outer
    // WHERE must reference ev.first_day — referencing fs.first_day there is
    // invalid SQL (fs is out of scope) and previously made this read silently
    // return 0.
    const readSql = String(queryRawUnsafeMock.mock.calls[0][0]);
    expect(readSql).toMatch(/WHERE\s+ev\.first_day = '2026-10-24'/);
    expect(readSql).not.toMatch(/WHERE\s+fs\.first_day/);

    const updateSql = String(executeRawUnsafeMock.mock.calls[0][0]);
    expect(updateSql).toContain("fs.first_day = '2026-10-24'");
    expect(updateSql).toContain("LIMIT 2");
  });

  it("scopes the returnVisits read predicate to the ev derived-table alias", async () => {
    queryRawUnsafeMock
      .mockResolvedValueOnce([{ c: 9 }])
      .mockResolvedValueOnce([{ c: 7 }]);

    const { applyTrafficEdit } = await loadEditor();
    await applyTrafficEdit({
      granularity: "weekly",
      series: "returnVisits",
      bucketStart: "2026-10-19T00:00:00.000Z",
      bucketEnd: "2026-10-26T00:00:00.000Z",
      targetValue: 7,
    });

    const readSql = String(queryRawUnsafeMock.mock.calls[0][0]);
    expect(readSql).toMatch(/WHERE\s+ev\.first_day < '2026-10-19'/);
    expect(readSql).not.toMatch(/WHERE\s+fs\.first_day/);
  });

  it("propagates database read errors instead of silently returning 0", async () => {
    queryRawUnsafeMock.mockRejectedValueOnce(new Error("db connection refused"));

    const { applyTrafficEdit } = await loadEditor();
    await expect(
      applyTrafficEdit({
        granularity: "daily",
        series: "pageViews",
        bucketStart: BUCKET_START,
        bucketEnd: BUCKET_END,
        targetValue: 10,
      }),
    ).rejects.toThrow("db connection refused");
  });
});
