import { expect, test } from "bun:test";
import { collectRows, type ToolRunner } from "../src/cbm.ts";

const page = (ids: string[]) => ({
  columns: ["id"], rows: ids.map((id) => [id]), total_relation: "eq",
  has_more: false, truncated: false,
});

test("reads every query batch, including the last short batch", async () => {
  const queries: string[] = [];
  const run: ToolRunner = async (_tool, args) => {
    queries.push(String(args.query));
    return page(queries.length === 1 ? ["1", "2"] : ["3"]);
  };
  expect(await collectRows(run, "demo", "MATCH (n) RETURN id(n) AS id", 2))
    .toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
  expect(queries[1]).toEndWith("ORDER BY id SKIP 2 LIMIT 2");
});

test("drains a response cursor before advancing the query batch", async () => {
  const calls: Record<string, unknown>[] = [];
  const run: ToolRunner = async (_tool, args) => {
    calls.push(args);
    if (calls.length === 1) return {
      ...page(["1"]), has_more: true, truncated: true, next_cursor: "next",
    };
    if (calls.length === 2) return page(["2"]);
    return page([]);
  };
  expect(await collectRows(run, "demo", "MATCH (n) RETURN id(n) AS id", 2))
    .toEqual([{ id: "1" }, { id: "2" }]);
  expect(calls[1]?.cursor).toBe("next");
  expect(calls[1]?.query).toBe(calls[0]?.query);
  expect(calls[2]?.query).toEndWith("SKIP 2 LIMIT 2");
});

test("refuses evaluation limits and unrecoverable output truncation", async () => {
  for (const response of [
    { ...page(["1"]), total_relation: "gte" },
    { ...page(["1"]), has_more: true, truncated: true },
    { ...page(["1"]), warning: "engine row limit" },
  ]) {
    await expect(collectRows(async () => response, "demo", "MATCH (n) RETURN n", 2))
      .rejects.toThrow();
  }
});

test("refuses a non-advancing cursor", async () => {
  await expect(collectRows(async () => ({
    ...page(["1"]), has_more: true, truncated: true, next_cursor: "same",
  }), "demo", "MATCH (n) RETURN n", 2)).rejects.toThrow("advancing cursor");
});
