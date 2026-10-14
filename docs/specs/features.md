# Features

Last updated: 14/10/2026. Status values: **Built**, **In progress**, **Planned**, **Idea**. Registry IDs link to the item that tracks the work.

## Built (v1.0.0, single device — not yet released)

### Natural-language event entry — FEAT-001
Type a sentence and press Add. The placeholder shows an example with your tag and a repeat; **(?) Tips** above the box lists everything it understands.
- Dates and times are read by chrono-node: `6 June, 6-8pm, dancing`, `tomorrow 9am dentist`, `next Friday lunch`.
- Shorthand ranges: `2-5pm`, `11-4` (crosses noon → 11am–4pm), `11:30-2:45pm`.
- If no date is given, the event goes on the selected day. If there's neither a date nor a time, you get an error.
- Anything left after the date and time is the event name; it defaults to "Busy".

### Recurring events — FEAT-001
- `weekly for 4 months`, `daily for 2 weeks`, `fortnightly for 3 months`, `monthly for 6 months`, `every 2 weeks for 6 months`.
- `for 4 weeks` means a 4-week window from the first date (4 weekly events). Each occurrence is stored as its own event and keeps the rule.
- Deleting one asks "this event only" or "this and all future".

### Person tags — FEAT-001
- `@AZ` and `@GS` attach an avatar to the event. The tags are hard-coded today.

### Calendar views — FEAT-001
- Week strip with swipe and arrows; tap a day to select it.
- Month label opens a full month calendar; days with events show a dot.
- View modes: **Today** (selected day), **Week** (Mon–Sun), **All** (today onwards).
- Past events are dimmed. All dates use NZ time.

### Edit and delete — FEAT-001 and FEAT-004
- **Modify** mode shows Edit and Delete on each event.
- Edit opens a form: name, date (dd/mm/yyyy), start and end time, repeat (Doesn't repeat, Daily, Weekly, Fortnightly, Monthly or every N days, weeks or months) ending on a date at most a year on, people, and sharing. For a repeating event with later events, Save asks "This event only" or "This and all future"; changing the repeat or end date always changes this and all future events. Only the creator of a shared event can change how it repeats.

## Planned

### Event edit form — FEAT-004 (built; device testing next)
- Edit opens a full-screen form with all event fields: name, date (dd/mm/yyyy), start and end time, repeat (Doesn't repeat, Daily, Weekly, Fortnightly, Monthly or custom) and end date, people, and sharing.
- For a repeating event, Save asks whether to change "This event only" or "This and all future".
- The form validates date within a year and end time after start time. End date is at most a year from the first date.
- Changing the repeat rule or end date always applies to this and all future events.
- A "this and all future" edit that moves the date makes the moved events a separate series.
- Only the event creator can edit the repeat rule of a shared event.
- Requires `npx supabase db push` on hosted to apply the new `repeat` column. Run it before installing this build on any phone.

### Morning summary — FEAT-005 (built; device testing next)
- Each morning at a time you choose (default 7:00 am) your iPhone lists that day's events in a notification. Nothing is sent on an empty day.
- Turn it on and pick the time in Settings → Morning summary; iOS asks for permission the first time.
- It's scheduled on the phone, so shared events added while your app is closed show up only after you next open it.

### Accounts — FEAT-002 (built; device testing next)
- Sign up and sign in with email + password (plus an optional display name), with email confirmation.
- Password reset by email link that opens the app.
- Stay signed in until you sign out; delete your account from inside the app.
- Existing on-device events upload once to the account on first sign-in.
- Create or join a family with an invite code, share events, tag members with @, and manage members on the Family tab.
- Settings: your name, tag and profile photo, change password, sign out, and delete your account.
- Family members show with their photo (or a coloured circle with their tag) on events and on the Family tab.

### Family sharing — FEAT-002
- One family per user. The creator gets an 8-character invite code; others join by entering it.
- Each event is **personal** (only you see it; the default) or **shared** (all family members).
- Family members can view, edit, and delete shared events. Only the event's creator can make it personal again.
- A member can leave; the owner can remove members and regenerate the invite code.
- Leaving the family keeps the events you shared with the family; you stop seeing them.
- Shared events show who created them. Changes from family members appear live.
- Works offline; syncs on reconnect, and the latest save wins.

### Family member tags — FEAT-002
- `@tag` refers to a family member (2–4 letter tag, with an avatar).
- A one-time step maps the old `@AZ`/`@GS` tags onto members.

### App Store release — FEAT-003
- Available to download from the Apple App Store. See [the release guide](../guides/app-store-release.md).

## Ideas (not committed)
- Voice input (permissions are already declared in `app.json`; nothing is implemented).
- Reminders and notifications.
- Android / Google Play release.
