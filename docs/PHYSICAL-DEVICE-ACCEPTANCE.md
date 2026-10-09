# Physical-device release acceptance

Run this checklist on one supported Android phone and one supported iPhone with
synthetic data only. Record the device model, OS version, build SHA, installed
version, previous version used for upgrade, tester and date. A blank Actual or
Result cell is **not verified**, never a pass.

## Shared journal and recovery checks

Use a journal containing `ZZDEVICE-ENTRY-001`, emoji, combining Unicode, a long
multiline note, reflection, prayer, provided notes, two Scripture references and
an unfinished draft.

| Check | Expected behavior | Actual | Result |
| --- | --- | --- | --- |
| Fresh install and launch offline | App launches; bundled Scripture, search, journal and settings work without a network |  |  |
| Save, close and reopen | Every saved field and Unicode code point reads back unchanged |  |  |
| Edit, immediately background, force-close and relaunch | Last acknowledged entry remains; newer recoverable writing appears as its draft |  |  |
| Cancel export picker | App reports cancellation, creates no claimed backup and does not reset the backup reminder |  |  |
| Export to local Files/document provider | Success appears only after the picker/provider completes; archive can be reopened and validated |  |  |
| Provider failure (read-only/full/disconnected destination where safely reproducible) | App reports failure, not success; reminder metadata remains due |  |  |
| Replace restore with a valid archive | Entries, drafts, settings promised by the format and private fields match the source |  |  |
| Cancel or fail restore | Existing populated journal remains byte-for-byte/logically unchanged |  |  |
| Upgrade over an older populated installed version | Existing entries and drafts remain accessible; no empty-journal appearance or fallback store |  |  |
| Repeat export/import | No unexpected duplicates, omissions or field changes |  |  |

After a successful provider write, do not record “physically durable” or “cloud
synced.” The app can establish only that the provider accepted write, flush and
close. Confirm an important archive by reopening it from its destination.

## Android-only checks

| Check | Expected behavior | Actual | Result |
| --- | --- | --- | --- |
| Enable App Lock, background and resume | Protected descendants stay hidden until authorization |  |  |
| Force-stop with App Lock enabled, then relaunch | Journal content never flashes before authorization |  |  |
| Deny/cancel device credential | App remains locked and offers a safe retry path |  |  |
| Recreate activity (rotation/developer “Don't keep activities”) | Lock state is re-verified; journal remains intact |  |  |
| Export to local storage and a real document-provider account | Local/provider success follows completed stream close; cancellation and provider errors remain distinct |  |  |
| Inspect installed APK permissions and runtime prompts | No permission, telemetry or network behavior beyond the documented package contract |  |  |

## iPhone-only checks

Complete every step in `docs/IOS-SHARE-ACCEPTANCE.md`, then record:

| Check | Expected behavior | Actual | Result |
| --- | --- | --- | --- |
| Reflection, Prayer and Provided notes defaults | All three switches are OFF on first opening the share surface |  |  |
| Text preview/share while switches are off | Notes and references appear; reflection, prayer and provided notes do not |  |  |
| PDF preview/share while switches are off | Parsed/visible PDF excludes every private marker |  |  |
| Cancel each system share sheet | Cancellation produces no error and changes no entry |  |  |
| Enable each private option deliberately | Only selected content appears in preview and generated output |  |  |
| Background, force-close and relaunch around an edit | Acknowledged writing survives and recoverable newer writing remains available |  |  |
| Export, cancel, restore and upgrade | Outcomes match the shared checks above using actual Files providers |  |  |

## Release decision

Any missing writing, false save/export success, private-content disclosure,
fail-open lock state, destructive failed restore or inaccessible upgraded
journal is a release blocker. Attach screenshots or screen recordings and the
synthetic archive used. Do not include personal journal content in evidence.

| Platform | All required checks passed? | Blockers / evidence links | Sign-off |
| --- | --- | --- | --- |
| Android physical device |  |  |  |
| iPhone physical device |  |  |  |
