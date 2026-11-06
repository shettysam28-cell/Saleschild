/** Bound provider requests without caching identity or weakening authorization. */
export const workspaceFetch: typeof fetch = (input, init) => {
  const upstream = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const deadline = AbortSignal.timeout(15000);
  return fetch(input, {
    ...init,
    signal: upstream ? AbortSignal.any([upstream, deadline]) : deadline,
  });
};
