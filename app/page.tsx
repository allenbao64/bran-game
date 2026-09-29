"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveCountry, type CountryAnswer } from "@/lib/countries";

type Player = { id: string; name: string; host: boolean };
type Result = { playerId: string; name: string; guesses: CountryAnswer[] };
type Room = { code: string; token: string; status: "waiting" | "playing" | "ended"; startedAt: number | null; players: Player[] };
type Stage = "home" | "lobby" | "game" | "results";
const ROOM_KEY = "bran-game-room";
const ROUND_SECONDS = 600;

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
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playerId, setPlayerId] = useState("");
  const [guesses, setGuesses] = useState<CountryAnswer[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [entry, setEntry] = useState("");
  const [left, setLeft] = useState(ROUND_SECONDS);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const sync = useCallback(async (code: string, token: string) => {
    const data = await api<{
      code: string; status: Room["status"]; startedAt: number | null;
      players: Player[]; playerId: string; myGuesses: CountryAnswer[]; results?: Result[];
    }>(`/api/room?code=${encodeURIComponent(code)}`, { headers: { Authorization: `Bearer ${token}` } });
    setRoom({ code: data.code, token, status: data.status, startedAt: data.startedAt, players: data.players });
    setPlayers(data.players); setPlayerId(data.playerId); setGuesses(data.myGuesses);
    if (data.status === "ended") { setResults(data.results ?? []); setStage("results"); }
    else setStage(data.status === "playing" ? "game" : "lobby");
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(ROOM_KEY);
    if (!saved) return;
    try {
      const session = JSON.parse(saved) as { code: string; token: string; playerId: string; name: string };
      setName(session.name);
      void sync(session.code, session.token).catch((error) => {
        setNotice(errorText(error));
      });
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
    const tick = () => setLeft(Math.max(0, ROUND_SECONDS - Math.floor((Date.now() - room.startedAt!) / 1000)));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [stage, room?.startedAt]);

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
        code: string; token: string; playerId: string; status: Room["status"];
        startedAt: number | null; players: Player[];
      }>("/api/room", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name: name.trim(), code })
      });
      const session = { ...data, name: name.trim() };
      localStorage.setItem(ROOM_KEY, JSON.stringify(session));
      setJoinCode(data.code);
      const nextRoom: Room = { code: data.code, token: data.token, status: data.status, startedAt: data.startedAt, players: data.players };
      setRoom(nextRoom); setPlayers(data.players); setPlayerId(data.playerId); setGuesses([]);
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
      setRoom(nextRoom); setPlayers(data.players); setStage("game");
    } catch (error) { setNotice(errorText(error)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function submitGuess(event: FormEvent) {
    event.preventDefault();
    if (!room || !entry.trim()) return;
    const answer = resolveCountry(entry);
    if (!answer) { setNotice("That doesn’t match a country on the list."); return; }
    if (guesses.some((guess) => guess.code === answer.code)) {
      setNotice("You already named that country."); setEntry(""); return;
    }
    setBusy(true); setNotice("");
    try {
      await api("/api/guess", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: room.code, token: room.token, countryCode: answer.code })
      });
      setGuesses((current) => current.some((guess) => guess.code === answer.code) ? current : [answer, ...current]);
      setEntry("");
    } catch (error) { setNotice(errorText(error)); }
    finally { setBusy(false); }
  }

  function leaveRoom() {
    localStorage.removeItem(ROOM_KEY);
    setStage("home"); setRoom(null); setPlayers([]); setGuesses([]); setResults([]); setNotice("");
  }

  const ready = Boolean(name.trim());
  const sortedResults = useMemo(() => results, [results]);

  return <main className="shell">
    <header className="topbar"><a className="brand" href="/"><span className="mark">A</span> ATLAS <b>SPRINT</b></a><div className="top-meta"><i/> FRIEND ROOM　/　3 PLAYERS</div></header>
    <section className="content"><div className="eyebrow">✳　BRAN GAME • FIRST PLAYTEST</div>
    {stage === "home" && <div className="home-grid">
      <div className="hero"><p className="kicker">SAME WORLD. THREE MINDS.</p><h1>How many<br/><em>countries</em><br/>can you name?</h1><p className="lede">Ten minutes. Three players. Every answer stays secret until the clock runs out.</p>
        <div className="rules"><p><b>01</b> Make a private room and send the code to two friends.</p><p><b>02</b> Type as many unique countries as you can before time.</p><p><b>03</b> All three lists unlock together. Highest score wins.</p></div></div>
      <div className="card"><div className="card-title">YOUR SEAT <span>PLAYER 01–03</span></div>
        <label htmlFor="name">DISPLAY NAME</label><input id="name" className="field" maxLength={18} placeholder="What should we call you?" value={name} onChange={(event) => setName(event.target.value)}/>
        <button className="primary" disabled={!ready || busy} onClick={(event) => void startRoom(event as unknown as FormEvent, "create")}>Create a room <span>↗</span></button>
        <div className="or">OR JOIN A FRIEND</div><form onSubmit={(event) => void startRoom(event, "join")}><label htmlFor="room">ROOM CODE</label><div className="join-row"><input id="room" className="field code" maxLength={6} placeholder="ABC123" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())}/><button className="join" disabled={!ready || joinCode.trim().length !== 6 || busy}>Join</button></div></form>
        {notice && <p className="notice">{notice}</p>}<p className="privacy">◉ Your guesses stay private until reveal.</p></div>
    </div>}
    {stage === "lobby" && room && <div className="panel"><p className="kicker">ROOM READY</p><h1>Bring the<br/><em>whole crew.</em></h1><p className="lede">Share this code. The host starts the round when all three seats are ready.</p><button className="room-code" onClick={() => void navigator.clipboard?.writeText(room.code)}>{room.code}　⧉</button>
      <div className="roster">{[0,1,2].map((index) => { const player = players[index]; return <div className="player" key={index}><span>0{index + 1}</span><b>{player?.name ?? "Waiting for player…"}</b><small>{player ? "IN ROOM" : "OPEN SEAT"}</small></div>; })}</div>
      {players.length < 3 ? <p className="waiting">◉　Waiting for {3 - players.length} more {3 - players.length === 1 ? "player" : "players"}…</p> : <p className="waiting">◉　All three seats are ready.</p>}
      {players.find((player) => player.id === playerId)?.host && <button className="primary" disabled={players.length !== 3 || busy} onClick={() => void startRound()}>{players.length === 3 ? "Start round ↗" : `Waiting for players · ${players.length}/3`}</button>}
      <button className="quiet" onClick={leaveRoom}>Leave room</button>{notice && <p className="notice">{notice}</p>}</div>}
    {stage === "game" && room && <div className="game"><section><div className="game-head"><div><p className="kicker">COUNTRY SPRINT　<span className="live">● LIVE</span></p><h1>Name every<br/><em>country.</em></h1></div><div className={left < 60 ? "timer urgent" : "timer"}><small>TIME LEFT</small><b>{timeText(left)}</b></div></div><p className="lede">Type a country and press enter. Only your list is visible.</p>
      <form className="guess-form" onSubmit={submitGuess}><input ref={input} className="field" placeholder="Type a country name…" value={entry} onChange={(event) => setEntry(event.target.value)} disabled={left <= 0 || busy}/><button className="primary" disabled={!entry.trim() || left <= 0 || busy}>Add ↵</button></form>
      {notice && <p className="notice">{notice}</p>}<div className="guess-title">YOUR ANSWERS　<b>{guesses.length}</b><span>HIDDEN FROM OTHERS</span></div>
      <div className="guess-list">{guesses.length ? guesses.map((guess, index) => <div className="guess" key={guess.code}><small>{String(guesses.length - index).padStart(2,"0")}</small>{guess.name}<b>✓</b></div>) : <p className="empty">Your first answer is waiting here.<br/>The other players can’t see this list.</p>}</div></section>
      <aside><div className="aside-title">THE ROOM <b>{players.length}/3</b></div>{players.map((player) => <div className="mini" key={player.id}><span>{player.name.slice(0,1).toUpperCase()}</span><b>{player.name}{player.id === playerId ? " (you)" : ""}</b><i>◉</i></div>)}<p className="aside-note">✳ Answers stay under wraps until the timer hits zero. No peeking, no copying.</p></aside></div>}
    {stage === "results" && room && <div className="panel results"><p className="kicker">TIME’S UP • ANSWERS REVEALED</p><h1>The world<br/>is <em>yours.</em></h1><p className="lede">Three players. One planet. Here’s how your lists compare.</p><div className="board">{sortedResults.map((result, index) => <article key={result.playerId}><small>{["1ST","2ND","3RD"][index]}</small><b>{result.name}{result.playerId === playerId ? " · YOU" : ""}</b><strong>{result.guesses.length}<small>COUNTRIES</small></strong><div className="chips">{result.guesses.map((guess) => <span key={guess.code}>{guess.name}</span>)}</div></article>)}</div><button className="primary" onClick={leaveRoom}>Back to start ↗</button></div>}
    <footer><span>BRAN GAME / 001</span><span>MADE FOR FRIENDS, PLAYED FAIR</span><span>© 2026</span></footer></section>
  </main>;
}
