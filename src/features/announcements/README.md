# Announcements

Speaks a message on the voice satellite (`assist_satellite.announce`). The
message is first reworded in Sakke's own voice (`inference/writeText` with
the `announcement` profile); if that fails, comes back empty, or takes too long,
the message is spoken as it is. Failing to reach the satellite throws.

## Entry points

| Export | Called by |
| --- | --- |
| `announce(message, log)` | `tools/announce/announce.ts`, the `announce` tool that scheduled jobs run |
| `speakOnSatellite(text)` | `features/morning/morning.ts`, for the already-worded morning brief |
| `setWordingWriter(writer)` | tests only, to replace the real wording writer |

## Data

None. It keeps nothing between calls.

## Files

| File | Does |
| --- | --- |
| `announcements.ts` | `announce`, the wording request, and `speakOnSatellite`; shows Sakke speaking on the display while the satellite talks |
