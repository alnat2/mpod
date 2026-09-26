# Controlled playback test audio

`FakeAudio` in `fake-audio.ts` is a test double, not a browser audio engine.
Reset `FakeAudio.instances` between tests and install it with `vi.stubGlobal("Audio", FakeAudio)`.

- Assign `readyState`, `duration`, `currentTime`, `paused`, `ended` and `error` explicitly.
- `emit(event)` calls current listeners only. Registration never replays prior events.
- `src` resets readiness/duration; `load()` resets readiness/time and pauses without readiness events.
- `playImpl`/`pauseImpl`/`loadImpl` are spies. Default Play resolves and clears paused; it does not emit playing.
- Override `playImpl` with a deferred Promise to control rejection before or after metadata/canplay.
- Emit metadata at readyState 1, canplay at 3 or 4, and playing only when the scenario calls for it.
- `captureEvent(event)` freezes listeners for explicit delivery of an already queued old callback.
- For natural completion set currentTime, paused and ended before emitting ended.

The contract tests fail on the e66042d model (registration replay, load readiness, error without later readiness).
The context suite uses one queue item for a three-track audiobook, typed membership/progress and server nextTarget.

## Baseline limitations

On e66042d, five existing HomeScreen tests fail: desktop/mobile render counts,
resume from timeupdate, resume from seek, and server position priority. They also fail without PB-06.
The completion E2E passes. Reorder E2E expects obsolete episodeIds; PB-02 separately fixes that API mock.
Downloaded-source E2E detects extra load/pause and a reset position; keep exact per-operation counters and reconcile with PB-01 during integration.
Playwright scenarios with FakeAudio do not validate sound, background execution or locked phones.

## Integration candidate

PB-01—PB-06 reconciliation retains readiness cleanup, source/selection generations and completion locks.
HomeScreen now uses this model and explicitly waits for the source before providing readiness.
PB-02 fixtures include membership. A locally completed cached track is marked listened until fresh server data arrives.
The combined tests delay completion and queue separately, recover B after media error, choose C,
and release old completion/progress/play/ready callbacks while asserting C source, queue, position and audio state.
