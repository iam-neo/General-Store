# Antigravity Persistent Project Memory & Incremental Workflow

**Location:** `.agents/rules/agent-workflow.md`  
**Applies To:** Workspace Antigravity Agents & Sessions  
**Project:** General Store Management System  

---

## Mandatory Incremental Development Workflow

Every new development task must strictly follow this 12-step sequence. Do NOT perform full-repository audits on each invocation:

1. **Read Memory First**: Inspect [`PROJECT_CONTEXT.md`](file:///d:/1%20project/0codes/Project_neo/general-store/PROJECT_CONTEXT.md) and [`docs/PROJECT_STATUS.md`](file:///d:/1%20project/0codes/Project_neo/general-store/docs/PROJECT_STATUS.md) first to establish the verified baseline.
2. **Review Recent History & Decisions**: Read the recent entries in [`docs/PHASE_LOG.md`](file:///d:/1%20project/0codes/Project_neo/general-store/docs/PHASE_LOG.md) and architectural decisions in [`docs/DECISIONS.md`](file:///d:/1%20project/0codes/Project_neo/general-store/docs/DECISIONS.md).
3. **Inspect Git Working Tree**: Run `git status` before touching files to see untracked/modified changes.
4. **Identify Exact Scope**: Determine the exact task scope, input/output requirements, and relevant modules from the resume guide in `PROJECT_STATUS.md`.
5. **Inspect Only Necessary Code**: View only the specific files directly relevant to the assigned task. Avoid full-repository scans.
6. **Reuse Existing Conventions**:
   - Currency: strictly **integer Paisa** (`100 Paisa = 1 NPR`). Never use floating-point currency.
   - IDs: strictly **UUID v4** strings. Never use spreadsheet row numbers.
   - Idempotency: require `idempotency_key` on mutating operations.
   - Security: credentials and secrets remain strictly server-side (no `NEXT_PUBLIC_` secrets).
   - Localization: support bilingual English (`en`) and Nepali (`ne`) messages.
   - Dates: dual storage with Gregorian ISO UTC and Nepali Bikram Sambat (BS).
7. **Do Not Repeat Completed Work**: Do not re-audit or rewrite verified phases unless a concrete bug requires modification.
8. **Preserve Surrounding Architecture**: Never modify unrelated files or change system architecture without explicit justification.
9. **Execute Relevant Tests**: Run `npm test` and the relevant verification commands (`npx tsc --noEmit`, `npm run lint`, `npm run build` when applicable).
10. **Update Persistent Memory Files**: Keep memory files synchronized before ending the turn:
    - Update [`docs/PROJECT_STATUS.md`](file:///d:/1%20project/0codes/Project_neo/general-store/docs/PROJECT_STATUS.md) with latest state and test results.
    - Append milestone details to [`docs/PHASE_LOG.md`](file:///d:/1%20project/0codes/Project_neo/general-store/docs/PHASE_LOG.md).
    - Record any new architectural decision in [`docs/DECISIONS.md`](file:///d:/1%20project/0codes/Project_neo/general-store/docs/DECISIONS.md).
11. **Document Exact Status**: Record actual execution results, failures, skipped tests, and live integration status (`VERIFIED`, `MOCK ONLY`, `NOT TESTED`).
12. **State Exact Next Task**: Always conclude with the exact next task and acceptance criteria so another session can resume immediately.

---

## End-of-Task Handoff Protocol

At the completion of every task or phase, provide a structured handoff containing:
1. **Task Completed**: Concise statement of what was accomplished.
2. **Files Changed / Created**: List of modified or created file paths.
3. **Tests Executed & Actual Results**: Actual pass/fail counts and terminal outputs.
4. **Outstanding Issues & Blockers**: Any unresolved bugs or technical questions.
5. **Memory Files Updated**: Confirmation of updates to `PROJECT_STATUS.md`, `PHASE_LOG.md`, and `DECISIONS.md`.
6. **Git Working Tree Status**: Summary of modified or untracked files.
7. **Recommended Next Task**: Precise next step, expected acceptance criteria, and suggested starting prompt for the user.
