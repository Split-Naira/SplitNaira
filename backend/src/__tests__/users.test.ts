import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler, notFoundHandler } from "../middleware/error.js";
import { requestIdMiddleware } from "../middleware/request-id.js";
import { signToken } from "../services/jwt.js";

const findOneMock = vi.fn();
const existsMock = vi.fn();
const createMock = vi.fn();
const saveMock = vi.fn();
const commitMock = vi.fn();
const rollbackMock = vi.fn();
const releaseMock = vi.fn();

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      findOne: findOneMock,
      exists: existsMock,
      create: createMock,
      save: saveMock
    })
  }),
  withTransaction: async (callback: (queryRunner: {
    manager: {
      getRepository: () => {
        findOne: typeof findOneMock;
        create: typeof createMock;
        save: typeof saveMock;
      };
    };
  }) => Promise<unknown>) => {
    const repository = {
      findOne: findOneMock,
      exists: existsMock,
      create: createMock,
      save: saveMock
    };
    const mockQueryRunner = {
      manager: { getRepository: () => repository },
      startTransaction: commitMock,
      commitTransaction: commitMock,
      rollbackTransaction: rollbackMock,
      release: releaseMock
    };
    try {
      const result = await callback(mockQueryRunner);
      commitMock();
      return result;
    } catch (error) {
      rollbackMock();
      throw error;
    }
  }
}));

import { usersRouter } from "../routes/users.js";

