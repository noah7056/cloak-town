import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket, type Player, type RoomState } from "../net/socket";

export type VoiceMode = "toggle" | "ptt";
export type VoiceOptions = {
  micDeviceId: string; // "" = system default
  voiceMode: VoiceMode;
  voiceKey: string; // lowercase e.key
  echoCancellation: boolean;
};
export type MicDevice = { deviceId: string; label: string };
export type VoicePeerDiag = {
  id: string;
  conn: string;
  track: boolean;
  gain: number;
  dist: number | null;
  rstate: string; // remote track readyState + muted/enabled flags
  inLvl: number; // measured energy of the RECEIVED audio (0 = silence in)
  upBs: number; // RTP bytes/sec we send them
  downBs: number; // RTP bytes/sec we get from them
};
export type VoiceDiag = { ctx: string; out: string; peers: VoicePeerDiag[] };

// Attach a mic track to a connection WITHOUT touching SDP negotiation:
// reuse a sender slot via replaceTrack (null = muted, sends nothing).
// removeTrack+addTrack back-to-back orphans senders and storms
// renegotiations, so it is never used here.
async function attachAudio(
  pc: RTCPeerConnection,
  track: MediaStreamTrack | null,
  stream: MediaStream | null
): Promise<void> {
  if (!track || !stream) {
    for (const snd of pc.getSenders()) {
      try { await snd.replaceTrack(null); } catch { /* noop */ }
    }
    return;
  }
  const score = (snd: RTCRtpSender): number => {
    // Prefer an open (negotiated, not stopped/inactive) m-line; among those,
    // prefer one already carrying a live track.
    const tr = pc.getTransceivers().find((t) => t.sender === snd);
    const d = tr?.currentDirection;
    const open = d && d !== "stopped" && d !== "inactive" ? 2 : 0;
    const live = snd.track && snd.track.readyState === "live" ? 1 : 0;
    return open + live;
  };
  const ranked = [...pc.getSenders()].sort((a, b) => score(b) - score(a));
  for (const snd of ranked) {
    try { await snd.replaceTrack(track); return; } catch { /* try next slot */ }
  }
  try { pc.addTrack(track, stream); } catch { /* noop */ }
}

