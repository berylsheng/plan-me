const { execSync } = require('node:child_process');

// Point the tests at the running local stack. Workers inherit these env vars.
module.exports = async () => {
  let status;
  try {
    status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    throw new Error('Local Supabase is not running. Start it with `npm run db:start`.');
  }
  const apiUrl = status.API_URL;
  const publishableKey = status.PUBLISHABLE_KEY;
  const mailpitUrl = status.MAILPIT_URL ?? status.INBUCKET_URL;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  if (!apiUrl || !publishableKey || !mailpitUrl || !serviceRoleKey) {
    throw new Error('Supabase status is missing expected fields (API_URL, PUBLISHABLE_KEY, MAILPIT_URL, SERVICE_ROLE_KEY). Check that supabase start completed successfully.');
  }
  process.env.SUPABASE_TEST_URL = apiUrl;
  process.env.SUPABASE_TEST_PUBLISHABLE_KEY = publishableKey;
  process.env.SUPABASE_TEST_MAILPIT_URL = mailpitUrl;
  process.env.SUPABASE_TEST_SERVICE_ROLE_KEY = serviceRoleKey;
};
