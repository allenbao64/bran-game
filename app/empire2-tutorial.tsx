"use client";

import React, { useEffect, useRef, useState } from "react";
import { WorldMap } from "@/app/world-map";
import { countryByCode, resolveCountry } from "@/lib/countries";
import { empire2Geo } from "@/lib/empire2/geo-adapter";
import { frontier, ownedBy } from "@/lib/empire2/state";
import type { Action, EmpireState } from "@/lib/empire2/types";
import {
  ME, RIVAL, TUTORIAL_CTX, TUTORIAL_STEPS, createTutorialState, markTutorialSeen, runScriptedStep, type TutorialStep,
} from "@/lib/empire2-tutorial";

type Snapshot = { state: EmpireState; step: number };

const SHOW_MS = 800;
const NO_MATCH = "That doesn’t match a country on the list.";
const TYPE_CAPITAL_FIRST = "Type its capital city first, then press the button.";
const PLAYERS = [{ id: ME, name: "You" }, { id: RIVAL, name: "Rival" }];
const nameOf = (code: string) => countryByCode(code)?.name ?? code;

/** True when the viewer asked for reduced motion. Storage-free and guarded: matchMedia may be missing. */
function reducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

function actionFor(step: TutorialStep, code: string, capital: string): Action | null {
  switch (step.kind) {
    case "expand": return { type: "expand", code };
    case "settle": return { type: "colonize", code };
    case "stronghold": return { type: "city", code, capital };
    case "takeOver": return { type: "annex", code, capital };
    case "endTurn": return { type: "endTurn" };
    default: return null;
  }
}

/** The practice game: seven steps on the real engine, each with a demo, a hint on a wrong move, Back and Skip. */
export function Empire2Tutorial({ onClose }: { onClose: () => void }) {
  const [stack, setStack] = useState<Snapshot[]>(() => [{ state: createTutorialState(), step: 0 }]);
  const [name, setName] = useState("");
  const [capital, setCapital] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [showing, setShowing] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const top = stack[stack.length - 1];
  const { state, step } = top;
  const done = step >= TUTORIAL_STEPS.length;
  const current: TutorialStep | null = done ? null : TUTORIAL_STEPS[step];
  const reduced = reducedMotion();

  function push(next: EmpireState) {
    setStack((s) => [...s, { state: next, step: s[s.length - 1].step + 1 }]);
    setName("");
    setCapital("");
    setHint(null);
  }
  function attempt(action: Action) {
    if (!current || current.kind === "intro" || showing) return;
    const r = runScriptedStep(state, current, action, TUTORIAL_CTX);
    if (!r.ok) {
      // Typing the answer comes first: an empty capital is reported as a missing answer, not a wrong one.
      setHint(!capital.trim() && r.code === "wrongCapital" ? TYPE_CAPITAL_FIRST : r.hint);
      return;
    }
    push(r.state);
  }
  function pick(code: string) {
    if (!current || current.kind === "intro" || done || showing) return;
    setName(nameOf(code));
    const action = actionFor(current, code, capital.trim());
    if (action) attempt(action);
  }
  function submitName() {
    if (!current || !name.trim()) return;
    const resolved = resolveCountry(name);
    if (!resolved) { setHint(NO_MATCH); return; }
    const action = actionFor(current, resolved.code, capital.trim());
    if (action) attempt(action);
  }
  function showMe() {
    const cur = current;
    if (!cur?.script || showing) return;
    const script = cur.script;
    const play = () => {
      const r = runScriptedStep(state, cur, script, TUTORIAL_CTX);
      setShowing(false);
      if (r.ok) push(r.state); else setHint(r.hint);
    };
    if (reduced) { play(); return; }
    setShowing(true);
    timer.current = window.setTimeout(play, SHOW_MS);
  }
  function back() {
    if (stack.length < 2 || showing) return;
    setStack((s) => s.slice(0, -1));
    setName("");
    setCapital("");
    setHint(null);
  }
  function finish() {
    markTutorialSeen();
    onClose();
  }

  const targetName = current?.target ? nameOf(current.target) : null;
  const lit = current?.kind === "expand" ? frontier(state, ME, empire2Geo)
    : current?.kind === "stronghold" ? ownedBy(state, ME)
    : [];
  const typed = current !== null && (current.kind === "expand" || current.kind === "settle" || current.kind === "stronghold" || current.kind === "takeOver");
  const needsCapital = current?.needsCapital === true;
  const canSubmit = typed && name.trim() !== "" && (!needsCapital || capital.trim() !== "") && !showing;

  return <div className="e2-tut-backdrop">
    <section className="e2-tut" role="dialog" aria-modal="true" aria-labelledby="e2-tut-title">
      <div className="e2-tut-top">
        <span className="e2-tut-count">{done ? "Done" : `Step ${step + 1} of ${TUTORIAL_STEPS.length}`}</span>
        <button type="button" className="quiet" onClick={finish}>Skip</button>
      </div>
      <div className={showing ? "e2-tut-map e2-tut-showing" : "e2-tut-map"}>
        <WorldMap claims={state.owners} players={PLAYERS} youId={ME} heading="PRACTICE MAP" compact
          highlight={showing && current?.target ? [...lit, current.target] : lit}
          targets={current?.target ? [current.target] : undefined}
          onCountryPick={done ? undefined : pick}/>
      </div>

      {done ? <>
        <h2 id="e2-tut-title">That&apos;s the basics</h2>
        <p>Start a game when you&apos;re ready.</p>
        <div className="e2-buttons">
          <button type="button" className="quiet" onClick={back}>Back</button>
          <button type="button" className="primary" onClick={finish}>Close</button>
        </div>
      </> : current && <>
        <h2 id="e2-tut-title">{current.heading}</h2>
        <p>{current.text}</p>
        {targetName && <p className="e2-tut-target">{`Next: ${targetName}`}</p>}
        {typed && <div className="e2-tut-inputs">
          <input className="field" placeholder="Country name" aria-label="Country name" value={name} disabled={showing}
            onChange={(event) => setName(event.target.value)}/>
          {needsCapital && <input className="field" placeholder="Type its capital city (real-world)" aria-label="Capital city (real-world)" value={capital} disabled={showing}
            onChange={(event) => setCapital(event.target.value)}/>}
        </div>}
        <p role="status" className="e2-hint">{hint ?? ""}</p>
        <div className="e2-buttons">
          <button type="button" className="quiet" disabled={stack.length < 2 || showing} onClick={back}>Back</button>
          {current.kind === "intro" && <button type="button" className="primary" onClick={() => push(state)}>Next</button>}
          {current.script && <button type="button" className="quiet" disabled={showing} onClick={showMe}>Show me</button>}
          {current.kind === "endTurn" && <button type="button" className="primary" disabled={showing} onClick={() => attempt({ type: "endTurn" })}>{current.button}</button>}
          {typed && <button type="button" className="primary" disabled={!canSubmit} onClick={submitName}>{current.button}</button>}
        </div>
      </>}
    </section>
  </div>;
}
