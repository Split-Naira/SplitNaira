/**
 * Cursor pagination for high-volume transaction endpoints (#1259).
 *
 * The database is replaced with a recording query-builder fake so the tests
 * assert the SQL the service would issue: stable `(timestamp DESC, id DESC)`
 * ordering, a keyset predicate instead of an unbounded offset, a `limit + 1`
 * probe for `hasMore`, and a count that ignores the cursor.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  interface BuilderConfig {
    rows: unknown[];
    count: number;
  }

  class FakeQueryBuilder {
    conditions: Array<{ sql: string; params: unknown }> = [];
    orders: Array<[string, string]> = [];
    skipValue: number | undefined;
    takeValue: number | undefined;

    constructor(private readonly config: BuilderConfig) {}

    andWhere(sql: string, params: unknown): this {
      this.conditions.push({ sql, params });
      return this;
    }

    orderBy(column: string, direction: string): this {
      this.orders.push([column, direction]);
      return this;
    }

    addOrderBy(column: string, direction: string): this {
      this.orders.push([column, direction]);
      return this;
    }

    skip(value: number): this {
      this.skipValue = value;
      return this;
    }

    take(value: number): this {
      this.takeValue = value;
      return this;
    }

    async getCount(): Promise<number> {
      return this.config.count;
    }

    async getMany(): Promise<unknown[]> {
      return this.config.rows;
    }

    async getManyAndCount(): Promise<[unknown[], number]> {
      return [this.config.rows, this.config.count];
    }
  }

  return {
    configs: [] as BuilderConfig[],
    builders: [] as FakeQueryBuilder[],
    FakeQueryBuilder,
  };
});

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      createQueryBuilder: () => {
        const config = h.configs.shift();
        if (!config) throw new Error("Query builder used without a configured result");
        const builder = new h.FakeQueryBuilder(config);
        h.builders.push(builder);
        return builder;
      },
    }),
  }),
  initDatabase: async () => {},
  closeDatabase: async () => {},
}));

vi.mock("../services/session-revocation.js", () => ({
  getSessionVersion: vi.fn(async () => 0),
  getMaxSessionVersionForEmail: vi.fn(async () => 0),
  revokeSessionsForEmail: vi.fn(async () => 1),
}));

import { transactionsRouter } from "../routes/transactions.js";
import { createPayoutHistoryService } from "../services/PayoutHistoryService.js";
import { errorHandler, notFoundHandler } from "../middleware/error.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { encodeTransactionCursor } from "../lib/keyset-cursor.js";
import { signToken } from "../services/jwt.js";

const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER_WALLET = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

function payout(id: string, timestamp: number) {
  return {
    id,
    roundId: "round-1",
    recipient: WALLET,
    amount: "1000",
    token: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    timestamp,
    txHash: id.replace(/-/g, ""),
    status: "completed" as const,
  };
}

const ROW_A = payout(ID_A, 300);
const ROW_B = payout(ID_B, 200);
const ROW_C = payout(ID_C, 100);

function enqueue(rows: unknown[], count = rows.length): void {
  h.configs.push({ rows, count });
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use("/transactions", transactionsRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  h.configs.length = 0;
  h.builders.length = 0;
});

describe("GET /transactions/history cursor pagination", () => {
  it("returns a page with stable ordering and a nextCursor when more rows exist", async () => {
    // count query, then page query (limit + 1 rows fetched to detect more)
    enqueue([], 5);
    enqueue([ROW_A, ROW_B, ROW_C]);

    const res = await request(createApp()).get("/transactions/history?limit=2").expect(200);

    expect(res.body.total).toBe(5);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(0);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.transactions.map((t: { id: string }) => t.id)).toEqual([ID_A, ID_B]);
    expect(res.body.nextCursor).toBe(
      encodeTransactionCursor({ timestamp: ROW_B.timestamp, id: ROW_B.id })
    );

    const [countBuilder, pageBuilder] = h.builders;
    expect(countBuilder.conditions).toHaveLength(0);
    expect(pageBuilder.conditions).toHaveLength(0);
    expect(pageBuilder.orders).toEqual([
      ["transaction.timestamp", "DESC"],
      ["transaction.id", "DESC"],
    ]);
    expect(pageBuilder.takeValue).toBe(3);
    expect(pageBuilder.skipValue).toBeUndefined();
  });

  it("continues after the cursor with a keyset predicate, ignoring offset", async () => {
    enqueue([], 5);
    enqueue([ROW_C]);

    const cursor = encodeTransactionCursor({ timestamp: ROW_B.timestamp, id: ROW_B.id });
    const res = await request(createApp())
      .get(`/transactions/history?cursor=${encodeURIComponent(cursor)}&offset=99`)
      .expect(200);

    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.transactions).toHaveLength(1);

    const [, pageBuilder] = h.builders;
    expect(pageBuilder.conditions).toHaveLength(1);
    expect(pageBuilder.conditions[0].sql).toContain("transaction.timestamp < :cursorTimestamp");
    expect(pageBuilder.conditions[0].params).toEqual({
      cursorTimestamp: ROW_B.timestamp,
      cursorId: ROW_B.id,
    });
    expect(pageBuilder.skipValue).toBeUndefined();
  });

  it("counts the whole filtered set, not only the rows after the cursor", async () => {
    enqueue([], 42);
    enqueue([ROW_C]);

    const cursor = encodeTransactionCursor({ timestamp: ROW_B.timestamp, id: ROW_B.id });
    const res = await request(createApp())
      .get(`/transactions/history?cursor=${encodeURIComponent(cursor)}`)
      .expect(200);

    expect(res.body.total).toBe(42);
  });

  it("falls back to offset pagination when no cursor is supplied", async () => {
    enqueue([], 100);
    enqueue([ROW_B]);

    const res = await request(createApp())
      .get("/transactions/history?limit=5&offset=10")
      .expect(200);

    expect(res.body.offset).toBe(10);
    const [, pageBuilder] = h.builders;
    expect(pageBuilder.skipValue).toBe(10);
    expect(pageBuilder.takeValue).toBe(6);
    expect(pageBuilder.conditions).toHaveLength(0);
  });

  it("applies wallet, status and date filters to both queries", async () => {
    enqueue([], 1);
    enqueue([ROW_A]);

    await request(createApp())
      .get(
        `/transactions/history?walletAddress=${WALLET}&status=completed&startDate=1&endDate=9999999999`
      )
      .expect(200);

    const [countBuilder, pageBuilder] = h.builders;
    expect(countBuilder.conditions).toHaveLength(4);
    expect(pageBuilder.conditions).toHaveLength(4);
  });

  it("rejects a malformed cursor with 400 and never touches the database", async () => {
    const res = await request(createApp())
      .get("/transactions/history?cursor=not-a-valid-cursor!!")
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details).toEqual({ cursor: "invalid" });
    expect(h.builders).toHaveLength(0);
  });

  it("rejects a page size above the 100-row ceiling", async () => {
    const res = await request(createApp()).get("/transactions/history?limit=101").expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(h.builders).toHaveLength(0);
  });

  it("allows the maximum page size of 100", async () => {
    enqueue([], 0);
    enqueue([]);

    const res = await request(createApp()).get("/transactions/history?limit=100").expect(200);

    expect(res.body.limit).toBe(100);
    const [, pageBuilder] = h.builders;
    expect(pageBuilder.takeValue).toBe(101);
  });
});

describe("GET /transactions/recipient/:walletAddress cursor pagination", () => {
  it("scopes the page to the recipient and returns pagination metadata", async () => {
    enqueue([], 3);
    enqueue([ROW_A, ROW_B]);

    const res = await request(createApp())
      .get(`/transactions/recipient/${WALLET}?limit=1`)
      .expect(200);

    expect(res.body.walletAddress).toBe(WALLET);
    expect(res.body.total).toBe(3);
    expect(res.body.transactions.map((t: { id: string }) => t.id)).toEqual([ID_A]);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextCursor).toBe(
      encodeTransactionCursor({ timestamp: ROW_A.timestamp, id: ROW_A.id })
    );

    const [countBuilder, pageBuilder] = h.builders;
    expect(countBuilder.conditions[0].params).toEqual({ recipient: WALLET });
    expect(pageBuilder.conditions[0].params).toEqual({ recipient: WALLET });
  });

  it("rejects an invalid cursor on the recipient endpoint", async () => {
    const res = await request(createApp())
      .get(`/transactions/recipient/${WALLET}?cursor=%%%`)
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(h.builders).toHaveLength(0);
  });

  it("rejects an invalid wallet address before querying", async () => {
    const res = await request(createApp())
      .get(`/transactions/recipient/${OTHER_WALLET.slice(0, 3)}`)
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(h.builders).toHaveLength(0);
  });
});

describe("GET /transactions/export cursor pagination", () => {
  it("scopes the page to the authenticated user from bearer token and returns pagination metadata", async () => {
    enqueue([], 5);
    enqueue([ROW_A, ROW_B, ROW_C]);

    const token = signToken(WALLET);
    const res = await request(createApp())
      .get("/transactions/export?format=json&limit=2")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.total).toBe(5);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(0);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.transactions.map((t: { id: string }) => t.id)).toEqual([ID_A, ID_B]);
    expect(res.body.nextCursor).toBe(
      encodeTransactionCursor({ timestamp: ROW_B.timestamp, id: ROW_B.id })
    );

    const [countBuilder, pageBuilder] = h.builders;
    expect(countBuilder.conditions[0].params).toEqual({ recipient: WALLET });
    expect(pageBuilder.conditions[0].params).toEqual({ recipient: WALLET });
    expect(pageBuilder.orders).toEqual([
      ["transaction.timestamp", "DESC"],
      ["transaction.id", "DESC"],
    ]);
    expect(pageBuilder.takeValue).toBe(3);
    expect(pageBuilder.skipValue).toBeUndefined();
  });

  it("continues after the cursor with a keyset predicate, ignoring offset and client wallet param", async () => {
    enqueue([], 5);
    enqueue([ROW_C]);

    const token = signToken(WALLET);
    const cursor = encodeTransactionCursor({ timestamp: ROW_B.timestamp, id: ROW_B.id });
    const res = await request(createApp())
      .get(
        `/transactions/export?format=json&cursor=${encodeURIComponent(cursor)}&offset=99&walletAddress=${OTHER_WALLET}`
      )
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.transactions).toHaveLength(1);

    const [countBuilder, pageBuilder] = h.builders;
    expect(countBuilder.conditions[0].params).toEqual({ recipient: WALLET });
    expect(pageBuilder.conditions[0].params).toEqual({ recipient: WALLET });
    expect(pageBuilder.conditions[1].sql).toContain("transaction.timestamp < :cursorTimestamp");
    expect(pageBuilder.conditions[1].params).toEqual({
      cursorTimestamp: ROW_B.timestamp,
      cursorId: ROW_B.id,
    });
    expect(pageBuilder.skipValue).toBeUndefined();
  });

  it("applies status and date filters alongside account scope", async () => {
    enqueue([], 1);
    enqueue([ROW_A]);

    const token = signToken(WALLET);
    await request(createApp())
      .get("/transactions/export?format=json&status=completed&startDate=1&endDate=9999999999")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const [countBuilder, pageBuilder] = h.builders;
    expect(countBuilder.conditions).toHaveLength(4);
    expect(pageBuilder.conditions).toHaveLength(4);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(createApp()).get("/transactions/export?format=json").expect(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
    expect(h.builders).toHaveLength(0);
  });

  it("rejects a malformed cursor with 400 and does not query the database", async () => {
    const token = signToken(WALLET);
    const res = await request(createApp())
      .get("/transactions/export?format=json&cursor=bad-cursor!!!")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details).toEqual({ cursor: "invalid" });
    expect(h.builders).toHaveLength(0);
  });

  it("rejects page size above 100 with 400", async () => {
    const token = signToken(WALLET);
    const res = await request(createApp())
      .get("/transactions/export?format=json&limit=101")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(h.builders).toHaveLength(0);
  });

  it("allows maximum page size of 100", async () => {
    enqueue([], 0);
    enqueue([]);

    const token = signToken(WALLET);
    const res = await request(createApp())
      .get("/transactions/export?format=json&limit=100")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.limit).toBe(100);
    const [, pageBuilder] = h.builders;
    expect(pageBuilder.takeValue).toBe(101);
  });
});

describe("PayoutHistoryService.getPayoutsWithCount", () => {
  it("honours limit and offset and uses the same stable order", async () => {
    enqueue([ROW_B], 7);

    const result = await createPayoutHistoryService().getPayoutsWithCount({ limit: 5, offset: 10 });

    expect(result.total).toBe(7);
    const [builder] = h.builders;
    expect(builder.skipValue).toBe(10);
    expect(builder.takeValue).toBe(5);
    expect(builder.orders).toEqual([
      ["transaction.timestamp", "DESC"],
      ["transaction.id", "DESC"],
    ]);
  });
});
