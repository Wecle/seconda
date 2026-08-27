import { startInterviewWorker } from "@/lib/interview/application/worker";

console.log("[Interview Worker] Starting background runner...");

const worker = startInterviewWorker({
  pollIntervalMs: 500,
  idlePollIntervalMs: 3000,
  onError: (error) => {
    console.error("[Interview Worker] Error in cycle:", error);
  },
});

function handleShutdown(signalName: string) {
  console.log(`[Interview Worker] Received ${signalName}. Shutting down gracefully...`);
  worker.stop();
  process.exit(0);
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

console.log("[Interview Worker] Daemon active and listening for queued runs and completion jobs.");
