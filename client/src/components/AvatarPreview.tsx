import { useEffect, useRef } from "react";
import { drawPet, drawTraveler, isFlyingPet } from "../game/engine";
import type { Avatar } from "../game/avatar";
import type { Player } from "../net/socket";

type Props = {
  avatar: Avatar;
  name?: string;
  /** px square */
  size?: number;
  /** walk direction shown */
  dir?: string;
  /** animate a walk cycle vs idle breathing */
  walking?: boolean;
  /** show name tag like in-game */
  showName?: boolean;
};

/** Live WYSIWYG avatar renderer — uses the exact in-game drawTraveler. */
export default function AvatarPreview({
  avatar,
  name = "You",
  size = 200,
  dir = "down",
  walking = false,
  showName = true,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ avatar, dir, walking, name, showName });
  stateRef.current = { avatar, dir, walking, name, showName };

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const s = stateRef.current;
      const t = now - t0;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(W * dpr));
      canvas.height = Math.max(1, Math.floor(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // cozy backdrop: soft radial + dotted grass hint
      const bg = ctx.createRadialGradient(W / 2, H * 0.62, 8, W / 2, H * 0.62, W * 0.62);
      bg.addColorStop(0, "#8fd27a");
      bg.addColorStop(1, "#5d9c4c");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(0, 0, W, H, 18);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      for (let i = 0; i < 14; i++) {
        const px = ((i * 53) % W), py = ((i * 37) % H);
        ctx.beginPath();
        ctx.arc(px, py, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      // floor ellipse (sits under the feet)
      const scale = W / 100;
      const feetY = H * 0.62 + 6 + 21 * scale;
      ctx.fillStyle = "rgba(43,31,22,0.25)";
      ctx.beginPath();
      ctx.ellipse(W / 2, feetY, 30 * scale, 7 * scale, 0, 0, Math.PI * 2);
      ctx.fill();

      const step = s.walking ? Math.sin(t / 130) : 0;
      const p: Player = {
        id: "preview",
        name: s.name,
        color: s.avatar.color,
        avatar: s.avatar,
        x: 0, y: 0,
        dir: s.dir,
        moving: s.walking,
        z: 0,
        crouch: false,
      };
      ctx.save();
      ctx.translate(W / 2, H * 0.62);
      ctx.scale(scale, scale);
      ctx.translate(0, 6);
      drawTraveler(ctx, p, 0, 0, t, false, { step, z: 0, crouch: false });
      // mini-you, parked beside its owner like in-game
      if (s.avatar.pet && s.avatar.pet.kind !== "none") {
        const flying = isFlyingPet(s.avatar.pet.kind);
        drawPet(ctx, { ...s.avatar.pet }, 30, flying ? -26 : 14, t, s.dir);
      }
      ctx.restore();

      if (s.showName) {
        ctx.font = "800 13px Nunito, 'Trebuchet MS', sans-serif";
        ctx.textAlign = "center";
        const label = s.name || "You";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(43,31,22,0.7)";
        ctx.beginPath();
        ctx.roundRect(W / 2 - tw / 2 - 9, 10, tw + 18, 22, 11);
        ctx.fill();
        ctx.fillStyle = "#faf3df";
        ctx.fillText(label, W / 2, 25);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size, maxWidth: "100%", display: "block" }}
      aria-label="Avatar preview"
    />
  );
}
