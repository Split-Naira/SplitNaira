import { useEffect, useRef, useState } from 'react';
import { safeFetch } from '../api/safeFetch';

export interface SafeQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
  retry: () => void;
}

export function useSafeQuery<T = any>(url: string): SafeQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = () => {
    const id = ++requestId.current;
    setIsLoading(true);
    setError(null);

    safeFetch(url)
      .then((res) => {
        if (!mountedRef.current) return;
        if (id !== requestId.current) return;
        if (data !== null) setIsStale(false);
        setData(res);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        if (id !== requestId.current) return;
        setError(err?.message ?? 'Request failed');
        setIsStale(data !== null);
      })
      .finally(() => {
        if (!mountedRef.current) return;
        if (id !== requestId.current) return;
        setIsLoading(false);
      });
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const retry = () => {
    fetchData();
  };

  return { data, isLoading, isStale, error, retry };
}