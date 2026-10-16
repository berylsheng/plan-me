# Changelog

All notable changes to Plan-Me. Each entry references a [registry](docs/registry/INDEX.md) ID.
Dates are dd/mm/yyyy (NZ time). Nothing has been released to the App Store yet.

## [Unreleased]

### Added
- FEAT-001: Natural-language event entry, recurrence, `@AZ`/`@GS` tags, week/today/all views, edit and delete. Data stored on the device.
- CHG-001: Specs, App Store release guide, accounts/family sharing design, and the registry.
- FEAT-002: Email/password accounts, offline-first sync, and a one-time import of the phone's existing events.
- FEAT-002: Families with invite codes, personal/shared events, member tags with @, and the Family tab.
- FEAT-002: Settings with profile photo, change password, sign out and in-app account deletion.
- FEAT-004: Edit events in a form, including how they repeat and when they end.
- FEAT-005: A morning summary notification of the day's events, set in Settings.
- CHG-005: App Store set-up (name, bundle ID, iPhone only), EAS build profiles and a manual release pipeline.
- CHG-006: Privacy policy and support pages, published with GitHub Pages.

### Fixed
- BUG-002: Removed the Expo template screens, components, images and reset script.
- BUG-004: `weekly for 4 weeks` now makes 4 events.
- BUG-005: Editing an evening event no longer moves it to another year.
- BUG-001: Removed the unused microphone and speech-recognition permission requests.
- BUG-006: A server error now says "Something went wrong on our side" instead of telling you to check your connection.
- FEAT-004: Changes are kept and retried if the server is missing a newer column.
