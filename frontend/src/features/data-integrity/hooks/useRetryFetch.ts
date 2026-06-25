import { useCallback } from 'react';
import { safeFetch } from '../api/safeFetch';

export function useRetryFetch(retries = 3) {
  return useCallback(async (url: string, options?: RequestInit) => {
    let lastError;

    for (let i = 0; i < retries; i++) {
      try {
        return await safeFetch(url, options);
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError;
  }, [retries]);
}