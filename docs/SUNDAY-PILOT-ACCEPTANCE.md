# Fictional Sunday pilot — pastor and congregants

**Prepared, not executed. Native release remains HOLD.** Use this short script
alongside [physical-device acceptance](PHYSICAL-DEVICE-ACCEPTANCE.md),
[iPhone sharing acceptance](IOS-SHARE-ACCEPTANCE.md), and the companion's
`docs/manual-acceptance.md`. An empty Result is **not verified**.

## Safe setup

Allow about 20–30 minutes for a pastor and three volunteer testers: someone
comfortable with files, someone who mainly uses a phone, and someone using
keyboard or assistive technology. This document does not authorize contacting
participants or collecting their personal journal contents.

Use isolated browser profiles and throwaway test journals. For native checks,
use test devices/builds containing only synthetic data. Never uninstall, clear,
replace or upgrade a real journal for this pilot. Keep a source fixture and
backup outside the test store before testing replacement.

Record tester alias, device/browser/OS, build SHA, source and receiving edition,
prior version for upgrade, date, result and a synthetic screenshot or file hash.
Do not record passwords or personal writing. If no test host or physical phone
is available, mark the applicable step **blocked/unverified**, not passed.

## Fictional material

- Church: **Example Fellowship (fictional)**
- Speaker: **Taylor Example (fictional)**
- Title: **Listening before speaking — test only**
- Date: **2026-10-18**
- Scripture: **James 1:19**
- Provided outline: `## Test outline` followed by `1. Listen carefully.` and
  `2. Leave space for another person to speak.`
- Personal fields: `PRIVATE TEST NOTE`, `PRIVATE TEST REFLECTION`,
  `PRIVATE TEST PRAYER`; add `café / café / 🙏` and a second line to Notes.
- Unfinished draft: `UNFINISHED TEST THOUGHT  `, including its two trailing spaces.

These markers are test data, not generated devotional writing for a real user.

## One complete journey

| Step | Ask the tester to do | Expected result / evidence | Result |
| --- | --- | --- | --- |
| 1. Pastor prepares | Create a church outline with the fields above. Try one missing outline and invalid date before correcting them. Preview, save a pastor draft, return and reuse a template if offered. | Actionable validation; no empty or truncated handout; pastor drafts/templates do not appear as personal journal entries. Capture preview and restored draft. | |
| 2. Export and public QR | Download the v1 sermon-notes JSON. If an already approved test host is available, place the fictional file there through the authorized publishing process, verify HTTPS returns that file, and generate/download its QR. | Export opens as the documented format. QR shows only the exact public HTTPS file URL, with no personal content. Creating QR must not claim upload/publication. Record host URL and served-file hash, or mark hosting blocked. | |
| 3. Congregant previews | Open the file through the normal church-import control; on a physical phone scan the QR only if the preceding host check succeeded. Preview before accepting. | Provided outline and claimed attribution are visible. No implied verified church identity. Personal Notes/Reflection/Prayer are still empty. Record physical scan separately from browser opening. | |
| 4. Write separately | Add each personal marker to its matching field, save one finished entry and leave one separate draft unfinished. Use normal fast capture and optional details. | Four content fields stay distinct. Status claims a save only after its write completes. A save failure keeps recoverable visible writing and states the next action. | |
| 5. Leave and return | Navigate away and back, reload/relaunch after a confirmed save, then background and force-close a test phone around a later edit. | Saved writing returns exactly. Acknowledged draft writing is recoverable as unfinished. Text inside an unacknowledged debounce window is not promised durable. Record browser and physical process-death outcomes separately. | |
| 6. Move to app | Select the completed entry and separately the unfinished draft. Review both counts and private-field inclusion. Choose plain JSON; also exercise protected `.lwc` with a throwaway password. Open in the receiving app and preview; try a wrong password first. | Wrong password/tamper produces no storage change. Correct file preserves IDs, timestamps, kind, anchors, tags, provenance and separate fields. Draft stays unfinished. Download initiation never says “received by the app.” Envelope-metadata warning, if present, is visible; retain original file. | |
| 7. Confirm and repeat | Confirm the receiving import, then import the exact same file again. | Receipt describes actual saved/skipped counts. Same writing does not multiply. Compare entry and draft IDs/counts before/after. | |
| 8. Preserve a conflict | In a fixture copy change Notes while keeping its ID, export again, and preview/import. Repeat that changed file. | Explicit conflict behavior preserves both versions; timestamps do not silently choose a winner. Repeating the same conflict does not add another copy. Original personal writing remains intact. | |
| 9. Share deliberately | Open saved-entry sharing. Inspect text and PDF with all private options off, then enable one option at a time. Cancel the native sheets. | Reflection, Prayer and Provided notes default OFF. Only selected fields appear. Cancel reports ordinary cancellation and changes no journal data. Save synthetic output as evidence; do not send to another person. | |
| 10. Backup honestly | Export a complete app archive including entries and drafts; cancel once, then complete a write and reopen the file from its destination. | Cancellation/failure does not reset the reminder or claim a backup. Browser fallback says unverified download; completed provider write/close does not claim cloud sync. Record a verified readable archive hash. | |
| 11. Restore in isolation | Restore into a different empty test journal. Also try a damaged copy and a safely staged write failure against a populated synthetic journal. | Valid restore matches every field, metadata and draft; damaged/failed restore leaves the prior journal unchanged. Compare canonical records, not just visible titles. Original backup is retained. | |
| 12. Usability and sign-off | Ask testers to find unfinished writing, import church notes and back up without coaching. Traverse with keyboard, inspect dialog focus/return, enlarge text and use a narrow viewport; listen with a screen reader where available. | Clear names, visible focus/status, no keyboard trap or obscured controls, usable reflow. Record actual observations and assistance needed. Unrun assistive-technology checks remain unverified. | |

A church handout revision is **not** an automatic personal-entry update. Stable
publisher IDs and revisions have no implemented trust/update contract in this
milestone. Never replace personal annotations because a title or claimed church
name matches. If testing a changed handout, import it explicitly as new provided
material and review the effect before saving.

## Stop conditions and acceptance

Stop on missing acknowledged writing, false backup success, destructive failed
restore, silently overwritten personal content, duplicate multiplication,
private-field disclosure or fail-open App Lock. Preserve the synthetic fixture,
expected/actual counts, build SHA and screen recording; do not work around a
privacy or data-loss defect merely to finish the script.

Passing the browser portion is useful but does not satisfy the native release
hold. A release sign-off needs every applicable item in the Android/iPhone
physical-device matrix, including App Lock, populated upgrade and genuine native
provider/share behavior. Off-machine signing-key backup remains a separate gate.

| Evidence | Status / link | Tester / date |
| --- | --- | --- |
| Pastor draft → exported v1 file | | |
| Public HTTPS host + camera QR scan | | |
| Browser navigation/reload persistence | | |
| Physical process-death and draft recovery | | |
| Receiving app import, repeat and conflict receipts | | |
| Text/PDF private exclusions and native cancellation | | |
| Full archive and isolated restore comparison | | |
| Keyboard, reflow and real screen-reader observations | | |
| Mandatory Android/iPhone acceptance matrices | | |
