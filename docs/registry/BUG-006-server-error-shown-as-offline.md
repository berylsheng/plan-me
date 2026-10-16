# BUG-006: A server error is shown as "Can't reach the server"

| Field | Value |
|---|---|
| Type | Bug |
| Status | In progress |
| Priority | High |
| Created | 16/10/2026 |
| Updated | 16/10/2026 |
| Released in | — |

## Summary
When Supabase answers sign-up (or any auth call) with a 5xx, the app says "Can't reach the server. Check your connection and try again.", sending people to check their Wi-Fi when the server is at fault.

## Details
- Found on TestFlight build 1.0.0 (3): sign-up on `plan-me-prod` returned 500 (edge log 16/10/2026 01:43 UTC) and the app showed the offline message.
- Cause: supabase-js throws `AuthRetryableFetchError` both for a dropped connection (status 0) and for a 5xx answer; `authErrorCode` mapped both to `network`.
- Fix: a 5xx is now code `server` with "Something went wrong on our side. Try again in a minute." `isTransientAuthFailure` treats `network` and `server` alike where it matters: staying signed in when the session can't be refreshed, and sign-out succeeding when the local session is already gone.
- The 500 itself is a separate server problem (most likely the prod SMTP settings); see the Supabase auth logs.

## Links
- Related: FEAT-002, FEAT-003
