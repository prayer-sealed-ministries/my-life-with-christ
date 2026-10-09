# Share This Entry — manual acceptance on iPhone

Why this is manual: XCUITest cannot scroll the app's web view on a device
(measured three ways — see `ios/App/ShareUITests/ShareAcceptanceUITests.swift`).
The simulator test verifies keyboard ownership and successfully enters the
Title, Notes and Reflection markers. It then explicitly skips when Prayer is
below the reachable viewport; Save, **Share this entry**, the share surface and
the system share sheets are lower still. Unit, view and parsed-PDF tests cover
the private-content defaults and generated content. This procedure covers the
native interactions those tests cannot reach.

Use **synthetic content only**. Nothing here should touch a real entry.

---

## Setup

Write one throwaway entry so there is something unmistakable to look for.

1. **New sermon note.** Home → **Sermon note**. Fill in:
   - Title: `ZZSHARE-TITLE`
   - Notes: `ZZSHARE-NOTES`
   - Reflection: `ZZSHARE-REFLECTION`
   - Details → Prayer: `ZZSHARE-PRAYER`
   - *What this entry is about* → **A verse** → John, chapter 3, verse 16 →
     **Add verse**. Then verse 16, **To verse** 18 → **Add verse**.
   - **Save.**

## The checks

2. **Open the share surface.** Scroll to **Share this entry** and tap it.

3. **Privacy defaults — the important one.** Without touching any switch,
   confirm all three are **OFF**:
   - **My reflection** ☐
   - **Prayer** ☐
   - **Provided notes** ☐

   If any is already on, stop and say so — that is a privacy regression, not a
   test failure.

4. **Read the preview** under *What will be sent*. It must contain:
   - `ZZSHARE-NOTES`
   - `John 3:16` (and `John 3:16-18`)

   and must **not** contain:
   - `ZZSHARE-REFLECTION`
   - `ZZSHARE-PRAYER`

5. **Share as text.** Tap **Share as text**.
   - The iOS share sheet appears.
   - The preview at the top of the sheet shows the notes, not the reflection or
     the prayer.
   - Tap **Cancel** (or swipe the sheet down).
   - Back in the app: no error message, the entry is unchanged, the share
     surface is still open. **Do not send it to anyone.**

6. **Share as PDF.** Tap **Share as PDF**.
   - The iOS share sheet appears (the button reads *Preparing…* briefly first).
   - Tap the document thumbnail at the top of the sheet to preview the PDF —
     or **Save to Files**, then open it from the Files app.
   - The PDF must contain `ZZSHARE-TITLE`, `ZZSHARE-NOTES` and `John 3:16`,
     and must **not** contain `ZZSHARE-REFLECTION` or `ZZSHARE-PRAYER`.
   - Cancel the sheet. Again: no error, app returns normally.

7. **Turn the switches on and re-check.** Tick **My reflection** and
   **Prayer**. The preview should now include both markers — proving they were
   withheld by choice in step 4, not missing by accident.

8. **Clean up.** **Cancel** the share surface, then **Delete this entry** →
   **Yes, delete it**. Confirm no `ZZSHARE` entry or draft is left on the home
   screen under *Unfinished writing*.

---

## What a failure looks like

- Any of the three switches **on** by default → privacy regression, report it.
- Reflection or prayer text in the preview, the share sheet, or the PDF while
  its switch is off → privacy regression, report it.
- An error message after cancelling → a dismissed share sheet is an ordinary
  outcome and must produce no apology.
