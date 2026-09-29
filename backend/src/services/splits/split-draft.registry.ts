/**
 * Split draft support (#1302).
 *
 * Users may save incomplete split configuration before publishing or funding.
 * Drafts are off-chain only — they never map to an on-chain project until
 * published. Financial actions (deposit, distribute, claim, lock) are rejected
 * while the record remains in `draft` status.
 */

export type DraftStatus = "draft" | "published" | "discarded";

export interface SplitDraftCollaborator {
  address: string;
  alias?: string;
  basisPoints?: number;
}

export interface SplitDraftRecord {
  id: string;
  owner: string;
  projectId?: string;
  title?: string;
  projectType?: string;
  token?: string;
  collaborators: SplitDraftCollaborator[];
  status: DraftStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  discardedAt?: string;
}

const drafts = new Map<string, SplitDraftRecord>();

function newId(): string {
  return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function resetSplitDraftRegistryForTests(): void {
  drafts.clear();
}

export function saveDraft(input: {
  id?: string;
  owner: string;
  projectId?: string;
  title?: string;
  projectType?: string;
  token?: string;
  collaborators?: SplitDraftCollaborator[];
}): SplitDraftRecord {
  const now = new Date().toISOString();
  if (input.id) {
    const existing = drafts.get(input.id);
    if (!existing) {
      throw Object.assign(new Error("draft_not_found"), {
        code: "draft_not_found",
        status: 404,
      });
    }
    if (existing.status !== "draft") {
      throw Object.assign(new Error("draft_not_editable"), {
        code: "draft_not_editable",
        status: 409,
      });
    }
    if (existing.owner !== input.owner) {
      throw Object.assign(new Error("forbidden_not_owner"), {
        code: "forbidden_not_owner",
        status: 403,
      });
    }
    const updated: SplitDraftRecord = {
      ...existing,
      projectId: input.projectId ?? existing.projectId,
      title: input.title ?? existing.title,
      projectType: input.projectType ?? existing.projectType,
      token: input.token ?? existing.token,
      collaborators: input.collaborators ?? existing.collaborators,
      updatedAt: now,
    };
    drafts.set(updated.id, updated);
    return updated;
  }

  const record: SplitDraftRecord = {
    id: newId(),
    owner: input.owner,
    projectId: input.projectId,
    title: input.title,
    projectType: input.projectType,
    token: input.token,
    collaborators: input.collaborators ?? [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  drafts.set(record.id, record);
  return record;
}

export function getDraft(id: string): SplitDraftRecord | undefined {
  return drafts.get(id);
}

export function listDraftsForOwner(owner: string): SplitDraftRecord[] {
  return Array.from(drafts.values()).filter(
    (d) => d.owner === owner && d.status === "draft",
  );
}

/** True when a draft (or published project still marked draft) must not accept funds. */
export function isFinancialActionBlockedForDraft(
  draft: SplitDraftRecord | undefined,
): boolean {
  return draft != null && draft.status === "draft";
}

/**
 * Publish a draft: requires minimal completeness (projectId, token, ≥2 collabs
 * summing to 10000 bps). Does not submit on-chain — caller builds the XDR.
 */
export function publishDraft(input: {
  id: string;
  owner: string;
}): SplitDraftRecord {
  const draft = drafts.get(input.id);
  if (!draft) {
    throw Object.assign(new Error("draft_not_found"), {
      code: "draft_not_found",
      status: 404,
    });
  }
  if (draft.owner !== input.owner) {
    throw Object.assign(new Error("forbidden_not_owner"), {
      code: "forbidden_not_owner",
      status: 403,
    });
  }
  if (draft.status !== "draft") {
    throw Object.assign(new Error("draft_not_publishable"), {
      code: "draft_not_publishable",
      status: 409,
    });
  }
  if (!draft.projectId || !draft.token) {
    throw Object.assign(new Error("draft_incomplete"), {
      code: "draft_incomplete",
      status: 400,
      message: "projectId and token are required to publish",
    });
  }
  if (draft.collaborators.length < 2) {
    throw Object.assign(new Error("draft_incomplete"), {
      code: "draft_incomplete",
      status: 400,
      message: "at least 2 collaborators are required",
    });
  }
  const totalBps = draft.collaborators.reduce(
    (sum, c) => sum + (c.basisPoints ?? 0),
    0,
  );
  if (totalBps !== 10_000) {
    throw Object.assign(new Error("draft_incomplete"), {
      code: "draft_incomplete",
      status: 400,
      message: "collaborators basisPoints must sum to 10000",
    });
  }

  const now = new Date().toISOString();
  draft.status = "published";
  draft.publishedAt = now;
  draft.updatedAt = now;
  return draft;
}

export function discardDraft(input: {
  id: string;
  owner: string;
}): SplitDraftRecord {
  const draft = drafts.get(input.id);
  if (!draft) {
    throw Object.assign(new Error("draft_not_found"), {
      code: "draft_not_found",
      status: 404,
    });
  }
  if (draft.owner !== input.owner) {
    throw Object.assign(new Error("forbidden_not_owner"), {
      code: "forbidden_not_owner",
      status: 403,
    });
  }
  if (draft.status === "discarded") return draft;
  if (draft.status === "published") {
    throw Object.assign(new Error("draft_already_published"), {
      code: "draft_already_published",
      status: 409,
    });
  }
  draft.status = "discarded";
  draft.discardedAt = new Date().toISOString();
  draft.updatedAt = draft.discardedAt;
  return draft;
}

export function assertNotDraft(draft: SplitDraftRecord | undefined): void {
  if (isFinancialActionBlockedForDraft(draft)) {
    throw Object.assign(new Error("financial_action_on_draft"), {
      code: "financial_action_on_draft",
      status: 409,
      message: "Financial actions are not allowed on draft splits",
    });
  }
}
