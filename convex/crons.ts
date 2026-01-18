import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Clean up stale sessions every 60 seconds
crons.interval(
  "cleanup stale sessions",
  { seconds: 60 },
  internal.sessions.cleanupStale
);

export default crons;