export function useVoice(
  myId: string,
  enabled: boolean,
  getState: () => RoomState | null,
  opts: VoiceOptions = { micDeviceId: "", voiceMode: "toggle", voiceKey: "v", echoCancellation: true }
) {
  const [muted, setMuted] = useState(true);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [peersLinked, setPeersLinked] = useState(0);
  const [diag, setDiag] = useState<VoiceDiag>({ ctx: "none", out: "-", peers: [] });
  const localStream = useRef<MediaStream | null>(null);
  const micPromise = useRef<Promise<MediaStream | null> | null>(null);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  // Glare resolution: the newcomer is impolite (its offer wins), the existing
  // peer is polite (rolls back and accepts). Decided at first sight of a peer.
  const polite = useRef(new Map<string, boolean>());
  const gains = useRef(new Map<string, { gain: GainNode; src: MediaStreamAudioSourceNode; analyser: AnalyserNode; track: MediaStreamTrack }>());
  const statLast = useRef(new Map<string, { t: number; out: number; inn: number }>());
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mutedRef = useRef(true);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const socket = getSocket();

  const setMutedBoth = (m: boolean) => {
    mutedRef.current = m;
    setMuted(m);
    if (m) socket.emit("speaking", { speaking: false });
  };

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        list
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
      );
    } catch {
      /* no mic API */
    }
  }, []);

  const ensureMic = useCallback(async (): Promise<MediaStream | null> => {
    if (localStream.current && localStream.current.active) return localStream.current;
    // Single-flight: a double-click must not open the mic twice (two streams
    // = the sent track and the monitored track can silently diverge).
    if (micPromise.current) return micPromise.current;
    const job = (async () => {
      try {
        const devId = optsRef.current.micDeviceId;
        const ec = optsRef.current.echoCancellation;
        const base: MediaTrackConstraints = { echoCancellation: ec, noiseSuppression: true, autoGainControl: true };
        const wanted: MediaStreamConstraints = devId
          ? { audio: { ...base, deviceId: { exact: devId } } }
          : { audio: base };
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(wanted);
        } catch {
          // selected device vanished — fall back to default
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        localStream.current = stream;
        const actx = ctxRef.current || new AudioContext();
        ctxRef.current = actx;
        const src = actx.createMediaStreamSource(stream);
        const an = actx.createAnalyser();
        src.connect(an);
        analyserRef.current = an;
        void refreshDevices();
        return stream;
      } catch {
        alert("Microphone blocked. Allow mic access to use voice chat.");
        return null;
      }
    })();
    micPromise.current = job;
    try {
      return await job;
    } finally {
      micPromise.current = null;
    }
  }, [refreshDevices]);

  // Publish one track (or null = muted) across all connections. Tracks stay
  // enabled always; muting = nothing published, so the remote side truthfully
  // sees its track flag flip instead of receiving full-rate silence.
  const publishTrack = useCallback(async (track: MediaStreamTrack | null) => {
    const stream = localStream.current;
    for (const pc of pcs.current.values()) {
      await attachAudio(pc, track, track ? stream : null);
    }
  }, []);

  const micOn = useCallback(async () => {
    const st = await ensureMic();
    if (!st) return;
    const t = st.getAudioTracks()[0];
    if (t) await publishTrack(t);
    // The output graph must run: browsers suspend contexts made outside a
    // click, and this handler IS the click.
    try { await ctxRef.current?.resume(); } catch { /* noop */ }
    setMutedBoth(false);
  }, [ensureMic, publishTrack]);

  const micOff = useCallback(async () => {
    await publishTrack(null);
    setMutedBoth(true);
  }, [publishTrack]);

  const toggleMute = useCallback(() => {
    if (mutedRef.current) void micOn();
    else void micOff();
  }, [micOn, micOff]);

  // Re-open the mic from scratch (applies a changed mic device or processing
  // toggle). Keeps the muted state: re-publishes only if we were live.
  const cycleMic = useCallback(async () => {
    const wasLive = !mutedRef.current;
    try { localStream.current?.getTracks().forEach((t) => t.stop()); } catch {}
    localStream.current = null;
    analyserRef.current = null;
    if (wasLive) {
      const st = await ensureMic();
      const t = st?.getAudioTracks()[0];
      if (t) await publishTrack(t);
    }
  }, [ensureMic, publishTrack]);

  // Full clean-slate restart of the voice mesh (pristine pcs, one sender
  // each). The server re-announces us so both sides reform the mesh.
  const resetMesh = useCallback(() => {
    for (const pc of pcs.current.values()) {
      try { pc.close(); } catch {}
    }
    pcs.current.clear();
    gains.current.clear();
    polite.current.clear();
    statLast.current.clear();
    setPeersLinked(0);
    socket.emit("voice-hello");
  }, []);

  // Short beep through the output graph — verifies the local speaker path
  // independent of any peer.
  const playTest = useCallback(() => {
    const actx = ctxRef.current;
    if (!actx) {
      alert("No audio graph yet — unmute once first, then test.");
      return;
    }
    void actx.resume().catch(() => {});
    try {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.frequency.value = 660;
      g.gain.value = 0.2;
      o.connect(g);
      g.connect(actx.destination);
      o.start();
      o.stop(actx.currentTime + 0.25);
    } catch {
      alert("Could not play test sound (output: " + actx.state + ").");
    }
  }, []);

  // Browsers only let audio (back) on after a real user gesture. If the
  // remote-audio graph was built from a socket callback it starts suspended,
  // so resume it on the next click/keypress.
  useEffect(() => {
    if (!enabled) return;
    const kick = () => {
      const actx = ctxRef.current;
      if (actx && actx.state === "suspended") void actx.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
  }, [enabled]);
  // Swap input device live when it changes (cycleMic preserves mute state).
  useEffect(() => {
    if (!enabled || !localStream.current) return;
    void cycleMic();
  }, [opts.micDeviceId, enabled, cycleMic]);

  // Voice activation keybind (toggle or push-to-talk).
  useEffect(() => {
    if (!enabled) return;
    const prevMuted = { current: true };
    const isTyping = () => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat || isTyping()) return;
      if (e.key.toLowerCase() !== optsRef.current.voiceKey) return;
      if (optsRef.current.voiceMode === "toggle") toggleMute();
      else {
        prevMuted.current = mutedRef.current;
        if (mutedRef.current) void micOn();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (optsRef.current.voiceMode !== "ptt") return;
      if (e.key.toLowerCase() !== optsRef.current.voiceKey) return;
      if (prevMuted.current && !mutedRef.current) void micOff();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [enabled, toggleMute, micOn, micOff]);

  useEffect(() => {
    if (!enabled || !myId) return;
    const s = socket;

    const ensureCtx = () => {
      if (!ctxRef.current) ctxRef.current = new AudioContext();
      return ctxRef.current;
    };

    const updateLinkCount = () => {
      const n = [...pcs.current.values()].filter((p) => p.connectionState === "connected").length;
      setPeersLinked(n);
    };

    const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
    // Optional TURN for symmetric-NAT / cross-country calls:
    // VITE_TURN_URL (+ VITE_TURN_USER / VITE_TURN_PASS).
    const turnUrl = (import.meta.env.VITE_TURN_URL as string | undefined) || "";
    if (turnUrl) {
      iceServers.push({
        urls: turnUrl,
        username: (import.meta.env.VITE_TURN_USER as string | undefined) || undefined,
        credential: (import.meta.env.VITE_TURN_PASS as string | undefined) || undefined,
      });
    }

    const makePC = (peerId: string) => {
      if (pcs.current.has(peerId)) return pcs.current.get(peerId)!;
      const pc = new RTCPeerConnection({ iceServers });
      let wantOffer = false;
      const sendOffer = async () => {
        // Only offer from stable; otherwise retry once we get there.
        if (pc.signalingState !== "stable") { wantOffer = true; return; }
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          s.emit("voice-offer", { to: peerId, offer });
        } catch {
          wantOffer = true;
        }
      };
      // Fires whenever tracks are added/removed AFTER the first handshake —
      // previously missing, so unmuting never reached the remote side.
      pc.onnegotiationneeded = () => { void sendOffer(); };
      pc.onsignalingstatechange = () => {
        if (pc.signalingState === "stable" && wantOffer) {
          wantOffer = false;
          void sendOffer();
        }
      };
      pc.onconnectionstatechange = () => {
        console.log("[voice] peer", peerId.slice(0, 5), pc.connectionState);
        updateLinkCount();
      };
      if (localStream.current) {
        // Publish current mic state onto the fresh pc (usually muted → the
        // transceiver alone is enough; nothing to attach yet).
        const live = !mutedRef.current ? localStream.current.getAudioTracks()[0] ?? null : null;
        if (live) void attachAudio(pc, live, localStream.current);
      }
      if (pc.getTransceivers().length === 0) {
        // Always have an audio m-line from the start so the handshake (and
        // "connected") happens at join time — never lazily on first unmute.
        try { pc.addTransceiver("audio", { direction: "recvonly" }); } catch {}
      }
      pc.onicecandidate = (e) => {
        if (e.candidate) s.emit("voice-ice", { to: peerId, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        // Prefer the (running, gesture-created) context over minting a new
        // suspended one inside this socket callback.
        const actx = ctxRef.current || ensureCtx();
        void actx.resume().catch(() => {});
        try {
          const stream = e.streams[0] || new MediaStream([e.track]);
          const gain = actx.createGain();
          gain.connect(actx.destination);
          const src = actx.createMediaStreamSource(stream);
          const an = actx.createAnalyser();
          an.fftSize = 512;
          src.connect(gain);
          src.connect(an);
          const track = stream.getAudioTracks()[0] || e.track;
          track.onmute = () => console.log("[voice] remote track muted", peerId.slice(0, 5));
          track.onunmute = () => console.log("[voice] remote track unmuted", peerId.slice(0, 5));
          track.onended = () => console.log("[voice] remote track ended", peerId.slice(0, 5));
          gains.current.set(peerId, { gain, src, analyser: an, track });
        } catch (err) {
          console.warn("[voice] attaching remote track failed", err);
        }
      };
      pcs.current.set(peerId, pc);
      updateLinkCount();
      return pc;
    };

    const onPeers = ({ peers }: { peers: string[] }) => {
      // We are the newcomer (impolite): prepare everyone; the transceiver
      // above queues an offer per peer via onnegotiationneeded.
      for (const pid of peers) {
        polite.current.set(pid, false);
        makePC(pid);
      }
    };
    const onPeerJoined = ({ id }: { id: string }) => {
      // We are the existing peer (polite): prepare; if both sides offer at
      // once, ours loses deterministically in onOffer.
      polite.current.set(id, true);
      makePC(id);
    };
    const onOffer = async ({ from, offer }: any) => {
      const pc = makePC(from);
      try {
        if (pc.signalingState !== "stable") {
          if (!polite.current.get(from)) {
            console.log("[voice] ignoring glare offer, ours wins");
            return;
          }
          await pc.setLocalDescription({ type: "rollback" });
        }
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        s.emit("voice-answer", { to: from, answer });
      } catch (e) {
        console.warn("[voice] offer handling failed, will re-negotiate", e);
      }
    };
    const onAnswer = async ({ from, answer }: any) => {
      try {
        await pcs.current.get(from)?.setRemoteDescription(answer);
      } catch (e) {
        console.warn("[voice] answer handling failed", e);
      }
    };
    const onIce = async ({ from, candidate }: any) => {
      try { await pcs.current.get(from)?.addIceCandidate(candidate); } catch {}
    };
    const onLeft = ({ id }: { id: string }) => {
      pcs.current.get(id)?.close();
      pcs.current.delete(id);
      gains.current.delete(id);
      polite.current.delete(id);
      updateLinkCount();
    };

    s.on("peers", onPeers);
    s.on("peer-joined", onPeerJoined);
    s.on("voice-offer", onOffer);
    s.on("voice-answer", onAnswer);
    s.on("voice-ice", onIce);
    s.on("peer-left", onLeft);
    // A socket reconnect means a fresh server-side identity: drop peer
    // connections tied to the old ids (App re-joins, then the mesh reforms).
    const onReconnect = () => {
      for (const pc of pcs.current.values()) {
        try { pc.close(); } catch {}
      }
      pcs.current.clear();
      gains.current.clear();
      polite.current.clear();
      setPeersLinked(0);
    };
    s.on("connect", onReconnect);
    void refreshDevices();

    // proximity volume loop (cheap: gains only)
    const iv = setInterval(() => {
      const st = getState();
      if (!st) return;
      const me = st.players.find((p) => p.id === myId);
      if (!me) return;
      for (const [pid, g] of gains.current) {
        const other = st.players.find((p) => p.id === pid);
        if (!other) { g.gain.gain.value = 0; continue; }
        const d = Math.hypot(me.x - other.x, me.y - other.y);
        const v = d < 350 ? 1 : d > 900 ? 0 : 1 - (d - 350) / 550;
        g.gain.gain.value = v;
      }
    }, 300);

    // diagnostics loop (1s): remote energy, track flags, RTP byte rates —
    // tells apart "nothing sent" from "sent but silent" from "muted output".
    const idiag = setInterval(() => {
      const st = getState();
      const me = st?.players.find((p) => p.id === myId);
      const peers: VoicePeerDiag[] = [];
      const jobs: Promise<void>[] = [];
      for (const [pid, pc] of pcs.current.entries()) {
        const other = st?.players.find((p) => p.id === pid);
        const g = gains.current.get(pid);
        let inLvl = 0;
        if (g) {
          try {
            const data = new Uint8Array(g.analyser.frequencyBinCount);
            g.analyser.getByteTimeDomainData(data as any);
            let sum = 0;
            for (const v of data) sum += Math.abs(v - 128);
            inLvl = Math.round((sum / data.length / 40) * 100) / 100;
          } catch {}
        }
        const track = g?.track;
        const entry: VoicePeerDiag = {
          id: pid.slice(0, 5),
          conn: pc.connectionState,
          track: !!g,
          gain: g ? Math.round(g.gain.gain.value * 100) / 100 : 0,
          dist: other && me ? Math.round(Math.hypot(me.x - other.x, me.y - other.y)) : null,
          rstate: track ? `${track.readyState}${track.muted ? "+muted" : ""}${track.enabled ? "" : "+disabled"}` : "-",
          inLvl,
          upBs: 0,
          downBs: 0,
        };
        peers.push(entry);
        jobs.push(
          pc.getStats().then((stats) => {
            let out = 0, inn = 0;
            stats.forEach((r: any) => {
              const audio = r.kind === "audio" || r.mediaType === "audio";
              if (r.type === "outbound-rtp" && audio) out += r.bytesSent || 0;
              if (r.type === "inbound-rtp" && audio) inn += r.bytesReceived || 0;
            });
            const prev = statLast.current.get(pid);
            const now = Date.now();
            if (prev && now > prev.t) {
              entry.upBs = Math.round(((out - prev.out) / (now - prev.t)) * 1000);
              entry.downBs = Math.round(((inn - prev.inn) / (now - prev.t)) * 1000);
            }
            statLast.current.set(pid, { t: now, out, inn });
          }).catch(() => {})
        );
      }
      void Promise.all(jobs).then(() => {
        const mine = localStream.current?.getAudioTracks()[0];
        // Which track objects are actually attached to senders? If these IDs
        // differ from the monitored mic track, sent≠monitored ⇒ silence.
        const senderIds: string[] = [];
        for (const pc of pcs.current.values()) {
          try {
            for (const snd of pc.getSenders()) {
              senderIds.push(snd.track ? snd.track.id.slice(0, 5) + (snd.track.enabled ? "+on" : "-off") : "none");
            }
          } catch {}
        }
        const out = mine
          ? `${mine.id.slice(0, 5)}${mine.enabled ? "+on" : "+off"}→[${senderIds.join(",") || "no-senders"}]${mutedRef.current ? " (muted)" : ""}`
          : "no-mic";
        setDiag({ ctx: ctxRef.current ? ctxRef.current.state : "none", out, peers });
      });
    }, 1000);

    return () => {
      clearInterval(iv);
      clearInterval(idiag);
      s.off("peers", onPeers);
      s.off("peer-joined", onPeerJoined);
      s.off("voice-offer", onOffer);
      s.off("voice-answer", onAnswer);
      s.off("voice-ice", onIce);
      s.off("peer-left", onLeft);
      s.off("connect", onReconnect);
      // Leaving the room: drop all voice peers so a later rejoin starts clean.
      for (const pc of pcs.current.values()) {
        try { pc.close(); } catch {}
      }
      pcs.current.clear();
      gains.current.clear();
      polite.current.clear();
      setPeersLinked(0);
    };
  }, [enabled, myId]);

  // mic level meter + speaking flag
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const tick = () => {
      if (analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteTimeDomainData(data as any);
        let sum = 0;
        for (const v of data) sum += Math.abs(v - 128);
        const lv = sum / data.length / 40;
        setLevel(lv);
        socket.emit("speaking", { speaking: !muted && lv > 0.08 });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const iv = setInterval(() => {}, 5000);
    return () => { cancelAnimationFrame(raf); clearInterval(iv); };
  }, [enabled, muted]);

  return { muted, level, toggleMute, cycleMic, resetMesh, devices, loadDevices: refreshDevices, peersLinked, diag, playTest };
}

export function distance(a: Player, b: Player) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
