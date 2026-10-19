"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countryByCode, resolveCountry } from "@/lib/countries";
import { playerColor } from "@/lib/player-colors";
import { resolveChampion } from "@/lib/champions";
import { resolveOverwatchHero } from "@/lib/overwatch-heroes";
import { GAME_CATALOG, gameConfig, type GameId } from "@/lib/games";
import { WorldMap } from "@/app/world-map";
import { TurnsGame, type ClaimLogEntry, type ScoreView, type TurnView } from "@/app/turns-game";
import { ResultsReplay } from "@/app/replay";
import { EmpireGame, EmpireResults, type EmpireAction, type EmpireView } from "@/app/empire-game";

type Player = { id: string; name: string; host: boolean };
type Answer = { code: string; name: string };
type Result = { playerId: string; name: string; guesses: Answer[]; points?: number; bonuses?: { label: string; points: number }[]; bonusTotal?: number; total?: number };
type Award = { id: string; title: string; playerId: string; detail: string };
type Mode = "live" | "turns" | "empire";
type Room = { code: string; token: string; gameId: GameId; mode: Mode; status: "waiting" | "playing" | "ended"; startedAt: number | null; players: Player[] };
type Stage = "home" | "lobby" | "game" | "results";
const ROOM_KEY = "bran-game-room";
const BUILD_VERSION = process.env.NEXT_PUBLIC_GAME_VERSION ?? "local";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
  return data as T;
}
function timeText(seconds: number) {
  const n = Math.max(0, seconds);
  return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("home");
  const [selectedGame, setSelectedGame] = useState<GameId>("countries");
  const [selectedMode, setSelectedMode] = useState<Mode>("live");
  const [turn, setTurn] = useState<TurnView | null>(null);
  const [empire, setEmpire] = useState<EmpireView | null>(null);
  const [scores, setScores] = useState<Record<string, ScoreView>>({});
  const [claimLog, setClaimLog] = useState<ClaimLogEntry[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [skewMs, setSkewMs] = useState(0);
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerId, setPlayerId] = useState("");
  const [guesses, setGuesses] = useState<Answer[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [countryClaims, setCountryClaims] = useState<Record<string, string>>({});
  const [entry, setEntry] = useState("");
  const [left, setLeft] = useState(GAME_CATALOG.countries.durationSeconds);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const activeGame = gameConfig(room?.gameId ?? selectedGame);

  const sync = useCallback(async (code: string, token: string) => {
    const data = await api<{
      code: string; gameId?: GameId; mode?: Mode; status: Room["status"]; startedAt: number | null;
      players: Player[]; playerId: string; myGuesses: Answer[]; countryClaims?: Record<string, string>; results?: Result[];
      turn?: TurnView; empire?: EmpireView | null; scores?: Record<string, ScoreView>; claimLog?: ClaimLogEntry[]; awards?: Award[];
    }>(`/api/room?code=${encodeURIComponent(code)}`, { headers: { Authorization: `Bearer ${token}` } });
    const gameId = data.gameId ?? "countries";
    const mode: Mode = data.mode === "turns" || data.mode === "empire" ? data.mode : "live";
    setRoom({ code: data.code, token, gameId, mode, status: data.status, startedAt: data.startedAt, players: data.players });
    setSelectedMode(mode);
    if (data.turn) { setTurn(data.turn); setSkewMs(data.turn.serverNow - Date.now()); }
    else setTurn(null);
    if (data.empire) { setEmpire(data.empire); setSkewMs(data.empire.serverNow - Date.now()); }
    else setEmpire(null);
    setScores(data.scores ?? {}); setClaimLog(data.claimLog ?? []); setAwards(data.awards ?? []);
    setSelectedGame(gameId); setPlayers(data.players); setPlayerId(data.playerId); setGuesses(data.myGuesses); setCountryClaims(data.countryClaims ?? {});
    if (data.status === "ended") { setResults(data.results ?? []); setStage("results"); }
    else setStage(data.status === "playing" ? "game" : "lobby");
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(ROOM_KEY);
    if (!saved) return;
    try {
      const session = JSON.parse(saved) as { code: string; token: string; playerId: string; name: string };
      setName(session.name);
      void sync(session.code, session.token).catch((error) => setNotice(errorText(error)));
    } catch { localStorage.removeItem(ROOM_KEY); }
  }, [sync]);

  useEffect(() => {
    if (!room || (stage !== "lobby" && stage !== "game")) return;
    const id = window.setInterval(() => {
      void sync(room.code, room.token).catch((error) => setNotice(errorText(error)));
    }, room.mode === "turns" || room.mode === "empire" ? 800 : 1600);
    return () => window.clearInterval(id);
  }, [room?.code, room?.token, room?.mode, stage, sync]);

  useEffect(() => {
    if (stage !== "game" || !room?.startedAt) return;
    const duration = gameConfig(room.gameId).durationSeconds;
    const tick = () => setLeft(Math.max(0, duration - Math.floor((Date.now() - room.startedAt!) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [stage, room?.startedAt, room?.gameId]);

  useEffect(() => { if (stage === "game") input.current?.focus(); }, [stage]);

  async function startRoom(event: FormEvent, action: "create" | "join") {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice("");
    try {
      const code = joinCode.trim().toUpperCase();
      const saved = action === "join" ? localStorage.getItem(ROOM_KEY) : null;
      if (saved) {
        const session = JSON.parse(saved) as { code: string; token: string; playerId: string; name: string };
        if (session.code === code) {
          await sync(session.code, session.token);
          return;
        }
      }
      const data = await api<{
        code: string; gameId?: GameId; mode?: Mode; token: string; playerId: string; status: Room["status"];
        startedAt: number | null; players: Player[];
      }>("/api/room", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name: name.trim(), code, ...(action === "create" ? { gameId: selectedGame, ...(selectedGame === "countries" ? { mode: selectedMode } : {}) } : {}) })
      });
      const gameId = data.gameId ?? "countries";
      const session = { ...data, name: name.trim() };
      localStorage.setItem(ROOM_KEY, JSON.stringify(session));
      setJoinCode(data.code);
      const mode: Mode = data.mode === "turns" || data.mode === "empire" ? data.mode : "live";
      const nextRoom: Room = { code: data.code, token: data.token, gameId, mode, status: data.status, startedAt: data.startedAt, players: data.players };
      setRoom(nextRoom); setSelectedGame(gameId); setSelectedMode(mode); setTurn(null); setEmpire(null); setScores({}); setClaimLog([]); setAwards([]); setPlayers(data.players); setPlayerId(data.playerId); setGuesses([]); setResults([]); setCountryClaims({});
      setStage(data.status === "playing" ? "game" : "lobby");
    } catch (error) { setNotice(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function startRound() {
    if (!room || busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice("");
    try {
      const data = await api<{ status: Room["status"]; startedAt: number; players: Player[] }>("/api/room", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", code: room.code, token: room.token, name })
      });
      const nextRoom: Room = { ...room, status: data.status, startedAt: data.startedAt, players: data.players };
      setRoom(nextRoom); setPlayers(data.players); setLeft(gameConfig(room.gameId).durationSeconds);
      if (room.mode === "turns" || room.mode === "empire") await sync(room.code, room.token); else setStage("game");
    } catch (error) { setNotice(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function endRound() {
    if (!room || busyRef.current || !window.confirm("End the round now and reveal everyone’s answers?")) return;
    busyRef.current = true; setBusy(true); setNotice("");
    try {
      await api("/api/room", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", code: room.code, token: room.token, name })
      });
      await sync(room.code, room.token);
    } catch (error) { setNotice(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function submitGuess(event: FormEvent) {
    event.preventDefault();
    if (!room || !entry.trim()) return;
    const answer = room.gameId === "champions" ? resolveChampion(entry)
      : room.gameId === "overwatch" ? resolveOverwatchHero(entry) : resolveCountry(entry);
    const answerType = room.gameId === "champions" ? "champion" : room.gameId === "overwatch" ? "hero" : "country";
    if (!answer) { setNotice(room.gameId === "champions" ? "That doesn’t match a League champion." : room.gameId === "overwatch" ? "That doesn’t match an Overwatch hero." : "That doesn’t match a country on the list."); return; }
    if (guesses.some((guess) => guess.code === answer.code)) {
      setNotice(`You already named that ${answerType}.`); setEntry(""); return;
    }
    setBusy(true); setNotice("");
    try {
      await api("/api/guess", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: room.code, token: room.token, answerCode: answer.code })
      });
      setEntry("");
      if (room.mode === "turns") { await sync(room.code, room.token); return; }
      setGuesses((current) => current.some((guess) => guess.code === answer.code) ? current : [answer, ...current]);
      if (room.gameId === "countries") setCountryClaims((current) => ({ ...current, [answer.code]: playerId }));
    } catch (error) { setNotice(errorText(error)); }
    finally { setBusy(false); }
  }

  async function passTurn() {
    if (!room || busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice("");
    try {
      await api("/api/room", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pass", code: room.code, token: room.token, name })
      });
      setEntry("");
      await sync(room.code, room.token);
    } catch (error) { setNotice(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function empireAction(action: EmpireAction): Promise<boolean> {
    if (!room || busyRef.current) return false;
    busyRef.current = true; setBusy(true); setNotice("");
    try {
      await api("/api/empire", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: room.code, token: room.token, action })
      });
      await sync(room.code, room.token);
      return true;
    } catch (error) { setNotice(errorText(error)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }

  function leaveRoom() {
    localStorage.removeItem(ROOM_KEY);
    setStage("home"); setRoom(null); setTurn(null); setEmpire(null); setScores({}); setClaimLog([]); setAwards([]); setPlayers([]); setGuesses([]); setResults([]); setCountryClaims({}); setNotice(""); setEntry("");
  }

  const ready = Boolean(name.trim());
  const sortedResults = useMemo(() => results, [results]);
  const playerIds = useMemo(() => players.map((player) => player.id), [players]);
  const colorOf = (id: string) => playerColor(playerIds, id);
  const isCountries = activeGame.id === "countries";
  const isChampions = activeGame.id === "champions";
  const isOverwatch = activeGame.id === "overwatch";
  const isTurns = room?.mode === "turns" && isCountries;
  const isEmpire = room?.mode === "empire" && isCountries;
  const modeLabel = (mode: Mode) => (mode === "turns" ? "Turn-based" : mode === "empire" ? "Empire" : "Live race");

  return <main className="shell">
    <header className="topbar"><a className="brand" href="/"><span className="mark">A</span> ATLAS <b>SPRINT</b></a><div className="top-meta"><i/> {stage === "home" ? "GAME LOBBY　/　2–3 PLAYERS" : `${activeGame.title.toUpperCase()}　/　2–3 PLAYERS`} <span className="build-version" title={`Deployed commit ${BUILD_VERSION}`}>BUILD {BUILD_VERSION.slice(0, 7)}</span></div></header>
    <section className="content"><div className="eyebrow">✳　BRAN GAME • FRIEND ROOM</div>
    {stage === "home" && <div className="home-grid">
      <div className="hero"><p className="kicker">TWO MINDS OR THREE. YOUR CALL.</p><h1>Pick a game.<br/><em>Call your crew.</em></h1><p className="lede">Choose a quick challenge, make a private room, and see who can name the most before time runs out.</p>
        <div className="rules"><p><b>01</b> Choose a game from the lobby.</p><p><b>02</b> Invite one or two friends with your room code.</p><p><b>03</b> First to name an answer claims it for the round.</p></div></div>
      <div className="card"><div className="card-title">CHOOSE A GAME <span>2–3 PLAYERS</span></div>
        <div className="game-picker" role="group" aria-label="Choose a game">
          {(Object.values(GAME_CATALOG)).map((option) => <button type="button" className={`game-option${selectedGame === option.id ? " selected" : ""}`} key={option.id} aria-pressed={selectedGame === option.id} onClick={() => setSelectedGame(option.id)}>
            <span className="game-option-top"><b>{option.title}</b><small>{option.durationLabel}</small></span><span className="game-option-prompt">{option.prompt}</span>
          </button>)}
        </div>
        {selectedGame === "countries" && <div role="group" aria-label="Choose a mode"><span className="mode-label">MODE</span><div className="mode-picker">
          <button type="button" className={`mode-option${selectedMode === "live" ? " selected" : ""}`} aria-pressed={selectedMode === "live"} onClick={() => setSelectedMode("live")}><b>Live race</b><small>Everyone names countries at once for ten minutes.</small></button>
          <button type="button" className={`mode-option${selectedMode === "turns" ? " selected" : ""}`} aria-pressed={selectedMode === "turns"} onClick={() => setSelectedMode("turns")}><b>Turn-based</b><small>12 rounds, 15 seconds a turn, a criteria card each time.</small></button>
          <button type="button" className={`mode-option${selectedMode === "empire" ? " selected" : ""}`} aria-pressed={selectedMode === "empire"} onClick={() => setSelectedMode("empire")}><b>Empire</b><small>Strategy turns: pick a card, claim, steal or fortify. First to 15 points.</small></button>
        </div></div>}
        <label htmlFor="name">DISPLAY NAME</label><input id="name" className="field" maxLength={18} placeholder="What should we call you?" value={name} onChange={(event) => setName(event.target.value)}/>
        <button className="primary" disabled={!ready || busy} onClick={(event) => void startRoom(event as unknown as FormEvent, "create")}>Create {activeGame.title} room <span>↗</span></button>
        <div className="or">OR JOIN A FRIEND</div><form onSubmit={(event) => void startRoom(event, "join")}><label htmlFor="room">ROOM CODE</label><div className="join-row"><input id="room" className="field code" maxLength={6} placeholder="ABC123" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())}/><button className="join" disabled={!ready || joinCode.trim().length !== 6 || busy}>Join</button></div></form>
        {notice && <p className="notice">{notice}</p>}<p className="privacy">◉ First claim wins. In countries, every claim shows in its player’s colour.</p></div>
    </div>}
    {stage === "lobby" && room && <div className="panel"><p className="kicker">{activeGame.title.toUpperCase()} • ROOM READY</p><h1>Bring the<br/><em>whole crew.</em></h1>{isCountries && <p className="mode-tag">MODE　/　{modeLabel(room.mode).toUpperCase()}</p>}<p className="lede">{isEmpire ? "Everyone starts with a capital. On your turn pick a card, then claim, steal or fortify within 20 seconds. Region sets, majorities and the largest empire score bonuses. First to 15 points wins." : isTurns ? "Take turns in join order: 15 seconds each, one criteria card per turn, 12 rounds. Claim a country that fits your card." : <>{activeGame.rules} First to name each answer claims it.</>} Share this code. Start with two players, or wait for a third.</p><button className="room-code" onClick={() => void navigator.clipboard?.writeText(room.code)}>{room.code}　⧉</button>
      <div className="roster">{[0,1,2].map((index) => { const player = players[index]; return <div className="player" key={index}><span>0{index + 1}</span>{player && <i className="player-dot" style={{ background: colorOf(player.id) }}/>}<b>{player?.name ?? "Waiting for player…"}</b><small>{player ? "IN ROOM" : "OPEN SEAT"}</small></div>; })}</div>
      {players.length === 1 ? <p className="waiting">◉　One more player is needed to start.</p> : players.length === 2 ? <p className="waiting">◉　Two players are ready. Start now or wait for a third.</p> : <p className="waiting">◉　All three seats are ready.</p>}
      {players.find((player) => player.id === playerId)?.host && <button className="primary" disabled={players.length < 2 || busy} onClick={() => void startRound()}>{players.length < 2 ? "Waiting for one more player" : "Start round ↗"}</button>}
      <button className="quiet" onClick={leaveRoom}>Leave room</button>{notice && <p className="notice">{notice}</p>}</div>}
    {stage === "game" && room && isTurns && turn && <TurnsGame turn={turn} scores={scores} players={players} playerId={playerId} countryClaims={countryClaims} skewMs={skewMs} entry={entry} onEntry={setEntry} notice={notice} busy={busy} onSubmit={submitGuess} onPass={() => void passTurn()} onEnd={() => void endRound()} colorOf={colorOf}/>}
    {stage === "game" && room && isTurns && !turn && <p className="lede">Dealing the first card…</p>}
    {stage === "game" && room && isEmpire && empire && <EmpireGame view={empire} players={players} playerId={playerId} countryClaims={countryClaims} skewMs={skewMs} notice={notice} busy={busy} onAction={empireAction} onNotice={setNotice} onEnd={() => void endRound()} colorOf={colorOf}/>}
    {stage === "game" && room && isEmpire && !empire && <p className="lede">Placing capitals…</p>}
    {stage === "game" && room && !isTurns && !isEmpire && <div className="game"><section><div className="game-head"><div><p className="kicker">{activeGame.title.toUpperCase()}　<span className="live">● LIVE</span></p><h1>{isChampions ? <>Name every<br/><em>champion.</em></> : isOverwatch ? <>Name every<br/><em>hero.</em></> : <>Name every<br/><em>country.</em></>}</h1></div><div className={left < 30 ? "timer urgent" : "timer"}><small>TIME LEFT</small><b>{timeText(left)}</b></div></div><p className="lede">Type an answer and press enter. First to name it locks it for the round.</p>
      <form className="guess-form" onSubmit={submitGuess}><input ref={input} className="field" placeholder={activeGame.inputPlaceholder} value={entry} onChange={(event) => setEntry(event.target.value)} disabled={left <= 0 || busy}/><button className="primary" disabled={!entry.trim() || left <= 0 || busy}>Claim ↵</button></form>
      {notice && <p className="notice">{notice}</p>}<div className="guess-title">YOUR ANSWERS　<b>{guesses.length}</b><span>{isCountries ? "SHOWN ON THE MAP" : "HIDDEN FROM OTHERS"}</span></div>
      <div className="guess-list">{guesses.length ? guesses.map((guess, index) => <div className="guess" key={guess.code}><small>{String(guesses.length - index).padStart(2,"0")}</small>{guess.name}<b>✓</b></div>) : <p className="empty">Your first answer is waiting here.<br/>{isCountries ? "Claimed countries appear in your colour." : "The other players can’t see this list."}</p>}</div>
      {room.gameId === "countries" && <><WorldMap claims={countryClaims} players={players} youId={playerId}/>
        <div className="claim-lists">{players.map((player) => { const owned = Object.entries(countryClaims).filter(([, owner]) => owner === player.id).map(([code]) => countryByCode(code)?.name ?? code).sort(); return <div className="claim-list" key={player.id} style={{ borderColor: colorOf(player.id) }}><b style={{ color: colorOf(player.id) }}>{player.name}{player.id === playerId ? " (you)" : ""} · {owned.length}</b><div className="chips">{owned.length ? owned.map((countryName) => <span key={countryName} style={{ background: colorOf(player.id) }}>{countryName}</span>) : <em>Nothing claimed yet</em>}</div></div>; })}</div></>}</section>
      <aside><div className="aside-title">THE ROOM <b>{players.length}/3</b></div>{players.map((player) => <div className="mini" key={player.id}><span style={{ background: colorOf(player.id), color: "#fff" }}>{player.name.slice(0,1).toUpperCase()}</span><b>{player.name}{player.id === playerId ? " (you)" : ""}</b><i>{isCountries ? Object.values(countryClaims).filter((owner) => owner === player.id).length : "◉"}</i></div>)}<p className="aside-note">✳ First to name an answer locks it. {isCountries ? "Locked countries are coloured by who claimed them." : "You can’t see who claimed a lock until results."}</p>{players.find((player) => player.id === playerId)?.host && <button className="quiet end-round" disabled={busy} onClick={() => void endRound()}>End round &amp; reveal</button>}{notice && <p className="notice">{notice}</p>}</aside></div>}
    {stage === "results" && room && isTurns && <div className="panel results turns-results"><p className="kicker">GAME OVER • FINAL SCORES</p><h1>What a<br/> <em>showing.</em></h1><p className="lede">{players.length} players, {turn?.totalRounds ?? 12} rounds. Points plus bonuses decide it.</p>
      <div className="board">{sortedResults.map((result, index) => <article key={result.playerId} style={{ borderLeft: `4px solid ${colorOf(result.playerId)}`, paddingLeft: 12 }}><small>{["1ST","2ND","3RD"][index]}</small><b>{result.name}{result.playerId === playerId ? " · YOU" : ""}</b><strong>{result.total ?? 0}<small>POINTS</small></strong>
        <div className="breakdown"><span><em>Claims ({result.guesses.length})</em><em>{result.points ?? 0}</em></span>{(result.bonuses ?? []).map((bonus) => <span key={bonus.label}><em>{bonus.label}</em><em>+{bonus.points}</em></span>)}<span><em>Final score</em><em>{result.total ?? 0}</em></span></div>
        <div className="chips">{result.guesses.map((guess) => <span key={guess.code}>{guess.name}</span>)}</div></article>)}</div>
      {awards.length > 0 && <div className="awards">{awards.map((award) => <div className="award" key={award.id}><small>AWARD</small><b>{award.title}: {players.find((player) => player.id === award.playerId)?.name ?? "Player"}</b><span>{award.detail}</span></div>)}</div>}
      <ResultsReplay claimLog={claimLog} players={players} youId={playerId}/>
      <button className="primary" onClick={leaveRoom}>Back to game lobby ↗</button></div>}
    {stage === "results" && room && isEmpire && <EmpireResults view={empire} players={players} playerId={playerId} claimLog={claimLog} colorOf={colorOf} onLeave={leaveRoom}/>}
    {stage === "results" && room && !isTurns && !isEmpire && <div className="panel results"><p className="kicker">ROUND OVER • ANSWERS REVEALED</p><h1>What a<br/> <em>showing.</em></h1><p className="lede">{players.length} players. Here’s how your lists compare.</p><div className="board">{sortedResults.map((result, index) => <article key={result.playerId} style={{ borderLeft: `4px solid ${colorOf(result.playerId)}`, paddingLeft: 12 }}><small>{["1ST","2ND","3RD"][index]}</small><b>{result.name}{result.playerId === playerId ? " · YOU" : ""}</b><strong>{result.guesses.length}<small>{activeGame.answerLabel}</small></strong><div className="chips">{result.guesses.map((guess) => <span key={guess.code}>{guess.name}</span>)}</div></article>)}</div><button className="primary" onClick={leaveRoom}>Back to game lobby ↗</button></div>}
    <footer><span>BRAN GAME / FRIEND ROOM</span><span>MADE FOR FRIENDS, PLAYED FAIR</span><span>© 2026</span></footer></section>
  </main>;
}
