"use client";

import { useEffect, useState, useRef } from "react";

interface TransactionRecord {
  txHash: string;
  projectId: string;
  action: string;
  amount: string | null;
  createdAt: Date;
}

interface TransactionStatusEvent {
  status: "completed" | "error" | "timeout";
  record?: TransactionRecord;
  message?: string;
}

export interface UseTransactionStatusResult {
  status: "pending" | "completed" | "error" | "timeout" | null;
  record: TransactionRecord | null;
  error: string | null;
}

export function useTransactionStatus(
  txHash: string | null,
  enabled = true,
): UseTransactionStatusResult {
  const [status, setStatus] = useState<
    "pending" | "completed" | "error" | "timeout" | null
  >(null);
  const [record, setRecord] = useState<TransactionRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!txHash || !enabled) {
      setStatus(null);
      setRecord(null);
      setError(null);
      return;
    }

    // Check if EventSource is supported
    if (typeof EventSource === "undefined") {
      console.warn("EventSource not supported, falling back to polling");
      setStatus("error");
      setError("Real-time updates not supported in this browser");
      return;
    }

    setStatus("pending");
    setError(null);
    setRecord(null);

    // Open SSE connection
    const url = `/api/events/transactions/${encodeURIComponent(txHash)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data: TransactionStatusEvent = JSON.parse(event.data);

        if (data.status === "completed" && data.record) {
          setStatus("completed");
          setRecord(data.record);
          eventSource.close();
        } else if (data.status === "error") {
          setStatus("error");
          setError(data.message || "Unknown error occurred");
          eventSource.close();
        } else if (data.status === "timeout") {
          setStatus("timeout");
          eventSource.close();
        }
      } catch (err) {
        console.error("Failed to parse SSE event:", err);
        setStatus("error");
        setError("Failed to parse server response");
        eventSource.close();
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE connection error:", err);
      setStatus("error");
      setError("Connection to server lost");
      eventSource.close();
    };

    // Cleanup on unmount or when txHash changes
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [txHash, enabled]);

  return { status, record, error };
}
