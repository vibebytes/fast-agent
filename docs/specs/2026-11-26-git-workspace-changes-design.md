# Git workspace changes: bounded discovery and file diff tabs

## Goals

1. Limit repository discovery to three directory levels below the workspace root.
2. Apply each repository's own root and nested `.gitignore` rules.
3. Open a dedicated Monaco diff tab when a changed file is clicked.

The conversation checkpoint diff drawer remains unchanged. The SCM view remains independent of `reviewDiffOn`.

## Repository discovery

The workspace root is depth 0. Discovery includes `.git` in the root, direct children, grandchildren, and great-grandchildren. A repository at depth 4 is not discovered. On this JDK, `walkFileTree` counts the root toward `maxDepth`, so the implementation passes 4 to include workspace descendants through depth 3.

Existing skipped directories (`.git`, `.fast`, `node_modules`, `target`, `dist`) and unreadable/broken repository isolation remain in place.

## Ignore semantics

Each discovered repository is evaluated independently with its own root and nested `.gitignore` files.

- Ignored untracked files are omitted.
- Tracked files remain visible when modified, even if they later match an ignore rule.
- Nested ignore rules are evaluated relative to the directory containing that `.gitignore`.
- No global filename-based ignore list is introduced.

## Diff data

Extend the existing `GetGitWorkspaceFileDiff` result with optional `original` and `modified` text fields.

- Modified file: HEAD blob versus working-tree text.
- Added/untracked file: empty original versus working-tree text.
- Deleted file: HEAD blob versus empty modified text.
- Unborn HEAD: empty original tree.
- Binary file: no text sides; show the binary notice.
- Text sides are UTF-8 and capped at 1 MiB per side. Hunks retain the existing 256 KiB / 4000-line limits.
- Any side or hunk cap sets `truncated`; the UI displays a warning and never presents partial content as a complete diff.

No new IPC command is required. Protocol fields remain optional for compatibility with older daemon responses.

## Diff tab flow

Reuse the existing `diff` rail-tab kind with an optional `repoPath` discriminator.

- Agent checkpoint tabs continue to use `changeId` and `ReviewDiffPane`.
- Git SCM tabs use `repoPath + filePath` and a new `GitDiffPane`.
- Git tab IDs are derived from both repository and file path, so nested repositories cannot collide and reopening a file reuses its tab.
- `ChangesPane` no longer expands inline diffs. Clicking a file row opens the Git diff tab.
- `GitDiffPane` lazily loads Monaco and calls the existing `window.fastIde.gitFileDiff` API.
- Loading, IPC failure, binary, empty-diff, and truncated states are rendered explicitly.

## TDD plan

1. Add daemon failing tests for depth 3 versus depth 4, root/nested ignores, tracked-but-ignored files, and original/modified sides for added, modified, deleted, unborn, binary, and truncated files.
2. Implement bounded discovery, ignore-aware behavior, and side extraction.
3. Add protocol tests for optional side fields.
4. Add UI failing tests proving a file click opens the Git diff tab with the correct Monaco sides, including nested repositories, without checkpoint review data.
5. Implement the tab flow and remove inline expansion.
6. Run the existing daemon, protocol, desktop-main, workbench, and typecheck suites.
