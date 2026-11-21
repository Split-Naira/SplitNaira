/* @vitest-environment jsdom */

import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import Modal from "../Modal";
import { resetModalFocusForTests } from "../modalFocus";

// Wraps the Modal so we can mount a button that opens it from outside,
// letting us assert focus restoration back to the trigger after close
// (the production callers always render the trigger outside the dialog).
function ModalHarness({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open Dialog
      </button>
      <button type="button">Another Button</button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Accessible Modal"
      >
        <label htmlFor="modal-first">First input</label>
        <input id="modal-first" />
        <label htmlFor="modal-second">Second input</label>
        <input id="modal-second" />
        <button type="button">Submit</button>
      </Modal>
    </div>
  );
}

function NestedModalHarness() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  const [showChildTrigger, setShowChildTrigger] = useState(true);

  return (
    <div>
      <button type="button" onClick={() => setParentOpen(true)}>
        Open Parent
      </button>
      <button type="button" onClick={() => setParentOpen(false)}>
        Close Parent Externally
      </button>
      <button type="button" onClick={() => setShowChildTrigger(false)}>
        Remove Child Trigger
      </button>
      <main>
        <Modal
          isOpen={parentOpen}
          onClose={() => setParentOpen(false)}
          title="Parent Dialog"
        >
          <label htmlFor="parent-input">Parent input</label>
          <input id="parent-input" />
          {showChildTrigger && (
            <button type="button" onClick={() => setChildOpen(true)}>
              Open Child
            </button>
          )}
          <Modal
            isOpen={childOpen}
            onClose={() => setChildOpen(false)}
            title="Child Dialog"
          >
            <label htmlFor="child-input">Child input</label>
            <input id="child-input" />
            <button type="button" onClick={() => setChildOpen(false)}>
              Close Child
            </button>
          </Modal>
        </Modal>
      </main>
    </div>
  );
}

describe("Modal accessibility", () => {
  beforeEach(() => resetModalFocusForTests());

  it("moves focus into the dialog when it opens", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByText("Open Dialog"));

    // The modal moves initial focus to the first focusable element.
    const firstInput = screen.getByLabelText("First input");
    expect(firstInput).toHaveFocus();
  });

  it("wraps focus back to the first element when Tab is pressed on the last", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByText("Open Dialog"));

    const firstInput = screen.getByLabelText("First input");
    const secondInput = screen.getByLabelText("Second input");
    const submit = screen.getByText("Submit");

    // Tab forward through the focusable elements.
    expect(firstInput).toHaveFocus();
    await user.tab();
    expect(secondInput).toHaveFocus();
    await user.tab();
    expect(submit).toHaveFocus();
    // Tab on the last element wraps back to the first.
    await user.tab();
    expect(firstInput).toHaveFocus();
  });

  it("wraps focus back to the last element when Shift+Tab is pressed on the first", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByText("Open Dialog"));

    const firstInput = screen.getByLabelText("First input");
    const submit = screen.getByText("Submit");

    expect(firstInput).toHaveFocus();
    // Shift+Tab from the first element wraps to the last.
    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
  });

  it("closes when the Escape key is pressed", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByText("Open Dialog"));
    expect(screen.getByRole("dialog", { hidden: true })).toBeInTheDocument();

    // The Escape key is intercepted on the document via useEffect.
    // Keep focus on the dialog so we can hear keystrokes routed to the body listener.
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { hidden: true }),
    ).not.toBeInTheDocument();
  });

  it("restores focus to the trigger when the modal closes", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    const trigger = screen.getByText("Open Dialog");
    trigger.focus();
    await user.click(trigger);

    // Modal is open; focus is now inside the dialog.
    expect(screen.getByLabelText("First input")).toHaveFocus();

    // Close via Escape.
    await user.keyboard("{Escape}");

    expect(trigger).toHaveFocus();
  });

  it("marks the dialog with role=dialog and aria-modal=true", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);

    await user.click(screen.getByText("Open Dialog"));

    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "modal-title");
  });

  it("returns focus to its trigger after a nested dialog closes", async () => {
    const user = userEvent.setup();
    render(<NestedModalHarness />);

    await user.click(screen.getByText("Open Parent"));
    await user.click(screen.getByText("Open Child"));
    expect(screen.getByLabelText("Child input")).toHaveFocus();

    await user.click(screen.getByText("Close Child"));

    expect(screen.getByText("Open Child")).toHaveFocus();
  });

  it("falls back to the parent dialog when the nested trigger disappears", async () => {
    const user = userEvent.setup();
    render(<NestedModalHarness />);

    await user.click(screen.getByText("Open Parent"));
    await user.click(screen.getByText("Open Child"));
    await user.click(screen.getByText("Remove Child Trigger"));
    expect(screen.queryByText("Open Child")).not.toBeInTheDocument();

    await user.click(screen.getByText("Close Child"));

    const parentDialog = screen
      .getByText("Parent Dialog")
      .closest('[role="dialog"]');
    expect(parentDialog).toContainElement(
      document.activeElement as HTMLElement,
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it("restores the parent's trigger when a parent closes while a child is open", async () => {
    const user = userEvent.setup();
    render(<NestedModalHarness />);

    const openParent = screen.getByText("Open Parent");
    await user.click(openParent);
    await user.click(screen.getByText("Open Child"));

    await user.click(screen.getByText("Close Parent Externally"));

    expect(
      screen.queryByRole("dialog", { hidden: true }),
    ).not.toBeInTheDocument();
    expect(openParent).toHaveFocus();
  });

  it("does not render the modal markup when closed", () => {
    render(<ModalHarness initiallyOpen={false} />);
    expect(
      screen.queryByRole("dialog", { hidden: true }),
    ).not.toBeInTheDocument();
  });

  it("cleans up the document-level keydown listener on unmount (no Escape side-effects)", () => {
    function DisposableHost() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <Modal
            isOpen={open}
            onClose={() => setOpen(false)}
            title="Disposable"
          >
            <p>Disposable content</p>
          </Modal>
          <button type="button" onClick={() => setOpen(false)}>
            Close externally
          </button>
        </>
      );
    }

    const { unmount } = render(<DisposableHost />);
    unmount();
    // After unmount, pressing Escape must not crash or leave a stale listener.
    fireEvent.keyDown(document, { key: "Escape" });
  });
});
