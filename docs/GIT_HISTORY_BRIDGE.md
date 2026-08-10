# Protected `main`/`dev` history bridge

This runbook repairs the one-time repository initialization split in which
`main` and `dev` exist but GitHub cannot compute a merge base. It applies to
both canonical public repositories:

| Repository                   | Preserved pre-OpenGrow `main`                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `mbzadev/opengrow-platform`  | `audit/pre-opengrow-main-b633af5ac8d5` at `b633af5ac8d523a36b9fe0e9ea6e83d2da2cf377` |
| `mbzadev/opengrow-reference` | `audit/pre-opengrow-main-729eaf47b2dd` at `729eaf47b2dd061d2be9e01df37b00dc4f0bb490` |

The audit refs retain the independently initialized GitHub README histories.
They are evidence and recovery refs; never move, delete or reuse them.

## Generate the exact plan

Run the planner from a clean Platform checkout:

```bash
npm run github:history:bridge:plan
```

The command fetches remote-tracking refs and emits one structured,
non-mutating procedure for each repository. It exits non-zero while a bridge is
required. Each procedure contains the exact remote `main` and `dev` SHAs, audit
ref, isolated bridge branch name, ordered parents, expected tree and protection
controls. It does not commit, merge, create a branch, push, change protection or
open a pull request.

Do not copy a `dev` SHA from this document. Use only the SHA in the latest plan
and regenerate the plan immediately before every authorized step.

## Why an ordinary pull request is insufficient

A squash or rebase from unrelated `dev` into `main` copies content but does not
make the `dev` commit reachable from `main`; GitHub will still have no merge
base. The bridge must retain a commit with two parents:

1. exact remote `dev` as first parent;
2. exact remote `main` as second parent;
3. a tree byte-for-byte identical to exact remote `dev`.

Creating that commit from `dev` with Git's `ours` merge strategy joins the
histories without importing the obsolete README tree. The original `main`
content and commit remain reachable through the second parent and immutable
audit ref.

## Local preparation in an isolated checkout

This phase needs its own clean clone or Git worktree. It must not run in a
working copy used for another release. Execute only the `localPreparation`
commands emitted by the exact plan, then verify all of these invariants before
any push:

- the bridge commit parents, in order, are the planned `dev` SHA and planned
  `main` SHA;
- the bridge commit tree equals the planned `dev` tree;
- the planned audit branch still equals the planned original `main` SHA;
- current remote `main` and `dev` still equal the planned SHAs;
- the bridge branch contains no additional commit or working-tree change;
- Gitleaks and the aggregate repository CI pass on the exact bridge commit.

If any invariant changes, discard only the local bridge branch and regenerate
the plan. Never resolve drift with force-push, reset of a remote branch, or a
new audit ref.

## Protected remote procedure

The current repositories are squash-only and enforce linear history. Those
settings correctly reject the required two-parent bridge, so the bridge uses a
bounded, reviewed maintenance window:

1. Push only the dedicated bridge branch. Do not push directly to `main`.
2. Open a pull request from the bridge branch into `main` and bind its
   description to the exact plan SHAs and audit ref.
3. Require the aggregate CI gate, secret scan and an independent CODEOWNER
   approval. If no independent reviewer exists, add one before the window; do
   not reduce the approval count to zero.
4. Capture the complete pre-window repository and `main` protection settings.
5. Temporarily enable merge commits and disable required linear history for
   `main` only. Keep required pull requests, required checks, stale-review
   dismissal, CODEOWNER approval, administrator enforcement, conversation
   resolution, force-push denial and deletion denial enabled.
6. Merge the reviewed pull request with a merge commit. Squash and rebase are
   forbidden for this one operation because they discard the ancestry bridge.
7. Verify that the new remote `main` contains both planned source SHAs, that its
   checked-out tree equals the reviewed `dev` tree, and that GitHub now returns
   a `main...dev` merge base.
8. Immediately restore squash-only repository merges and required linear
   history, then compare every protection field with the captured settings.
9. Delete only the merged bridge branch. Keep the audit branch permanently.
10. Rerun `npm run github:history:plan -- --fetch`,
    `npm run github:readiness:remote` and
    `npm run platform:readiness:remote`. All three must report connected branch
    history before any `main` production deployment is authorized.

Platform and Reference use separate plans, branches, pull requests and
maintenance windows. Never bridge both repositories through one unchecked
script or one shared confirmation.

## Stop and rollback rules

Before merge, rollback is closing the pull request and deleting only the
dedicated bridge branch. After merge, do not force-reset `main`: stop production
deployment, preserve the exact merge evidence and restore protection settings.
The pre-OpenGrow audit branch remains available for forensic recovery, while a
forward corrective pull request preserves all reviewed history.