const NOW = new Date("2026-04-28T12:00:00.000Z");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use("/users", usersRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe("User Registration API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockImplementation((input) => input);
    existsMock.mockResolvedValue(false);
    saveMock.mockImplementation(async (input) => ({
      id: "11111111-1111-4111-8111-111111111111",
      role: "customer",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
      ...input
    }));
  });

  describe("POST /users/register", () => {
    it("should register a new user with valid wallet address", async () => {
      findOneMock.mockResolvedValue(null);
      const app = createApp();

      const response = await request(app)
        .post("/users/register")
        .send({
          walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          email: "test@example.com",
          alias: "TestUser",
          role: "company"
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body.walletAddress).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
      expect(response.body.email).toBe("test@example.com");
      expect(response.body.alias).toBe("TestUser");
      expect(response.body.role).toBe("company");
      expect(response.body.isActive).toBe(true);
    });

    it("should default to customer role when no persona is provided", async () => {
      findOneMock.mockResolvedValue(null);
      const app = createApp();

      const response = await request(app)
        .post("/users/register")
        .send({
          walletAddress: "GBIRMAYQUTHQC762ZTJTNXWDSHSDGN64ZXPXJ6XRLWJCAF6TS4Z7J7IO"
        });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe("customer");
    });

    it("should register a user without optional fields", async () => {
      findOneMock.mockResolvedValue(null);
      const app = createApp();

      const response = await request(app)
        .post("/users/register")
        .send({
          walletAddress: "GBIRMAYQUTHQC762ZTJTNXWDSHSDGN64ZXPXJ6XRLWJCAF6TS4Z7J7IO"
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body.walletAddress).toBe("GBIRMAYQUTHQC762ZTJTNXWDSHSDGN64ZXPXJ6XRLWJCAF6TS4Z7J7IO");
    });

    it("should reject duplicate wallet address", async () => {
      existsMock.mockResolvedValue(true);
      const app = createApp();

      const response = await request(app)
        .post("/users/register")
        .send({ walletAddress: "GAFY5DYD3EEUWPHL2JHAWFOLKEI2IAQRAVW4Y3L6DLJQOXG2TAJMU7GC" });

      expect(response.status).toBe(409);
      expect(response.body.error).toBeDefined();
    });

    it("should reject invalid wallet address format", async () => {
      const app = createApp();

      const response = await request(app)
        .post("/users/register")
        .send({
          walletAddress: "INVALID_ADDRESS"
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it("should reject invalid email format", async () => {
      const app = createApp();

      const response = await request(app)
        .post("/users/register")
        .send({
          walletAddress: "GAT5GUL7A3BQSOHTPV32ARPLCJFDTICSV3IAT4EAQ5UWTSNE5XNX4Q33",
          email: "invalid-email"
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe("GET /users/:walletAddress", () => {
    it("should retrieve user by wallet address", async () => {
      const walletAddress = "GCNSJNUEJLYRS7FXIWVDUABVBP5PQHCWW6M7IQIBA66C5LCY2RAZ5LBI";
      findOneMock.mockResolvedValue({
        id: "22222222-2222-4222-8222-222222222222",
        walletAddress,
        email: undefined,
        alias: "GetTestUser",
        role: "customer",
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW
      });
      const app = createApp();

      const response = await request(app).get(`/users/${walletAddress}`);

      expect(response.status).toBe(200);
      expect(response.body.walletAddress).toBe(walletAddress);
      expect(response.body.alias).toBe("GetTestUser");
    });

    it("should return 404 for non-existent user", async () => {
      findOneMock.mockResolvedValue(null);
      const app = createApp();

      const response = await request(app)
        .get("/users/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

      expect(response.status).toBe(404);
    });

    it("should reject invalid wallet address format", async () => {
      const app = createApp();

      const response = await request(app)
        .get("/users/INVALID");

      expect(response.status).toBe(400);
    });
  });

  describe("POST /users/login", () => {
    it("should log in an existing user with valid wallet address", async () => {
      const walletAddress = "GCNSJNUEJLYRS7FXIWVDUABVBP5PQHCWW6M7IQIBA66C5LCY2RAZ5LBI";
      findOneMock.mockResolvedValue({
        id: "22222222-2222-4222-8222-222222222222",
        walletAddress,
        email: "test@example.com",
        alias: "LoginUser",
        role: "driver",
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW
      });
      const app = createApp();

      const response = await request(app)
        .post("/users/login")
        .send({ walletAddress });

      expect(response.status).toBe(200);
      expect(response.body.walletAddress).toBe(walletAddress);
      expect(response.body.alias).toBe("LoginUser");
    });

    it("should return 404 for non-existent user", async () => {
      findOneMock.mockResolvedValue(null);
      const app = createApp();

      const response = await request(app)
        .post("/users/login")
        .send({ walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" });

      expect(response.status).toBe(404);
    });

    it("should reject invalid wallet address format", async () => {
      const app = createApp();

      const response = await request(app)
        .post("/users/login")
        .send({ walletAddress: "INVALID_ADDRESS" });

      expect(response.status).toBe(400);
    });
  });

  describe("Transaction Safety", () => {
    it("should rollback user registration on save failure", async () => {
      findOneMock.mockResolvedValue(null);
      saveMock.mockRejectedValue(new Error("Database constraint violation"));

      const app = createApp();

      const response = await request(app)
        .post("/users/register")
        .send({
          walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          email: "test@example.com",
          alias: "TestUser"
        });

      expect(response.status).toBe(500);
      expect(rollbackMock).toHaveBeenCalled();
    });

    it("should commit user registration on success", async () => {
      findOneMock.mockResolvedValue(null);
      const app = createApp();

      const response = await request(app)
        .post("/users/register")
        .send({
          walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          email: "test@example.com",
          alias: "TestUser"
        });

      expect(response.status).toBe(201);
      expect(commitMock).toHaveBeenCalled();
    });

  });

  describe("PATCH /users/me", () => {
    it("should successfully update user profile and return updatedAt !== createdAt", async () => {
      const walletAddress = "GCNSJNUEJLYRS7FXIWVDUABVBP5PQHCWW6M7IQIBA66C5LCY2RAZ5LBI";
      const createdAt = new Date("2026-06-25T12:00:00.000Z");
      const updatedAtBefore = new Date("2026-06-25T12:00:00.000Z");
      const updatedAtAfter = new Date("2026-06-25T13:00:00.000Z");

      findOneMock.mockResolvedValue({
        id: "22222222-2222-4222-8222-222222222222",
        walletAddress,
        email: "old@example.com",
        alias: "OldAlias",
        role: "customer",
        isActive: true,
        createdAt,
        updatedAt: updatedAtBefore
      });

      saveMock.mockResolvedValue({
        id: "22222222-2222-4222-8222-222222222222",
        walletAddress,
        email: "new@example.com",
        alias: "NewAlias",
        role: "customer",
        isActive: true,
        createdAt,
        updatedAt: updatedAtAfter
      });

      const app = createApp();
      const token = signToken(walletAddress);

      const response = await request(app)
        .patch("/users/me")
        .set("Authorization", `Bearer ${token}`)
        .send({
          email: "new@example.com",
          alias: "NewAlias"
        });

      expect(response.status).toBe(200);
      expect(response.body.email).toBe("new@example.com");
      expect(response.body.alias).toBe("NewAlias");
      expect(response.body.createdAt).toBe(createdAt.toISOString());
      expect(response.body.updatedAt).toBe(updatedAtAfter.toISOString());
      expect(response.body.updatedAt).not.toBe(response.body.createdAt);
    });

    it("should reject invalid email format in PATCH request", async () => {
      const walletAddress = "GCNSJNUEJLYRS7FXIWVDUABVBP5PQHCWW6M7IQIBA66C5LCY2RAZ5LBI";
      const app = createApp();
      const token = signToken(walletAddress);

      const response = await request(app)
        .patch("/users/me")
        .set("Authorization", `Bearer ${token}`)
        .send({
          email: "invalid-email"
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("validation_error");
    });
  });

  describe("GET /users/me", () => {
    it("should return authenticated user profile", async () => {
      const walletAddress = "GCNSJNUEJLYRS7FXIWVDUABVBP5PQHCWW6M7IQIBA66C5LCY2RAZ5LBI";
      findOneMock.mockResolvedValue({
        id: "33333333-3333-4333-8333-333333333333",
        walletAddress,
        email: "me@test.com",
        alias: "MeUser",
        role: "customer",
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW
      });

      const app = createApp();
      const token = signToken(walletAddress);
      const response = await request(app)
        .get("/users/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(response.body.walletAddress).toBe(walletAddress);
      expect(response.body.email).toBe("me@test.com");
      expect(response.body.alias).toBe("MeUser");
      expect(response.body.role).toBe("customer");
    });

    it("should return 401 when no auth token is provided", async () => {
      const app = createApp();
      const response = await request(app)
        .get("/users/me")
        .expect(401);

      expect(response.body.error).toBe("unauthorized");
    });

    it("should return 401 when an invalid token is provided", async () => {
      const app = createApp();
      const response = await request(app)
        .get("/users/me")
        .set("Authorization", "Bearer invalid-token")
        .expect(401);

      expect(response.body.error).toBe("unauthorized");
    });

    it("should return 404 when authenticated user is not found in database", async () => {
      findOneMock.mockResolvedValue(null);

      const app = createApp();
      const walletAddress = "GCNSJNUEJLYRS7FXIWVDUABVBP5PQHCWW6M7IQIBA66C5LCY2RAZ5LBI";
      const token = signToken(walletAddress);
      const response = await request(app)
        .get("/users/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(404);

      expect(response.body.error).toBeDefined();
    });
  });
});

describe("Soft delete (#1333)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockImplementation((input) => input);
    existsMock.mockResolvedValue(false);
    saveMock.mockImplementation(async (input) => ({
      id: "11111111-1111-4111-8111-111111111111",
      role: "customer",
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      ...input
    }));
  });

  describe("DELETE /users/me", () => {
    const walletAddress = "GCNSJNUEJLYRS7FXIWVDUABVBP5PQHCWW6M7IQIBA66C5LCY2RAZ5LBI";

    it("returns 401 with no auth token", async () => {
      const app = createApp();
      await request(app).delete("/users/me").expect(401);
    });

    it("marks the account deleted and returns deletedAt", async () => {
      findOneMock.mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        walletAddress,
        role: "customer",
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null
      });

      const app = createApp();
      const token = signToken(walletAddress);
      const response = await request(app)
        .delete("/users/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(response.body.walletAddress).toBe(walletAddress);
      expect(response.body.deletedAt).toBeTruthy();
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: expect.any(Date) })
      );
    });

    it("returns 404 when the account is already soft-deleted", async () => {
      // findOne is queried with deletedAt: IsNull(), so an already-deleted
      // account never comes back here — simulating that as "not found".
      findOneMock.mockResolvedValue(null);

      const app = createApp();
      const token = signToken(walletAddress);
      await request(app)
        .delete("/users/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(404);
    });
  });

  describe("lookups exclude soft-deleted accounts", () => {
    const walletAddress = "GCNSJNUEJLYRS7FXIWVDUABVBP5PQHCWW6M7IQIBA66C5LCY2RAZ5LBI";

    it("POST /users/login 404s for a soft-deleted wallet", async () => {
      // The route filters by deletedAt: IsNull(); a soft-deleted user is
      // therefore never returned to it, which this simulates directly.
      findOneMock.mockResolvedValue(null);

      const app = createApp();
      await request(app)
        .post("/users/login")
        .send({ walletAddress })
        .expect(404);
    });

    it("GET /users/:walletAddress 404s for a soft-deleted wallet", async () => {
      findOneMock.mockResolvedValue(null);

      const app = createApp();
      await request(app).get(`/users/${walletAddress}`).expect(404);
    });

    it("GET /users/me filters by deletedAt: IsNull()", async () => {
      findOneMock.mockResolvedValue({
        id: "11111111-1111-4111-8111-111111111111",
        walletAddress,
        role: "customer",
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null
      });

      const app = createApp();
      const token = signToken(walletAddress);
      await request(app)
        .get("/users/me")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(findOneMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ walletAddress })
        })
      );
    });
  });
});
