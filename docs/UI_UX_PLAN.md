# Tablet UI/UX Backlog (Post-Urgency Timers)

## Story 2 — Auto‑Archive Completed + Recall Window
**User story:** As a kitchen user, I want completed orders to disappear after X hours but still be recallable for a short window.

**Tasks**
1. Add settings: `autoArchiveCompleted` (toggle), `archiveAfterHours`, `recallWindowMinutes`.
2. Implement client-side filter: hide completed/cancelled orders past threshold.
3. Add “Recall Last X min” action in Completed header.
4. Optional: “Archived” drawer/list view for last 24h.
5. QA: complete → auto hide → recall restores.

## Story 3 — Layout Controls (Text Size + Density)
**User story:** As a kitchen user, I want to adjust text size and card density so the screen fits my kitchen’s workflow and distance.

**Tasks**
1. Add settings: `textSize` (S/M/L), `cardDensity` (compact/normal).
2. Apply text size to collapsed + expanded card typography.
3. Apply density to paddings/margins + row height (cards + columns).
4. QA: verify tap targets remain >= 44px.
