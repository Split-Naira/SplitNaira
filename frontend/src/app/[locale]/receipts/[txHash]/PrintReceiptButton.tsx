"use client";

export function PrintReceiptButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-greenBright px-4 py-2 font-semibold text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-greenBright print:hidden"
    >
      Print or save receipt
    </button>
  );
}
