"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { WorldMap } from "@/app/world-map";
import { useYourTurnTitle } from "@/app/turn-banner";
import { countryByCode, resolveCountry } from "@/lib/countries";
import { playtestRules, type Empire2Action, type Empire2View, type Empire2ViewPlayer } from "@/lib/empire2-playtest";

export type Empire2Player = { id: string; name: string; host: boolean };

type GameProps = {
  view: Empire2View; players: Empire2Player[]; playerId: string; skewMs: number;
  notice: string; busy: boolean;
  onAction: (action: Empire2Action) => Promise<boolean>; onNotice: (text: string) => void; onEnd: () => void;
};
type ResultsProps = { view: Empire2View; players: Empire2Player[]; playerId: string; onDownloadLog: () => void; onLeave: () => void; notice?: string };

const NO_MATCH = "That doesn’t match a country on the list.";
const NOT_NOW = "You can't do that right now.";
const RANKS = ["1ST", "2ND", "3RD", "4TH"];
const NO_COLOR = "#9aa29b";

const countryName = (code: string) => countryByCode(code)?.name ?? code;
const roundText = (view: Empire2View) => `Round ${Math.min(view.round, view.roundCap)} of ${view.roundCap}`;

/** Banner text for the phase. The acting player is the picker in setup, the boom picker, or the turn player. */
function bannerOf(view: Empire2View, playerId: string, nameOf: (id: string | null) => string) {
  const actor = view.phase === "boomPick" ? view.boomPick?.playerId ?? null : view.phase === "ended" ? null : view.currentPlayerId;
  const mine = actor !== null && actor === playerId;
  const name = nameOf(actor);
  const title = view.phase === "capital" ? (mine ? "Pick your capital" : `${name} is picking a capital`)
    : view.phase === "foothold" ? (mine ? "Place your second foothold" : `${name} is placing a second foothold`)
    : view.phase === "boomPick" ? (mine ? "Pick this round's boom region" : `${name} is picking a boom`)
    : view.phase === "playing" ? (mine ? "Your turn" : `${name}'s turn`)
    : "Game over";
  const sub = view.phase === "capital" || view.phase === "foothold" ? "Setup" : roundText(view);
  return { title, sub, mine, actor };
}

/** Points and income lines for one player. Shared by the scoreboard and the results. */
function Breakdown({ player }: { player: Empire2ViewPlayer }) {
  const { vp, income } = player;
  return <div className="e2-breakdown">
    <span>Countries {player.countries}</span>
    <span>Cities {player.cities} · {vp.cities} points</span>
    {vp.regionSets.map((set) => <span key={set.region}>{set.region} set · {set.points} points</span>)}
    {vp.largestEmpire > 0 && <span>Largest empire · {vp.largestEmpire} points</span>}
    {income && <>
      <span>Last round's income {income.total}</span>
      <span>Base {income.base}, territory {income.territory}, cities {income.cities}, boom {income.boom}, underdog {income.underdog}</span>
    </>}
  </div>;
}

