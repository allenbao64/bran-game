"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveCountry } from "@/lib/countries";
import { resolveChampion } from "@/lib/champions";
import { GAME_CATALOG, gameConfig, type GameId } from "@/lib/games";

type Player = { id: string; name: string; host: boolean };
type Answer = { code: string; name: string };
type Result = { playerId: string; name: string; guesses: Answer[] };
type Room = { code: string; token: string; gameId: GameId; status: "waiting" | "playing" | "ended"; startedAt: number | null; players: Player[] };
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
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerId, setPlayerId] = useState("");
  const [guesses, setGuesses] = useState<Answer[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [entry, setEntry] = useState("");
  const [left, setLeft] = useState(GAME_CATALOG.countries.durationSeconds);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const activeGame = gameConfig(room?.gameId ?? selectedGame);

  const sync = useCallback(async (code: string, token: string) => {
    const data = await api<{
      code: string; gameId?: GameId; status: Room["status"]; startedAt: number | null;
      players: Player[]; playerId: string; myGuesses: Answer[]; results?: Result[];
    }>(`/api/room?code=${encodeURIComponent(code)}`, { headers: { Authorization: `Bearer ${token}` } });
    const gameId = data.gameId ?? "countries";
    setRoom({ code: data.code, token, gameId, status: data.status, startedAt: data.startedAt, players: data.players });
    setSelectedGame(gameId); setPlayers(data.players); setPlayerId(data.playerId); setGuesses(data.myGuesses);
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
    }, 1600);
    return () => window.clearInterval(id);
  }, [room?.code, room?.token, stage, sync]);

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
        code: string; gameId?: GameId; token: string; playerId: string; status: Room["status"];
        startedAt: number | null; players: Player[];
      }>("/api/room", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name: name.trim(), code, ...(action === "create" ? { gameId: selectedGame } : {}) })
      });
      const gameId = data.gameId ?? "countries";
      const session = { ...data, name: name.trim() };
      localStorage.setItem(ROOM_KEY, JSON.stringify(session));
      setJoinCode(data.code);
      const nextRoom: Room = { code: data.code, token: data.token, gameId, status: data.status, startedAt: data.startedAt, players: data.players };
      setRoom(nextRoom); setSelectedGame(gameId); setPlayers(data.players); setPlayerId(data.playerId); setGuesses([]); setResults([]);
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
      setRoom(nextRoom); setPlayers(data.players); setLeft(gameConfig(room.gameId).durationSeconds); setStage("game");
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
    const answer = room.gameId === "champions" ? resolveChampion(entry) : resolveCountry(entry);
    if (!answer) { setNotice(room.gameId === "champions" ? "That doesn’t match a League champion." : "That doesn’t match a country on the list."); return; }
    if (guesses.some((guess) => guess.code === answer.code)) {
      setNotice(`You already named that ${room.gameId === "champions" ? "champion" : "country"}.`); setEntry(""); return;
    }
    setBusy(true); setNotice("");
    try {
      await api("/api/guess", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: room.code, token: room.token, answerCode: answer.code })
      });
      setGuesses((current) => current.some((guess) => guess.code === answer.code) ? current : [answer, ...current]);
      setEntry("");
    } catch (error) { setNotice(errorText(error)); }
    finally { setBusy(false); }
  }

  function leaveRoom() {
    localStorage.removeItem(ROOM_KEY);
    setStage("home"); setRoom(null); setPlayers([]); setGuesses([]); setResults([]); setNotice(""); setEntry("");
  }

  const ready = Boolean(name.trim());
  const sortedResults = useMemo(() => results, [results]);
  const isChampions = activeGame.id === "champions";

  return <main className="shell">
    <header className="topbar"><a className="brand" href="/"><span className="mark">A</span> ATLAS <b>SPRINT</b></a><div className="top-meta"><i/> {stage === "home" ? "GAME LOBBY　/　2–3 PLAYERS" : `${activeGame.title.toUpperCase()}　/　2–3 PLAYERS`} <span className="build-version" title={`Deployed commit ${BUILD_VERSION}`}>BUILD {BUILD_VERSION.slice(0, 7)}</span></div></header>
    <section className="content"><div className="eyebrow">✳　BRAN GAME • FRIEND ROOM</div>
    {stage === "home" && <div className="home-grid">
      <div className="hero"><p className="kicker">TWO MINDS OR THREE. YOUR CALL.</p><h1>Pick a game.<br/><em>Call your crew.</em></h1><p className="lede">Choose a quick challenge, make a private room, and see who can name the most before time runs out.</p>
        <div className="rules"><p><b>01</b> Choose a game from the lobby.</p><p><b>02</b> Invite one or two friends with your room code.</p><p><b>03</b> Everyone’s answers stay secret until the round ends.</p></div></div>
      <div className="card"><div className="card-title">CHOOSE A GAME <span>2–3 PLAYERS</span></div>
        <div className="game-picker" role="group" aria-label="Choose a game">
          {(Object.values(GAME_CATALOG)).map((option) => <button type="button" className={`game-option${selectedGame === option.id ? " selected" : ""}`} key={option.id} aria-pressed={selectedGame === option.id} onClick={() => setSelectedGame(option.id)}>
            <span className="game-option-top"><b>{option.title}</b><small>{option.durationLabel}</small></span><span className="game-option-prompt">{option.prompt}</span>
          </button>)}
        </div>
        <label htmlFor="name">DISPLAY NAME</label><input id="name" className="field" maxLength={18} placeholder="What should we call you?" value={name} onChange={(event) => setName(event.target.value)}/>
        <button className="primary" disabled={!ready || busy} onClick={(event) => void startRoom(event as unknown as FormEvent, "create")}>Create {activeGame.title} room <span>↗</span></button>
        <div className="or">OR JOIN A FRIEND</div><form onSubmit={(event) => void startRoom(event, "join")}><label htmlFor="room">ROOM CODE</label><div className="join-row"><input id="room" className="field code" maxLength={6} placeholder="ABC123" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())}/><button className="join" disabled={!ready || joinCode.trim().length !== 6 || busy}>Join</button></div></form>
        {notice && <p className="notice">{notice}</p>}<p className="privacy">◉ Your answers stay private until reveal.</p></div>
    </div>}
    {stage === "lobby" && room && <div className="panel"><p className="kicker">{activeGame.title.toUpperCase()} • ROOM READY</p><h1>Bring the<br/><em>whole crew.</em></h1><p className="lede">{activeGame.rules} Share this code. Start with two players, or wait for a third.</p><button className="room-code" onClick={() => void navigator.clipboard?.writeText(room.code)}>{room.code}　⧉</button>
      <div className="roster">{[0,1,2].map((index) => { const player = players[index]; return <div className="player" key={index}><span>0{index + 1}</span><b>{player?.name ?? "Waiting for player…"}</b><small>{player ? "IN ROOM" : "OPEN SEAT"}</small></div>; })}</div>
      {players.length === 1 ? <p className="waiting">◉　One more player is needed to start.</p> : players.length === 2 ? <p className="waiting">◉　Two players are ready. Start now or wait for a third.</p> : <p className="waiting">◉　All three seats are ready.</p>}
      {players.find((player) => player.id === playerId)?.host && <button className="primary" disabled={players.length < 2 || busy} onClick={() => void startRound()}>{players.length < 2 ? "Waiting for one more player" : "Start round ↗"}</button>}
      <button className="quiet" onClick={leaveRoom}>Leave room</button>{notice && <p className="notice">{notice}</p>}</div>}
    {stage === "game" && room && <div className="game"><section><div className="game-head"><div><p className="kicker">{activeGame.title.toUpperCase()}　<span className="live">● LIVE</span></p><h1>{isChampions ? <>Name every<br/><em>champion.</em></> : <>Name every<br/><em>country.</em></>}</h1></div><div className={left < 30 ? "timer urgent" : "timer"}><small>TIME LEFT</small><b>{timeText(left)}</b></div></div><p className="lede">Type an answer and press enter. Only your list is visible.</p>
      <form className="guess-form" onSubmit={submitGuess}><input ref={input} className="field" placeholder={activeGame.inputPlaceholder} value={entry} onChange={(event) => setEntry(event.target.value)} disabled={left <= 0 || busy}/><button className="primary" disabled={!entry.trim() || left <= 0 || busy}>Add ↵</button></form>
      {notice && <p className="notice">{notice}</p>}<div className="guess-title">YOUR ANSWERS　<b>{guesses.length}</b><span>HIDDEN FROM OTHERS</span></div>
      <div className="guess-list">{guesses.length ? guesses.map((guess, index) => <div className="guess" key={guess.code}><small>{String(guesses.length - index).padStart(2,"0")}</small>{guess.name}<b>✓</b></div>) : <p className="empty">Your first answer is waiting here.<br/>The other players can’t see this list.</p>}</div></section>
      <aside><div className="aside-title">THE ROOM <b>{players.length}/3</b></div>{players.map((player) => <div className="mini" key={player.id}><span>{player.name.slice(0,1).toUpperCase()}</span><b>{player.name}{player.id === playerId ? " (you)" : ""}</b><i>◉</i></div>)}<p className="aside-note">✳ Answers stay under wraps until the timer hits zero. No peeking, no copying.</p>{players.find((player) => player.id === playerId)?.host && <button className="quiet end-round" disabled={busy} onClick={() => void endRound()}>End round &amp; reveal</button>}{notice && <p className="notice">{notice}</p>}</aside></div>}
    {stage === "results" && room && <div className="panel results"><p className="kicker">ROUND OVER • ANSWERS REVEALED</p><h1>What a<br/> <em>showing.</em></h1><p className="lede">{players.length} players. Here’s how your lists compare.</p><div className="board">{sortedResults.map((result, index) => <article key={result.playerId}><small>{["1ST","2ND","3RD"][index]}</small><b>{result.name}{result.playerId === playerId ? " · YOU" : ""}</b><strong>{result.guesses.length}<small>{activeGame.answerLabel}</small></strong><div className="chips">{result.guesses.map((guess) => <span key={guess.code}>{guess.name}</span>)}</div></article>)}</div><button className="primary" onClick={leaveRoom}>Back to game lobby ↗</button></div>}
    <footer><span>BRAN GAME / FRIEND ROOM</span><span>MADE FOR FRIENDS, PLAYED FAIR</span><span>© 2026</span></footer></section>
  </main>;
}
