# BUG-001: Unused and duplicate microphone/speech permissions

| Field | Value |
|---|---|
| Type | Bug |
| Status | Done |
| Priority | Medium |
| Created | 06/10/2026 |
| Updated | 14/10/2026 |
| Released in | — |

## Summary
`app.json` declares iOS microphone and speech-recognition usage strings and the Android `RECORD_AUDIO` permission, but no code uses audio. `RECORD_AUDIO` is also listed twice. Apple can reject apps that declare permissions they don't use.

## Details
- Steps: open `app.json` → `ios.infoPlist` and `android.permissions`.
- Expected: only permissions the app actually uses.
- Actual: `NSSpeechRecognitionUsageDescription` and `NSMicrophoneUsageDescription` are declared, and `android.permission.RECORD_AUDIO` appears ×2.
- Fix: remove them until voice input is built (track that as its own FEAT).

## Fix
Fixed in CHG-005: the microphone and speech-recognition `infoPlist` entries and the duplicate `RECORD_AUDIO` permission are gone (Android also blocks `RECORD_AUDIO`), pinned by `__tests__/app-config.test.ts`. Add them back with real wording when voice input is built.

## Links
- Related: FEAT-003
