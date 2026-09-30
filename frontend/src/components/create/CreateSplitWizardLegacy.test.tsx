/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useFieldArray, useForm } from "react-hook-form";

import { CreateSplitWizard } from "./CreateSplitWizardLegacy";
import { findDuplicateCollaboratorAddressIds } from "@/lib/address";
import type { WalletState } from "@/lib/wallet";

const wallet: WalletState = { connected: false, address: null, network: "testnet" };

interface CreateCollaboratorInput {
  address: string;
  alias: string;
  basisPoints: string;
}

interface CreateSplitFormValues {
  projectId: string;
  title: string;
  projectType: string;
  token: string;
  collaborators: CreateCollaboratorInput[];
  expiresAt?: string;
}

function Harness({
  collaborators,
  createRetryError = null,
  isSubmitting = false,
  onRetryCreateSubmission = () => {},
}: {
  collaborators: CreateCollaboratorInput[];
  createRetryError?: string | null;
  isSubmitting?: boolean;
  onRetryCreateSubmission?: () => void;
}) {
  const { control, register, handleSubmit } = useForm<CreateSplitFormValues>({
    defaultValues: {
      projectId: "",
      title: "",
      projectType: "music",
      token: "",
      collaborators,
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "collaborators" });

  const collaboratorValidationErrors: Record<string, string> = {};
  const duplicateIds = findDuplicateCollaboratorAddressIds(
    fields.map((field, index) => ({ id: field.id, address: collaborators[index]?.address ?? "" })),
  );
  duplicateIds.forEach((id) => {
    collaboratorValidationErrors[id] = "Duplicate address";
  });

  return (
    <CreateSplitWizard
      wallet={wallet}
      control={control}
      register={register}
      handleSubmit={handleSubmit}
      onSubmit={() => {}}
      createFormErrors={{}}
      collaboratorFields={fields}
      appendCollaborator={append}
      removeCollaborator={remove}
      collaboratorValidationErrors={collaboratorValidationErrors}
      totalBasisPoints={10_000}
      isValid={false}
      sorobanSplitFlowBusy={false}
      isSubmitting={isSubmitting}
      receipt={null}
      latestTxHash={null}
      createdProject={null}
      createRetryError={createRetryError}
      onRetryCreateSubmission={onRetryCreateSubmission}
      setActiveTab={() => {}}
      setSearchProjectId={() => {}}
      setFetchedProject={() => {}}
    />
  );
}

function InteractiveHarness({
  initialValues,
  onSubmit = vi.fn(),
}: {
  initialValues?: Partial<CreateSplitFormValues>;
  onSubmit?: (data: CreateSplitFormValues) => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors: createFormErrors, isValid: isFormValid },
  } = useForm<CreateSplitFormValues>({
    defaultValues: {
      projectId: "project_alpha",
      title: "Project Alpha",
      projectType: "music",
      token: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      collaborators: [
        {
          address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          alias: "Lead",
          basisPoints: "5000",
        },
        {
          address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          alias: "Producer",
          basisPoints: "5000",
        },
      ],
      ...initialValues,
    },
    mode: "onChange",
  });
  const { fields, append, remove } = useFieldArray({ control, name: "collaborators" });
  const watchedCollaborators = watch("collaborators") || [];

  const totalBasisPoints = watchedCollaborators.reduce((sum, col) => {
    if (!col?.basisPoints) return sum;
    const parsed = Number.parseInt(col.basisPoints, 10);
    return sum + (Number.isFinite(parsed) ? parsed : 0);
  }, 0);

  const collaboratorValidationErrors: Record<string, string> = {};
  const duplicateIds = findDuplicateCollaboratorAddressIds(
    fields.map((field, index) => ({
      id: field.id,
      address: watchedCollaborators[index]?.address ?? "",
    })),
  );
  duplicateIds.forEach((id) => {
    collaboratorValidationErrors[id] = "Duplicate address";
  });

  const hasDecimalOrInvalidShare = watchedCollaborators.some((c) => {
    if (!c?.basisPoints) return true;
    return c.basisPoints.includes(".") || !/^\d+$/.test(c.basisPoints.trim());
  });

  const isValid =
    isFormValid &&
    !hasDecimalOrInvalidShare &&
    totalBasisPoints === 10_000 &&
    Object.keys(collaboratorValidationErrors).length === 0 &&
    fields.length >= 2;

  return (
    <CreateSplitWizard
      wallet={wallet}
      control={control}
      register={register}
      handleSubmit={handleSubmit}
      onSubmit={onSubmit}
      createFormErrors={createFormErrors}
      collaboratorFields={fields}
      appendCollaborator={append}
      removeCollaborator={remove}
      collaboratorValidationErrors={collaboratorValidationErrors}
      totalBasisPoints={totalBasisPoints}
      isValid={isValid}
      sorobanSplitFlowBusy={false}
      isSubmitting={false}
      receipt={null}
      latestTxHash={null}
      createdProject={null}
      createRetryError={null}
      onRetryCreateSubmission={() => {}}
      setActiveTab={() => {}}
      setSearchProjectId={() => {}}
      setFetchedProject={() => {}}
    />
  );
}

