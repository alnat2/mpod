import { useCallback, useEffect, useMemo, useRef } from "react";

export function useLatestRequest() {
  const generationRef = useRef(0);

  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    []
  );

  const beginRequest = useCallback(() => {
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  const isLatestRequest = useCallback(
    (generation: number) => generationRef.current === generation,
    []
  );

  return useMemo(
    () => ({ beginRequest, isLatestRequest }),
    [beginRequest, isLatestRequest]
  );
}
