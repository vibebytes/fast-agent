# fast — Domain Language (desktop conversation system)

Engine-side terms (Session / Run / Memory / Meta) live in `agent/CONTEXT.md`. This file covers the desktop app's conversation vocabulary. A **Run** here is one engine chat run surfaced as a Task's transcript turn; a **Turn** is the user-visible exchange (user message + assistant reply) that survives id remapping.

## Task
One conversation entry in the workspace sidebar. Owns a Transcript.

## Transcript
Main-process projection of one Task's conversation. Only `transcriptProjection.applyBridgeEvent` mutates it; renderer receives narrow patches and is a projection, never a second truth.

## Turn
A user-visible exchange. Identified by `turnId` and/or `clientMessageId`; the Engine may remap a client id to a server run id (`input_accepted`). Matching rules are owned by **TurnIdentity**, never inlined.

## Run
One engine execution under a Turn. Runs by kind `chat` paint stop chrome; Goal structured turns do not.

## Composer Gate
Pure derivation over transcript chrome that decides what the composer may do (submit / enqueue / cancel). ADR-0007: gate math is pure here; the host owns timers.

## RunChrome
The current Run's stop-chrome lifecycle: `idle → activeRun → cancelPending → postRunTerminal → idle`. One state machine; settle (seal rows, clear wait, drop stop chrome) happens in a single transition. Superseded markers, wait state and document ids are NOT part of RunChrome.

## TurnIdentity
The only place that answers "does this id identify this Turn/Run": id kinds (`client` / `server-run` / `goal` / `sched`), cross-id matching, and the `input_accepted` remap. Used by transcriptProjection, composerGate, timeline, SessionPane and SessionController.

## Approval / Question
Engine consent requests pinned to a run's chrome; they resolve (approve/deny/answer) through TaskCommands and seal their row.