describe("CreateSplitWizard duplicate collaborator validation", () => {
  it("shows no duplicate errors when addresses are distinct", () => {
    render(
      <Harness
        collaborators={[
          { address: "GABC111", alias: "A", basisPoints: "5000" },
          { address: "GDEF222", alias: "B", basisPoints: "5000" },
        ]}
      />,
    );

    expect(screen.queryByText(/duplicate address/i)).not.toBeInTheDocument();
  });

  it("shows a field-level error on every entry sharing an exact duplicate address", () => {
    render(
      <Harness
        collaborators={[
          { address: "GABC111", alias: "A", basisPoints: "5000" },
          { address: "GABC111", alias: "B", basisPoints: "5000" },
        ]}
      />,
    );

    expect(screen.getAllByText(/duplicate address/i)).toHaveLength(2);
  });

  it("flags duplicates that differ only by casing", () => {
    render(
      <Harness
        collaborators={[
          { address: "gabc111", alias: "A", basisPoints: "5000" },
          { address: "GABC111", alias: "B", basisPoints: "5000" },
        ]}
      />,
    );

    expect(screen.getAllByText(/duplicate address/i)).toHaveLength(2);
  });

  it("flags duplicates that differ only by surrounding whitespace", () => {
    render(
      <Harness
        collaborators={[
          { address: "  GABC111", alias: "A", basisPoints: "5000" },
          { address: "GABC111  ", alias: "B", basisPoints: "5000" },
        ]}
      />,
    );

    expect(screen.getAllByText(/duplicate address/i)).toHaveLength(2);
  });

  it("shows user-visible retry state with a retry action and keeps entered form values", async () => {
    const user = userEvent.setup();
    const retrySpy = vi.fn();

    render(
      <Harness
        collaborators={[
          { address: "GABC111", alias: "Lead", basisPoints: "5000" },
          { address: "GDEF222", alias: "Producer", basisPoints: "5000" },
        ]}
        createRetryError="offline network unavailable"
        onRetryCreateSubmission={retrySpy}
      />,
    );

    expect(screen.getByText(/Submission interrupted/i)).toBeTruthy();
    expect(screen.getByText(/offline network unavailable/i)).toBeTruthy();
    expect(screen.getByDisplayValue("GABC111")).toBeTruthy();
    expect(screen.getByDisplayValue("Lead")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry Submission" }));
    expect(retrySpy).toHaveBeenCalledTimes(1);
  });

  it("disables only retry action while submission is in-flight", () => {
    render(
      <Harness
        collaborators={[
          { address: "GABC111", alias: "Lead", basisPoints: "5000" },
          { address: "GDEF222", alias: "Producer", basisPoints: "5000" },
        ]}
        createRetryError="temporary network issue"
        isSubmitting
      />,
    );

    expect(screen.getByRole("button", { name: "Retry Submission" })).toHaveProperty("disabled", true);
  });
});

describe("CreateSplitWizard collaborator percentage totals and validation", () => {
  it("displays under-total status and disables submission when shares sum to less than 10,000 BP", () => {
    render(
      <InteractiveHarness
        initialValues={{
          collaborators: [
            {
              address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
              alias: "A",
              basisPoints: "4000",
            },
            {
              address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
              alias: "B",
              basisPoints: "4000",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("8,000 / 10,000 BP")).toBeInTheDocument();
    expect(screen.getByText(/Under-allocated: 2,000 BP remaining/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create split project/i })).toHaveProperty("disabled", true);
  });

  it("displays over-total status and disables submission when shares sum to more than 10,000 BP", () => {
    render(
      <InteractiveHarness
        initialValues={{
          collaborators: [
            {
              address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
              alias: "A",
              basisPoints: "6000",
            },
            {
              address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
              alias: "B",
              basisPoints: "5500",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("11,500 / 10,000 BP")).toBeInTheDocument();
    expect(screen.getByText(/Over-allocated: 1,500 BP over limit/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create split project/i })).toHaveProperty("disabled", true);
  });

  it("displays valid status and enables submission when shares equal exactly 10,000 BP", async () => {
    const user = userEvent.setup();
    const submitSpy = vi.fn();

    render(
      <InteractiveHarness
        onSubmit={submitSpy}
        initialValues={{
          collaborators: [
            {
              address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
              alias: "A",
              basisPoints: "5000",
            },
            {
              address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
              alias: "B",
              basisPoints: "5000",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("10,000 / 10,000 BP")).toBeInTheDocument();
    expect(screen.getByText(/Total shares valid: 100% allocated/i)).toBeInTheDocument();

    const submitBtn = screen.getByRole("button", { name: /create split project/i });
    expect(submitBtn).toHaveProperty("disabled", false);

    await user.click(submitBtn);
    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("shows accessible field error and blocks submission when decimal share is entered", async () => {
    const user = userEvent.setup();

    render(
      <InteractiveHarness
        initialValues={{
          collaborators: [
            {
              address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
              alias: "A",
              basisPoints: "5000",
            },
            {
              address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
              alias: "B",
              basisPoints: "5000",
            },
          ],
        }}
      />,
    );

    const shareInputs = screen.getAllByPlaceholderText("5000");
    await user.clear(shareInputs[0]);
    await user.type(shareInputs[0], "5000.5");

    expect(await screen.findByText(/Share must be a whole integer in basis points/i)).toBeInTheDocument();
    expect(shareInputs[0]).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /create split project/i })).toHaveProperty("disabled", true);
  });

  it("dynamically updates allocation matrix and submit readiness when editing share values", async () => {
    const user = userEvent.setup();
    const submitSpy = vi.fn();

    render(
      <InteractiveHarness
        onSubmit={submitSpy}
        initialValues={{
          collaborators: [
            {
              address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
              alias: "A",
              basisPoints: "3000",
            },
            {
              address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
              alias: "B",
              basisPoints: "3000",
            },
          ],
        }}
      />,
    );

    // Initial under-total state: 6,000 BP
    expect(screen.getByText("6,000 / 10,000 BP")).toBeInTheDocument();
    expect(screen.getByText(/Under-allocated: 4,000 BP remaining/i)).toBeInTheDocument();
    const submitBtn = screen.getByRole("button", { name: /create split project/i });
    expect(submitBtn).toHaveProperty("disabled", true);

    // Edit second collaborator to 7000 -> exact total 10,000 BP
    const shareInputs = screen.getAllByPlaceholderText("5000");
    await user.clear(shareInputs[1]);
    await user.type(shareInputs[1], "7000");

    await waitFor(() => {
      expect(screen.getByText("10,000 / 10,000 BP")).toBeInTheDocument();
      expect(screen.getByText(/Total shares valid: 100% allocated/i)).toBeInTheDocument();
      expect(submitBtn).toHaveProperty("disabled", false);
    });

    // Edit second collaborator to 8000 -> over total 11,000 BP
    await user.clear(shareInputs[1]);
    await user.type(shareInputs[1], "8000");

    await waitFor(() => {
      expect(screen.getByText("11,000 / 10,000 BP")).toBeInTheDocument();
      expect(screen.getByText(/Over-allocated: 1,000 BP over limit/i)).toBeInTheDocument();
      expect(submitBtn).toHaveProperty("disabled", true);
    });
  });

  it("preserves accessible status announcement semantics on the allocation matrix", () => {
    render(
      <InteractiveHarness
        initialValues={{
          collaborators: [
            {
              address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
              alias: "A",
              basisPoints: "5000",
            },
            {
              address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
              alias: "B",
              basisPoints: "5000",
            },
          ],
        }}
      />,
    );

    const statusElement = screen.getByRole("status");
    expect(statusElement).toHaveAttribute("aria-live", "polite");
    expect(statusElement).toHaveTextContent(/Total shares valid: 100% allocated/i);
  });
});
