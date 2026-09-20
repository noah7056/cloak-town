import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket, type RoomState } from "../net/socket";
import { Room, RoomEvent, RemoteParticipant, RemoteTrack, RemoteTrackPublication, Track, VideoPresets } from "livekit-client";

export type VoiceMode = "toggle" | "ptt";
export type VoiceOptions = {
  micDeviceId: string;
  voiceMode: VoiceMode;
  voiceKey: string;
  echoCancellation: boolean;
};
export type MicDevice = { deviceId: string; label: string };
export type VoicePeerDiag = {
  id: string;
  conn: string;
  track: boolean;
  gain: number;
  dist: number | null;
  rstate: string;
  inLvl: number;
  upBs: number;
  downBs: number;
};
export type VoiceDiag = { ctx: string; out: string; peers: VoicePeerDiag[] };

export function useVoice(
  myId: string,
  enabled: boolean,
  roomCode: string | null,
  name: string,
  getState: () => RoomState | null,
  opts: VoiceOptions = { micDeviceId: "", voiceMode: "toggle", voiceKey: "v", echoCancellation: true }
) {
  const [muted, setMuted] = useState(true);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [peersLinked, setPeersLinked] = useState(0);
  const [diag, setDiag] = useState<VoiceDiag>({ ctx: "livekit", out: "-", peers: [] });
  
  const roomRef = useRef<Room | null>(null);
  const mutedRef = useRef(true);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const socket = getSocket();

  // HTML Audio elements for remote tracks
  const audioElements = useRef(new Map<string, HTMLAudioElement>());

  const setMutedBoth = (m: boolean) => {
    mutedRef.current = m;
    setMuted(m);
    if (roomRef.current) {
      roomRef.current.localParticipant.setMicrophoneEnabled(!m).catch(console.warn);
    }
  };

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        list
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
      );
    } catch {}
  }, []);

  const micOn = useCallback(async () => {
    setMutedBoth(false);
    if (roomRef.current) {
      roomRef.current.startAudio().catch(() => {});
    }
  }, []);

  const micOff = useCallback(async () => {
    setMutedBoth(true);
  }, []);

  const toggleMute = useCallback(() => {
    if (mutedRef.current) void micOn();
    else void micOff();
  }, [micOn, micOff]);

  const cycleMic = useCallback(async () => {
    if (roomRef.current && optsRef.current.micDeviceId) {
      await roomRef.current.switchActiveDevice("audioinput", optsRef.current.micDeviceId);
    }
  }, []);

  const resetMesh = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
  }, []);

  const playTest = useCallback(() => {
    try {
      const actx = new AudioContext();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.frequency.value = 660;
      g.gain.value = 0.2;
      o.connect(g);
      g.connect(actx.destination);
      o.start();
      o.stop(actx.currentTime + 0.25);
    } catch {}
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void cycleMic();
  }, [opts.micDeviceId, enabled, cycleMic]);

  // Voice activation keybind
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

  // LiveKit Connection
  useEffect(() => {
    if (!enabled || !myId || !roomCode) return;

    let active = true;
    let room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        autoGainControl: true,
        echoCancellation: optsRef.current.echoCancellation,
        noiseSuppression: true,
        deviceId: optsRef.current.micDeviceId,
      }
    });
    roomRef.current = room;

    const connectToLiveKit = () => {
      socket.emit("get-voice-token", { roomCode, name }, async (res: any) => {
        if (!active) return;
        if (res.error) {
          console.error("[voice] LiveKit token error:", res.error);
          return;
        }
        try {
          await room.connect(res.url, res.token);
          console.log("[voice] Connected to LiveKit");
          
          if (!mutedRef.current) {
            await room.localParticipant.setMicrophoneEnabled(true);
          }
          
          setPeersLinked(room.remoteParticipants.size);
        } catch (e) {
          console.error("[voice] LiveKit connect error:", e);
        }
      });
    };

    connectToLiveKit();

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        document.body.appendChild(el);
        audioElements.current.set(participant.identity, el);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach();
        const el = audioElements.current.get(participant.identity);
        if (el) {
          el.remove();
          audioElements.current.delete(participant.identity);
        }
      }
    });

    room.on(RoomEvent.ParticipantConnected, () => setPeersLinked(room.remoteParticipants.size));
    room.on(RoomEvent.ParticipantDisconnected, () => setPeersLinked(room.remoteParticipants.size));

    return () => {
      active = false;
      room.disconnect();
      roomRef.current = null;
      audioElements.current.forEach(el => el.remove());
      audioElements.current.clear();
      setPeersLinked(0);
    };
  }, [enabled, myId, roomCode, name]);

  // Proximity volume loop (300ms)
  useEffect(() => {
    if (!enabled) return;
    const iv = setInterval(() => {
      const st = getState();
      const me = st?.players.find(p => p.id === myId);
      if (!st || !me) return;

      audioElements.current.forEach((el, identity) => {
        const other = st.players.find(p => p.id === identity);
        if (!other) {
          el.volume = 0;
          return;
        }
        // the café walls are thick: no hearing through the door
        if (((other as any).area || null) !== ((me as any).area || null)) {
          el.volume = 0;
          return;
        }
        const d = Math.hypot(me.x - other.x, me.y - other.y);
        const v = d < 350 ? 1 : d > 900 ? 0 : 1 - (d - 350) / 550;
        el.volume = Math.max(0, Math.min(1, v));
      });
    }, 300);
    return () => clearInterval(iv);
  }, [enabled, myId, getState]);

  // Level meter and speaking indicator loop
  useEffect(() => {
    if (!enabled) return;
    const iv = setInterval(() => {
      if (roomRef.current) {
        const p = roomRef.current.localParticipant;
        setLevel(p.audioLevel);
        socket.emit("speaking", { speaking: p.isSpeaking });
        
        // Update Diag
        const peers: VoicePeerDiag[] = [];
        roomRef.current.remoteParticipants.forEach((rp) => {
          peers.push({
            id: rp.identity.slice(0, 5),
            conn: "connected",
            track: audioElements.current.has(rp.identity),
            gain: audioElements.current.get(rp.identity)?.volume || 0,
            dist: null,
            rstate: rp.isSpeaking ? "speaking" : "silent",
            inLvl: Math.round(rp.audioLevel * 100),
            upBs: 0,
            downBs: 0,
          });
        });
        setDiag({ ctx: "livekit", out: muted ? "muted" : "live", peers });
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [enabled, muted]);

  return { muted, level, toggleMute, cycleMic, resetMesh, devices, loadDevices: refreshDevices, peersLinked, diag, playTest };
}
