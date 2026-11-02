import { lazy, type ComponentType } from "react";

export type LazyRetryOptions = {
  retries?: number;
  delay?: number;
  backoff?: boolean;
};

export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  options: LazyRetryOptions = {}
) {
  const { retries = 2, delay = 500, backoff = true } = options;

  return lazy(async () => {
    let currentDelay = delay;
    for (let attempt = 0; ; attempt++) {
      try {
        return await importer();
      } catch (error) {
        if (attempt >= retries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
        if (backoff) {
          currentDelay *= 2;
        }
      }
    }
  });
}
