/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useFieldArray, useForm } from "react-hook-form";
import { NextIntlClientProvider } from "next-intl";

import { CreateSplitWizard } from "./CreateSplitWizardLegacy";
import type { WalletState } from "@/lib/wallet";
import enMessages from "../../../messages/en.json";
import frMessages from "../../../messages/fr.json";

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
}

function LocalizedHarness({
  locale,
  messages,
  initialValues,
}: {
  locale: string;
  messages: any;
  initialValues?: Partial<CreateSplitFormValues>;
}) {
  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors: createFormErrors, isValid: isFormValid },
  } = useForm<CreateSplitFormValues>({
    defaultValues: {
      projectId: "project_1",
      title: "Project 1",
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

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CreateSplitWizard
        wallet={wallet}
        control={control}
        register={register}
        handleSubmit={handleSubmit}
        onSubmit={() => {}}
        createFormErrors={createFormErrors}
        collaboratorFields={fields}
        appendCollaborator={append}
        removeCollaborator={remove}
        collaboratorValidationErrors={{}}
        totalBasisPoints={totalBasisPoints}
        isValid={isFormValid && totalBasisPoints === 10_000}
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
    </NextIntlClientProvider>
  );
}

describe("CreateSplitWizard locale-aware validation messages", () => {
  it("renders English validation messages when English locale is active", async () => {
    const user = userEvent.setup();

    render(
      <LocalizedHarness
        locale="en"
        messages={enMessages}
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

    // Allocation under-allocated message in English
    expect(screen.getByText(/Under-allocated: 2,000 BP remaining/i)).toBeInTheDocument();

    // Trigger decimal validation error
    const shareInputs = screen.getAllByPlaceholderText("5000");
    await user.clear(shareInputs[0]);
    await user.type(shareInputs[0], "4000.5");

    expect(
      await screen.findByText(/Share must be a whole integer in basis points/i)
    ).toBeInTheDocument();
  });

  it("renders French validation messages when French locale is active", async () => {
    const user = userEvent.setup();

    render(
      <LocalizedHarness
        locale="fr"
        messages={frMessages}
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

    // Allocation under-allocated message in French
    expect(screen.getByText(/Sous-alloué : 2,000 PB restants/i)).toBeInTheDocument();

    // Trigger decimal validation error in French
    const shareInputs = screen.getAllByPlaceholderText("5000");
    await user.clear(shareInputs[0]);
    await user.type(shareInputs[0], "4000.5");

    expect(
      await screen.findByText(/La part doit être un entier en points de base/i)
    ).toBeInTheDocument();
  });
});
