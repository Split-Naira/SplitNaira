/* @vitest-environment jsdom */

/**
 * Accessible validation errors on the split creation form (#1267).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { CreateSplitWizard } from "./CreateSplitWizardLegacy";
import type { WalletState } from "@/lib/wallet";

const wallet: WalletState = { connected: true, address: "GOWNER", network: "testnet" };
const VALID_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const VALID_B = "GAIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCEIRCF6M";
// Checksum-valid contract ID. (The preset IDs in lib/token-constants.ts
// currently fail StrKey validation, so they can't be used here.)
const VALID_TOKEN = "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR";

interface Collaborator {
  address: string;
  alias: string;
  basisPoints: string;
}

interface Values {
  projectId: string;
  title: string;
  projectType: string;
  token: string;
  collaborators: Collaborator[];
  expiresAt?: string;
}

const completeValues: Values = {
  projectId: "project_alpha",
  title: "Project Alpha",
  projectType: "music",
  token: VALID_TOKEN,
  collaborators: [
    { address: VALID_A, alias: "Lead", basisPoints: "5000" },
    { address: VALID_B, alias: "Producer", basisPoints: "5000" },
  ],
};

function Harness({
  initialValues,
  onSubmit = vi.fn(),
}: {
  initialValues: Partial<Values>;
  onSubmit?: (data: Values) => void;
}) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isValid: isFormValid },
  } = useForm<Values>({
    defaultValues: { ...completeValues, ...initialValues },
    mode: "onChange",
    shouldFocusError: false,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "collaborators" });
  const watched = useWatch({ control, name: "collaborators" }) || [];
  const total = watched.reduce((sum, c) => sum + (Number.parseInt(c?.basisPoints ?? "", 10) || 0), 0);

  return (
    <CreateSplitWizard
      wallet={wallet}
      control={control}
      register={register}
      handleSubmit={handleSubmit}
      onSubmit={onSubmit}
      createFormErrors={errors}
      collaboratorFields={fields}
      appendCollaborator={append}
      removeCollaborator={remove}
      collaboratorValidationErrors={{}}
      totalBasisPoints={total}
      isValid={isFormValid && total === 10_000}
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

const submitButton = () => screen.getByRole("button", { name: /create split project/i });
const summary = () => screen.queryByTestId("form-error-summary");

/** The text of every element referenced by the field's aria-describedby. */
function descriptionOf(element: HTMLElement): string {
  return (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

describe("CreateSplitWizard accessible errors (#1267)", () => {
  it("keeps the submit button reachable by keyboard while the form is invalid", async () => {
    const user = userEvent.setup();
    render(<Harness initialValues={{ projectId: "", title: "" }} />);

    const button = submitButton();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");

    // Tab through the form; the button must be in the tab order.
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await user.tab();
      reached = document.activeElement === button;
    }
    expect(reached).toBe(true);
  });

  it("shows a summary of every error and moves focus to it after a failed submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness initialValues={{ projectId: "", title: "", projectType: "" }} onSubmit={onSubmit} />);

    expect(summary()).toBeNull();
    await user.click(submitButton());

    const box = await screen.findByTestId("form-error-summary");
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveAccessibleName("There are 3 problems with this form");
    expect(onSubmit).not.toHaveBeenCalled();

    const links = within(box).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Project identifier is required.",
      "Display title is required.",
      "Media category is required.",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["#projectId", "#title", "#projectType"]);
  });

  it("moves focus to the field when a summary link is activated", async () => {
    const user = userEvent.setup();
    render(<Harness initialValues={{ projectId: "", title: "" }} />);
    await user.click(submitButton());

    const box = await screen.findByTestId("form-error-summary");
    await user.click(within(box).getByRole("link", { name: "Display title is required." }));

    expect(screen.getByLabelText("Display Title")).toHaveFocus();
  });

  it("associates each error with its field via aria-invalid and aria-describedby", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialValues={{
          projectId: "",
          token: "",
          collaborators: [
            { address: "", alias: "", basisPoints: "5000" },
            { address: VALID_B, alias: "Producer", basisPoints: "5000" },
          ],
        }}
      />,
    );
    await user.click(submitButton());
    await screen.findByTestId("form-error-summary");

    const projectId = screen.getByLabelText("Project Identifier");
    expect(projectId).toHaveAttribute("aria-invalid", "true");
    expect(descriptionOf(projectId)).toContain("Project identifier is required.");

    const address = screen.getByPlaceholderText("Recipient #1");
    expect(address).toHaveAttribute("aria-invalid", "true");
    expect(descriptionOf(address)).toContain("Wallet address is required.");

    const alias = screen.getAllByPlaceholderText("e.g. Lead Vocals")[0];
    expect(alias).toHaveAttribute("aria-invalid", "true");
    expect(descriptionOf(alias)).toContain("Alias is required.");

    const token = screen.getByLabelText(/Asset token/i);
    expect(token).toHaveAttribute("id", "token");
    expect(token).toHaveAttribute("aria-invalid", "true");
    expect(descriptionOf(token)).toContain("Asset token is required.");

    // Valid fields are not marked invalid.
    expect(screen.getByLabelText("Display Title")).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByLabelText("Display Title")).not.toHaveAttribute("aria-describedby");
  });

  it("focuses the field directly, without a summary, when there is a single error", async () => {
    const user = userEvent.setup();
    render(<Harness initialValues={{ title: "" }} />);

    await user.click(submitButton());

    await waitFor(() => expect(screen.getByLabelText("Display Title")).toHaveFocus());
    expect(summary()).toBeNull();
  });

  it("focuses a dynamically-keyed collaborator field directly when it is the only error (#1596)", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialValues={{
          collaborators: [
            { address: "", alias: "Lead", basisPoints: "5000" },
            { address: VALID_B, alias: "Producer", basisPoints: "5000" },
          ],
        }}
      />,
    );

    await user.click(submitButton());

    await waitFor(() => expect(screen.getByPlaceholderText("Recipient #1")).toHaveFocus());
    expect(summary()).toBeNull();
  });

  it("includes the share-total error in the summary and links it from every share field", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initialValues={{
          projectId: "",
          collaborators: [
            { address: VALID_A, alias: "Lead", basisPoints: "4000" },
            { address: VALID_B, alias: "Producer", basisPoints: "4000" },
          ],
        }}
      />,
    );
    await user.click(submitButton());

    const box = await screen.findByTestId("form-error-summary");
    expect(within(box).getByRole("link", { name: /Under-allocated: 2,000 BP remaining/ })).toBeTruthy();

    for (const share of screen.getAllByPlaceholderText("5000")) {
      expect(share).toHaveAttribute("aria-invalid", "true");
      expect(descriptionOf(share)).toMatch(/Under-allocated: 2,000 BP remaining/);
    }
  });

  it("does not move focus or show the summary while the user is typing", async () => {
    const user = userEvent.setup();
    render(<Harness initialValues={{}} />);

    const projectId = screen.getByLabelText("Project Identifier");
    await user.clear(projectId);
    await user.click(screen.getByLabelText("Display Title"));
    await user.clear(screen.getByLabelText("Display Title"));

    expect(await screen.findByText("Display title is required.")).toBeTruthy();
    expect(screen.getByLabelText("Display Title")).toHaveFocus();
    expect(summary()).toBeNull();
  });

  it("updates the summary as errors are fixed and removes it below two errors", async () => {
    const user = userEvent.setup();
    render(<Harness initialValues={{ projectId: "", title: "", projectType: "" }} />);
    await user.click(submitButton());
    const box = await screen.findByTestId("form-error-summary");
    expect(within(box).getAllByRole("link")).toHaveLength(3);

    await user.type(screen.getByLabelText("Project Identifier"), "alpha");
    await waitFor(() => expect(within(box).getAllByRole("link")).toHaveLength(2));

    await user.type(screen.getByLabelText("Display Title"), "Alpha");
    await waitFor(() => expect(summary()).toBeNull());
    expect(screen.getByText("Media category is required.")).toBeTruthy();
  });

  it("submits normally once the form is valid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness initialValues={{}} onSubmit={onSubmit} />);

    await waitFor(() => expect(submitButton()).toHaveAttribute("aria-disabled", "false"));
    await user.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(summary()).toBeNull();
  });
});
