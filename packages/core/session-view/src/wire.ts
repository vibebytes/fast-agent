/**
 * Desktop Bridge UI wire — single source for IPC data shapes and channel maps.
 * Domain Transcript / Gate types are re-used by name (no *Payload aliases).
 */

export type * from './wire/session.js';
export {dshGoalFromEvent} from './wire/session.js';
export type * from './wire/desktop.js';
export type * from './wire/invoke.js';
