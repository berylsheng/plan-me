# Morning summary notification — design (FEAT-005)

Date: 14/10/2026. Status: approved in conversation, awaiting written review. Platform: iOS only.

## Intent

- **Said by the user:** every morning at 7, push a notification summarising the things on the day. Only iOS needs supporting.
- **Agreed:** built on the phone (local notifications), not sent from a server; a summary may miss shared events a family member added while the app was closed. On/off and a time in Settings, default 7:00 am. No notification on a day with nothing planned.
- **Success:** at the chosen time the notification arrives with that day's events, even if the app wasn't opened that morning.

## 1. What the user sees

- **Settings → Morning summary:** a switch and a time (default 7:00 am, same time picker as the edit form).
- **Turning it on:** iOS asks for notification permission the first time. If permission is refused (now or earlier), the switch returns to off and the section shows "Notifications are off for Plan-Me. Turn them on in iOS Settings." with an **Open Settings** link (`Linking.openSettings()`).
- **The notification**, only on days with events:
  - Title: `Today: 3 events` (`Today: 1 event` for one).
  - Body: events in time order, timed first, e.g. `7:00 am Swim · 12:30 pm Lunch · Dinner`. At most 6 events, then `+2 more`.
  - Includes everything on the planner that day: personal events and the family's shared ones.
- Tapping it opens the app on the planner (which starts on today).
- The setting is off until turned on, and is kept on the phone per account (each person on a shared phone has their own).
- Signing out or deleting the account cancels every pending summary on that phone.

## 2. Scheduling

- Package: `expo-notifications` at the SDK 54 version (`npx expo install expo-notifications`), with its config plugin in `app.json`. Read https://docs.expo.dev/versions/v54.0.0/sdk/notifications/ first. Local notifications work in Expo Go on iOS.
- A notification's text is fixed when it is scheduled, so the app schedules one **date-triggered** notification per day for the **next 14 days**, each at the chosen time on that NZ date, with that day's summary written in. Well under iOS's limit of 64 pending notifications.
  - Days with no events are skipped; today is skipped once its time has passed.
- **Rescheduling:** cancel this app's pending summaries and schedule them again when the app starts or returns to the foreground; when events change (own edits or live family changes), debounced by 2 seconds; and when the setting or time changes. Summaries carry a marker in their data (`kind: 'morning-summary'`) so only they are cancelled.
- Nothing is scheduled when signed out, when the setting is off, or without iOS permission (rechecked on every reschedule).
- Notifications show as a banner even when the app is open at that time (foreground handler).
- **Known limits:** after 14 days with the app closed, summaries stop until it is opened again; shared events added while the app was closed appear only after it next opens.

## 3. Structure, errors, testing

**New**
- `lib/notifications/summary.ts` (pure): `summaryFor(dateKey: string, records: EventRecord[]): { title: string; body: string } | null`. Uses `formatClock`; timed events by start time, then untimed; cap 6 + `+N more`.
- `lib/notifications/schedule.ts` (pure): `plannedSummaries(records: Record<string, EventRecord>, opts: { time: 'HH:mm'; now: Date; days?: number /* 14 */ }): { dateKey: string; fireAt: Date; title: string; body: string }[]`.
- `lib/notifications/settings.ts`: `loadSummarySettings(storage, userId)` / `saveSummarySettings(storage, userId, s)`, `{ enabled: boolean; time: 'HH:mm' }`, default `{ enabled: false, time: '07:00' }`.
- `lib/notifications/notifier.ts`: the only module importing `expo-notifications` — `permission()`, `requestPermission()`, `cancelSummaries()`, `scheduleSummaries(planned)`, plus the foreground handler. A `Notifier` interface lets tests pass a fake.
- `context/MorningSummaryProvider.tsx`: reads the user's setting; watches records, the setting and `AppState`; reschedules after 2 s; cancels on sign-out and account deletion. Exposes `useMorningSummary()` → `{ settings, setEnabled, setTime, permissionDenied }`.
- `components/settings/MorningSummarySettings.tsx`: the switch, the time (`TimeField`), the iOS-Settings message; placed in `SettingsScreen`.

**Errors**
- Permission refused: switch back to off, message shown.
- Scheduling throws: caught, nothing shown (no error code logged or displayed); the next trigger tries again.

**Testing (TDD)**
- `summaryFor`: ordering, untimed last, cap and `+N more`, singular title, `null` for an empty day.
- `plannedSummaries`: 14 days, empty days skipped, today skipped after its time, `fireAt` at the right local time on each NZ date.
- Settings storage per user, with the default.
- Provider with a fake notifier: one reschedule after a burst of changes; cancel on sign-out; nothing scheduled when off or without permission.
- Settings UI: asks permission when switched on; turns back off and shows the message when refused; changing the time saves and reschedules.

## Out of scope
- Server push, Android, per-event reminders, a summary for tomorrow or the week.
