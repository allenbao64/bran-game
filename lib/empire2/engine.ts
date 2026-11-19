import { applyPlayAction } from "./actions";
import { applySetupAction } from "./setup";
import { engineError } from "./state";
import type { Action, ActionResult, Ctx, EmpireState, PlayerId } from "./types";

/** Single entry point: routes by phase. Never throws on bad input (section 13.2). */
export function applyAction(state: EmpireState, playerId: PlayerId, action: Action, ctx: Ctx): ActionResult {
  if (state.phase === "finished") return engineError("gameOver");
  if (typeof action !== "object" || action === null) return engineError("unknownAction");
  if (state.phase === "setup") return applySetupAction(state, playerId, action, ctx);
  // Setup-only types (pickCapital, pickFoothold) sent during play are routed to applyPlayAction, which returns
  // wrongPhase for them. On a setup state, non-pick types (e.g. endTurn) return unknownAction from applySetupAction.
  // wrongPhase on a setup state comes only from calling a play handler directly, not from this dispatcher.
  return applyPlayAction(state, playerId, action, ctx);
}
