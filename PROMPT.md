# Project: TabletOrderApp

---

## Goal
[High-level project goal - what we're trying to achieve]

---

## Task (Current Work)
[Specific task for this session - clear and actionable]

---

## Definition of Done
- [ ] [Testable criteria 1]
- [ ] [Testable criteria 2]
- [ ] Tests pass (if applicable)
- [ ] STATUS.md updated with final state
- [ ] DONE_SIGNAL set to COMPLETE

---

## Loop Behavior (Claude Code / Ralph Mode)

### You are in LOOP MODE
When running in Ralph harness or autonomous loop:

**Update STATUS.md EVERY iteration:**
- Current focus
- Progress made
- Files touched
- Verification status
- Loop stats (iterations, token estimate)

**Stop conditions (exit loop when ANY of these occur):**
1. DONE_SIGNAL: COMPLETE in STATUS.md
2. "Ask Brian" section is populated with a question
3. Maximum iterations reached (15)
4. Unrecoverable error encountered
5. Blocked for 3+ consecutive iterations

**When blocked:**
- Set DONE_SIGNAL: BLOCKED
- Write specific question in "Ask Brian" section
- Explain what you tried and why it didn't work
- Suggest next action if you could continue

**When complete:**
- Run all verification steps (tests, build, manual checks)
- Update STATUS.md with final state
- Set "Ready for Review: Yes" if code review needed
- Set DONE_SIGNAL: COMPLETE
- Summarize what was accomplished

---

## Code Review Protocol (Codex Only)

### When Brian asks you to review:

**Step 1: Read STATUS.md**
- Understand the goal and current focus
- Check "Files touched" section
- Read "Progress since last update"

**Step 2: Review the code**
- Read the files listed in "Files touched"
- Look for:
  - Logic errors or bugs
  - Edge cases not handled
  - Security vulnerabilities
  - Performance issues
  - Code clarity / maintainability
  - Missing error handling
  - Hard-coded values that should be configurable

**Step 3: Write feedback in STATUS.md**
- Add feedback to "Review Notes" section
- Be specific: include file:line references
- Provide concrete suggestions for fixes
- Prioritize: critical issues first, then suggestions

**Step 4: Set review flag**
- Check "Ready for Review: No" after providing feedback
- Brian will pass feedback to Claude Code for fixes

---

## Working Agreement (Multi-Agent Contract)

### Roles
- **Claude Code** = Primary builder, runs loops, implements features
- **Codex** = Code reviewer, provides feedback, manual invocation only
- **STATUS.md** = Shared truth surface, updated by both agents
- **Brian** = Decision maker, task assigner, final authority

### Coordination Rules
1. **Read STATUS.md BEFORE starting work**
   - Understand current state
   - Check if another agent is working
   - Don't assume you know the state

2. **Update STATUS.md WHILE working**
   - After every meaningful change
   - Before asking Brian a question
   - When setting DONE_SIGNAL

3. **No concurrent writes to same files**
   - Claude Code writes code
   - Codex writes review feedback
   - If conflict, ask Brian

4. **Default: Claude Code works, Codex reviews**
   - Don't both try to fix the same thing
   - Review happens AFTER implementation
   - Implementation happens AFTER review feedback

---

## Context for This Project

### Tech Stack
[List the technologies used: languages, frameworks, tools]

### Key Files / Structure
[Outline the important files or directories agents should be aware of]

### Testing Strategy
[How to run tests, what passing looks like]

### Build / Deployment
[How to build, where it deploys, what "working" looks like]

---

## Brian's Preferences (from CLAUDE.md)

**Communication:**
- Bullets over paragraphs
- One step at a time
- Clear endpoints
- Scannable formatting

**Problem solving:**
- Work backwards from goals
- Fix properly, don't pivot to workarounds
- Verify data before claiming completion

**ADHD-friendly:**
- Clear progress tracking
- Batch work when possible
- Celebrate small wins
- Don't overwhelm with detail

---

## Notes / Context
[Any additional project-specific context, gotchas, or important info]

---
