import { beforeEach, describe, expect, it, vi } from "vitest";

const findOneMock = vi.fn();
const saveMock = vi.fn();
const createMock = vi.fn((input: unknown) => input);

vi.mock("../services/database.js", () => ({
  getDataSource: () => ({
    getRepository: () => ({
      findOne: findOneMock,
      save: saveMock,
      create: createMock,
    }),
  }),
}));

const {
  archiveProject,
  restoreProject,
  isProjectArchived,
  assertActionAllowed,
  AlreadyArchivedError,
  NotArchivedError,
} = await import("../services/project-archival.service.js");

beforeEach(() => {
  vi.clearAllMocks();
  saveMock.mockImplementation(async (r: unknown) => r);
});

describe("archiveProject", () => {
  it("archives a project with no prior archival history", async () => {
    findOneMock.mockResolvedValue(null);

    const result = await archiveProject({
      projectId: "p1",
      archivedBy: "GOWNER",
      reason: "wound down",
    });

    expect(result.projectId).toBe("p1");
    expect(result.archivedBy).toBe("GOWNER");
    expect(result.reason).toBe("wound down");
    expect(result.restoredAt).toBeNull();
  });

  it("refuses to archive a project that is currently archived", async () => {
    findOneMock.mockResolvedValue({
      projectId: "p1",
      archivedBy: "GOWNER",
      archivedAt: new Date("2026-01-01"),
      restoredBy: null,
      restoredAt: null,
    });

    await expect(
      archiveProject({ projectId: "p1", archivedBy: "GOWNER" }),
    ).rejects.toThrow(AlreadyArchivedError);
  });

  it("allows re-archiving a project that was previously restored", async () => {
    findOneMock.mockResolvedValue({
      projectId: "p1",
      archivedBy: "GOWNER",
      archivedAt: new Date("2026-01-01"),
      restoredBy: "GOWNER",
      restoredAt: new Date("2026-01-05"),
    });

    const result = await archiveProject({ projectId: "p1", archivedBy: "GOWNER" });
    expect(result.restoredAt).toBeNull();
  });

  it("trims projectId, archivedBy and reason, and drops a blank reason to null", async () => {
    findOneMock.mockResolvedValue(null);

    const result = await archiveProject({
      projectId: "  p1  ",
      archivedBy: "  GOWNER  ",
      reason: "   ",
    });

    expect(result.projectId).toBe("p1");
    expect(result.archivedBy).toBe("GOWNER");
    expect(result.reason).toBeNull();
  });
});

describe("restoreProject", () => {
  it("restores a currently archived project", async () => {
    findOneMock.mockResolvedValue({
      projectId: "p1",
      archivedBy: "GOWNER",
      archivedAt: new Date("2026-01-01"),
      restoredBy: null,
      restoredAt: null,
    });

    const result = await restoreProject({ projectId: "p1", restoredBy: "GOWNER" });

    expect(result.restoredBy).toBe("GOWNER");
    expect(result.restoredAt).toBeInstanceOf(Date);
    // The archival event itself is preserved, not deleted.
    expect(result.archivedBy).toBe("GOWNER");
  });

  it("refuses to restore a project with no archival history", async () => {
    findOneMock.mockResolvedValue(null);

    await expect(
      restoreProject({ projectId: "p1", restoredBy: "GOWNER" }),
    ).rejects.toThrow(NotArchivedError);
  });

  it("refuses to restore a project that is already restored", async () => {
    findOneMock.mockResolvedValue({
      projectId: "p1",
      archivedBy: "GOWNER",
      archivedAt: new Date("2026-01-01"),
      restoredBy: "GOWNER",
      restoredAt: new Date("2026-01-05"),
    });

    await expect(
      restoreProject({ projectId: "p1", restoredBy: "GOWNER" }),
    ).rejects.toThrow(NotArchivedError);
  });
});

describe("isProjectArchived", () => {
  it("is false for a project with no archival history", async () => {
    findOneMock.mockResolvedValue(null);
    expect(await isProjectArchived("p1")).toBe(false);
  });

  it("is true for an archived, not-yet-restored project", async () => {
    findOneMock.mockResolvedValue({
      restoredAt: null,
      archivedAt: new Date("2026-01-01"),
    });
    expect(await isProjectArchived("p1")).toBe(true);
  });

  it("is false once restored", async () => {
    findOneMock.mockResolvedValue({
      restoredAt: new Date("2026-01-05"),
      archivedAt: new Date("2026-01-01"),
    });
    expect(await isProjectArchived("p1")).toBe(false);
  });
});

describe("assertActionAllowed", () => {
  it("blocks funding an archived project", async () => {
    findOneMock.mockResolvedValue({ restoredAt: null, archivedAt: new Date("2026-01-01") });
    await expect(assertActionAllowed("p1", "fund")).rejects.toThrow(/archived/);
  });

  it("blocks editing collaborators on an archived project", async () => {
    findOneMock.mockResolvedValue({ restoredAt: null, archivedAt: new Date("2026-01-01") });
    await expect(assertActionAllowed("p1", "edit_collaborators")).rejects.toThrow();
  });

  it("blocks distribution on an archived project", async () => {
    findOneMock.mockResolvedValue({ restoredAt: null, archivedAt: new Date("2026-01-01") });
    await expect(assertActionAllowed("p1", "distribute")).rejects.toThrow();
  });

  it("allows every action on a non-archived project", async () => {
    findOneMock.mockResolvedValue(null);
    await expect(assertActionAllowed("p1", "fund")).resolves.toBeUndefined();
    await expect(assertActionAllowed("p1", "distribute")).resolves.toBeUndefined();
  });

  it("allows every action again once the project is restored", async () => {
    findOneMock.mockResolvedValue({
      restoredAt: new Date("2026-01-05"),
      archivedAt: new Date("2026-01-01"),
    });
    await expect(assertActionAllowed("p1", "fund")).resolves.toBeUndefined();
  });
});