/** The rules, read from the playtest rules object so no number is typed here. */
function HowToPlay({ underdogBoomPick }: { underdogBoomPick: boolean }) {
  const rules = playtestRules(underdogBoomPick);
  return <details className="e2-how"><summary>How to play</summary><ul>
    <li>Setup: each player picks a capital from {rules.capitalOffers} offers, then a second country that doesn't border a rival. Everyone starts with {rules.startInfluence} influence.</li>
    <li>Each round: everyone collects influence. Then each player takes a turn. Players with fewer points go first and the leader goes last.</li>
    <li>Expand: take a free country next to your empire. Your first expand each turn is free. The second costs {rules.expandCost}. Up to {rules.maxExpandsPerTurn} a turn.</li>
    <li>Colonize: take any free country, anywhere, for {rules.colonizeCost}. If no free country touches your empire when your turn starts, your first colonize that turn costs {rules.colonizeReliefCost}.</li>
    <li>City: {rules.cityCost} influence, in a country you own. Up to {rules.maxCities} cities. A city pays {rules.cityIncome} influence a round and {rules.cityPoints} point.</li>
    <li>Annex: {rules.annexCost} influence. Take the capital of a rival's country that borders yours, if that rival has at least as many points as you. One annex a turn. Cities, starting countries and countries in a finished region can't be annexed.</li>
    <li>Income: {rules.baseIncome} base, plus 1 for every {rules.countriesPerTerritory} countries you own, {rules.cityIncome} per city, {rules.boomIncome} for each boom region you hold land in ({rules.boomCityIncome} with a city there). Players {rules.underdogGap} or more points behind the leader get {rules.underdogIncome} more.</li>
    <li>Bounties: each card names a kind of country. The first player to expand or colonize into one takes {rules.bountyPay} influence.</li>
    <li>Points: {rules.cityPoints} per city. A finished region gives 2 to 4 points, by size. The largest connected empire of at least {rules.largestEmpireMin} countries gives {rules.largestEmpirePoints} points.</li>
    <li>Winning: the first player with {rules.winPoints} points at the end of their own turn wins. A second turn in a row can't win on its second turn. After round {rules.roundCap} the most points wins, and ties go to more influence.</li>
    <li>Events: every {rules.eventEvery}th round a world event applies to the next round.</li>
    <li>Booms: {rules.boomRegionCount} regions boom each round. Owners of land there are paid.</li>
    {underdogBoomPick && <li>Boom pick: the player with the fewest points picks this round's boom region.</li>}
    <li>Time: each turn has a clock. When it runs out your turn ends.</li>
  </ul></details>;
}

/** The in-game screen for Empire 2.0: banner and clock, map, the action for this phase, then scores and log. */
export function Empire2Game({ view, players, playerId, skewMs, notice, busy, onAction, onNotice, onEnd }: GameProps) {
  const [, setTick] = useState(0);
  const clocked = view.deadline !== null;
  useEffect(() => {
    if (!clocked) return;
    const id = window.setInterval(() => setTick((tick) => tick + 1), 250);
    return () => window.clearInterval(id);
  }, [clocked]);
  const [country, setCountry] = useState("");
  const [capital, setCapital] = useState("");
  const [foothold, setFoothold] = useState("");

  const nameOf = (id: string | null) => view.players.find((entry) => entry.id === id)?.name ?? "Someone";
  const colorOf = (id: string | null) => view.players.find((entry) => entry.id === id)?.color ?? NO_COLOR;
  const me = view.players.find((entry) => entry.id === playerId);
  const host = players.find((entry) => entry.id === playerId)?.host === true;
  const { title, sub, mine, actor } = bannerOf(view, playerId, nameOf);
  useYourTurnTitle(mine);
  const seconds = view.deadline === null ? null : Math.max(0, Math.ceil((view.deadline - (Date.now() + skewMs)) / 1000));
  const influence = me?.influence ?? 0;
  const color = colorOf(actor);

  // Turn actions exist only for the turn player in phase "playing" (the view sends legal and costs only then).
  const act = view.phase === "playing" && mine && view.legal && view.costs ? { legal: view.legal, costs: view.costs } : null;
  const resolved = country.trim() ? resolveCountry(country) : null;
  const code = resolved?.code ?? null;
  const owner = code ? view.owners[code] : undefined;
  const affordable = (list: string[], cost: number | null) => Boolean(code && list.includes(code) && cost !== null && cost <= influence);
  const expandOk = act !== null && affordable(act.legal.expand, act.costs.expand);
  const colonizeOk = act !== null && affordable(act.legal.colonize, act.costs.colonize);
  const cityOk = act !== null && affordable(act.legal.city, act.costs.city);
  const annexOk = act !== null && affordable(act.legal.annex, act.costs.annex);
  const expandLabel = act === null || act.costs.expand === null ? "Expand" : act.costs.expand === 0 ? "Expand (free)" : `Expand (${act.costs.expand})`;
  let hint: string | null = null;
  if (act && code && !expandOk && !colonizeOk && !cityOk && !annexOk) {
    hint = act.costs.expand === null && view.frontier.includes(code) ? "You have used your expands this turn." : NOT_NOW;
  }

  // Setup: offers are sent to the picker only; footholds too. The foothold must be on the legal list.
  const offers = view.setup?.step === "capital" ? view.setup.offers : null;
  const footholds = view.setup?.step === "foothold" ? view.setup.footholds : null;
  const footholdResolved = foothold.trim() ? resolveCountry(foothold) : null;
  const footholdOk = Boolean(footholdResolved && footholds?.includes(footholdResolved.code));
  const boomRegions = view.phase === "boomPick" && view.boomPick && view.boomPick.playerId === playerId ? view.boomPick.regions : null;

  async function run(action: Empire2Action) {
    if (await onAction(action)) { setCountry(""); setCapital(""); setFoothold(""); }
  }
  function actOnCountry(build: (picked: string) => Empire2Action) {
    if (!code) { onNotice(NO_MATCH); return; }
    void run(build(code));
  }
  function submitFoothold(event: FormEvent) {
    event.preventDefault();
    if (busy || !foothold.trim()) return;
    if (!footholdResolved) { onNotice(NO_MATCH); return; }
    if (footholdOk) void run({ type: "pickFoothold", code: footholdResolved.code });
  }

  return <div className="e2-game">
    <div className="e2-main">
      <div className={mine ? "turn-banner mine e2-banner" : "turn-banner e2-banner"} style={mine ? { background: color, borderColor: color } : { borderLeftColor: color }}>
        <div className="e2-banner-text"><b className="turn-banner-text" style={mine ? undefined : { color }}>{title}</b><small>{sub}</small></div>
        {seconds !== null && <div className={seconds <= 10 ? "turn-clock urgent" : "turn-clock"} aria-label="Seconds left">{seconds}s</div>}
      </div>
      <WorldMap claims={view.owners} players={players} youId={playerId} heading="WORLD MAP" highlight={view.frontier} cities={view.cities}/>
      {view.phase !== "ended" && <p className="e2-legend">Outlined: next to your empire. Square: city.</p>}

      {offers && <section className="e2-panel" aria-label="Capital">
        <div className="aside-title">Capital</div>
        <div className="e2-buttons">{offers.map((offer) => <button type="button" className="primary" key={offer} disabled={busy} onClick={() => void run({ type: "pickCapital", code: offer })}>{countryName(offer)}</button>)}</div>
      </section>}
      {footholds && <form className="e2-panel" onSubmit={submitFoothold}>
        <input className="field turn-input active" style={{ "--pc": color } as React.CSSProperties} placeholder="Country name" aria-label="Country name" value={foothold} onChange={(event) => setFoothold(event.target.value)} readOnly={busy}/>
        <div className="e2-buttons"><button className="primary" disabled={busy || !foothold.trim() || (footholdResolved !== null && !footholdOk)}>Place foothold</button></div>
        {footholdResolved !== null && !footholdOk && <p className="e2-hint">{NOT_NOW}</p>}
      </form>}
      {boomRegions && <section className="e2-panel" aria-label="Boom region">
        <div className="aside-title">Boom region</div>
        <div className="e2-buttons">{boomRegions.map((region) => <button type="button" className="primary" key={region} disabled={busy} onClick={() => void onAction({ type: "pickBoom", region })}>{region}</button>)}</div>
      </section>}
      {act && <div className="e2-panel">
        <input className="field turn-input active" style={{ "--pc": color } as React.CSSProperties} placeholder="Country name" aria-label="Country name" value={country} onChange={(event) => setCountry(event.target.value)} readOnly={busy}/>
        {code && owner && <input className="field" placeholder="Capital of that country" aria-label="Capital" value={capital} onChange={(event) => setCapital(event.target.value)} readOnly={busy}/>}
        <div className="e2-buttons">
          <button type="button" className="primary" disabled={busy || !expandOk} onClick={() => actOnCountry((picked) => ({ type: "expand", code: picked }))}>{expandLabel}</button>
          <button type="button" className="primary" disabled={busy || !colonizeOk} onClick={() => actOnCountry((picked) => ({ type: "colonize", code: picked }))}>{`Colonize (${act.costs.colonize})${act.costs.relief ? " (stuck)" : ""}`}</button>
          <button type="button" className="primary" disabled={busy || !cityOk || !capital.trim()} onClick={() => actOnCountry((picked) => ({ type: "city", code: picked, capital: capital.trim() }))}>{`City (${act.costs.city})`}</button>
          <button type="button" className="primary" disabled={busy || !annexOk || !capital.trim()} onClick={() => actOnCountry((picked) => ({ type: "annex", code: picked, capital: capital.trim() }))}>{act.costs.annex === null ? "Annex" : `Annex (${act.costs.annex})`}</button>
          <button type="button" className="quiet" disabled={busy} onClick={() => void run({ type: "endTurn" })}>End turn</button>
        </div>
        {hint && <p className="e2-hint">{hint}</p>}
      </div>}
      {view.phase === "playing" && !mine && <p className="e2-wait">{`Waiting for ${nameOf(view.currentPlayerId)}.`}</p>}
      {notice && <p className="notice">{notice}</p>}
    </div>

    <aside className="e2-side">
      <div className="aside-title">Scores <b>{`Goal ${view.winPoints} points`}</b></div>
      {view.players.map((entry) => <div className="e2-score" key={entry.id} style={{ borderColor: entry.color }}>
        <div className="e2-score-head"><b style={{ color: entry.color }}>{entry.name}{entry.id === playerId ? " (you)" : ""}</b>{view.currentPlayerId === entry.id && <span className="e2-tag">Turn</span>}</div>
        <div className="e2-score-main"><span>{`${entry.influence} influence`}</span><strong>{`${entry.vp.total} points`}</strong></div>
        <details><summary>Details</summary><Breakdown player={entry}/></details>
      </div>)}
      {view.event && <p className="e2-line">{`Event: ${view.event}`}</p>}
      {view.booms.length > 0 && view.phase !== "boomPick" && <p className="e2-line">{`Booms: ${view.booms.join(", ")}`}</p>}
      {view.bounties.length > 0 && <p className="e2-line">{`Bounties: ${view.bounties.map((card) => card.label).join(", ")}`}</p>}
      {view.log.length > 0 && <section className="e2-recent"><div className="aside-title">Recent</div>{view.log.map((line, index) => <p key={index}>{line}</p>)}</section>}
      <HowToPlay underdogBoomPick={view.underdogBoomPick}/>
      {host && view.phase !== "ended" && <button type="button" className="quiet e2-end" disabled={busy} onClick={onEnd}>End game and show results</button>}
    </aside>
  </div>;
}

/** Headline for the result: winner, tie, cap, or host ended. */
function resultHeading(view: Empire2View, names: string[]) {
  const result = view.result;
  if (!result || names.length === 0) return "Results";
  const list = names.join(" and ");
  const one = names.length === 1;
  if (result.reason === "points") return one ? `${list} wins` : `${list} tie`;
  if (result.reason === "cap") return one ? `${list} wins on points after round ${view.roundCap}` : `${list} tie on points after round ${view.roundCap}`;
  return one ? `Ended early. ${list} leads` : `Ended early. ${list} are level`;
}

/** Final standings with each player's breakdown, the log download and the way back to the lobby. */
export function Empire2Results({ view, players, playerId, onDownloadLog, onLeave, notice }: ResultsProps) {
  const nameOf = (id: string) => players.find((entry) => entry.id === id)?.name ?? view.players.find((entry) => entry.id === id)?.name ?? "Someone";
  const winners = view.result?.winnerIds ?? [];
  const standings = [...view.players].sort((a, b) => b.vp.total - a.vp.total || b.influence - a.influence);
  return <div className="panel results e2-results">
    <h1>{resultHeading(view, winners.map(nameOf))}</h1>
    <p className="lede">{roundText(view)}</p>
    <div className="e2-board">{standings.map((entry, index) => <article className="e2-result" key={entry.id} style={{ borderLeft: `4px solid ${entry.color}`, paddingLeft: 12 }}>
      <small>{RANKS[index]}</small>
      <b>{entry.name}{entry.id === playerId ? " (you)" : ""}{winners.includes(entry.id) ? " · WINNER" : ""}</b>
      <strong>{`${entry.vp.total} points`}</strong>
      <span>{`Influence ${entry.influence}`}</span>
      <Breakdown player={entry}/>
    </article>)}</div>
    <div className="e2-buttons">
      <button type="button" className="quiet" onClick={onDownloadLog}>Download game log</button>
      <button type="button" className="primary" onClick={onLeave}>Back to lobby</button>
    </div>
    {notice && <p className="notice">{notice}</p>}
  </div>;
}
