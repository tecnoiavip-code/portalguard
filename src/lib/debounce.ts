export function createDebouncedRunner<T extends unknown[]>(
  fn: (...args: T) => void | Promise<void>,
  delayMs = 1200,
) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let latestArgs: T;

  const run = (...args: T) => {
    latestArgs = args;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      void fn(...latestArgs);
    }, delayMs);
  };

  run.cancel = () => {
    if (!timeout) return;
    clearTimeout(timeout);
    timeout = null;
  };

  return run;
}
