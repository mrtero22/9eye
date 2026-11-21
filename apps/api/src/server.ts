import { startClock } from './agents/routines';
import { recoverRuns } from './agents/runner';
import { createApp } from './app';

// Local development: listen on localhost only (decision 0002).
const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? 4100);

// Agent runs that were going when the API stopped did not finish (decision 0024).
recoverRuns().catch((err) => console.error('agent runs', err));
// Routines at their time: checked every 30 s.
startClock();

createApp().listen(port, host, () => {
  console.log(`9eye API on http://${host}:${port}/api`);
});
