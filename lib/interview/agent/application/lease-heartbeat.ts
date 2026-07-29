export function startLeaseHeartbeat(options: {
  intervalMs: number;
  renew: () => Promise<boolean>;
  onLeaseLost: (error: unknown) => void;
}) {
  let stopped = false;
  let lost = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  const reportLeaseLost = (error: unknown) => {
    if (lost) return;
    lost = true;
    options.onLeaseLost(error);
  };

  const schedule = () => {
    if (stopped || lost) return;
    timer = setTimeout(() => {
      timer = null;
      inFlight = renewOnce();
    }, options.intervalMs);
  };

  const renewOnce = async () => {
    try {
      if (!(await options.renew())) {
        reportLeaseLost(new Error("Agent run lease was lost"));
      }
    } catch (error) {
      reportLeaseLost(error);
    } finally {
      schedule();
    }
  };

  schedule();

  return {
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await inFlight;
    },
  };
}
