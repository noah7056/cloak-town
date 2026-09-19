export type FigureColors = {
  cloak: string;
  /** Hem color for two-tone cloaks; null = solid. */
  cloakEnd: string | null;
  trim: string;
  boots: string;
  skin: string;
};

const U = (f: string) => `${import.meta.env.BASE_URL}lobby/${f}`;

/** One tintable art layer: flat target color clipped to the layer's alpha,
 *  with the grayscaled art multiplied over it so all painted shading
 *  survives in the target hue. Pure CSS — no canvas. */
function TintLayer({ file, color, layer, gradientTo = null }: { file: string; color: string; layer: string; gradientTo?: string | null }) {
  const url = U(file);
  return (
    <div
      className="pp-fig-tint"
      data-l={layer}
      style={{
        background: gradientTo ? `linear-gradient(180deg, ${color}, ${gradientTo})` : color,
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
      }}
    >
      <img src={url} alt="" draggable={false} />
    </div>
  );
}

/** Foreground cloakling composited from separated art layers, each tinted
 *  to mirror the player's avatar (cloak/trim/boots/skin). Eyes + leaf
 *  always render exactly as painted. */
export default function TintedCloakling({ colors }: { colors: FigureColors }) {
  return (
    <div className="pp-fig" role="img" aria-label="Your cloakling">
      <TintLayer file="cloak.png" color={colors.cloak} layer="cloak" gradientTo={colors.cloakEnd} />
      <TintLayer file="boots.png" color={colors.boots} layer="boots" />
      <TintLayer file="face.png" color={colors.skin} layer="face" />
      <TintLayer file="accent.png" color={colors.trim} layer="accent" />
      <div className="pp-fig-plain">
        <img src={U("eyes.png")} alt="" draggable={false} />
      </div>
      <div className="pp-fig-plain">
        <img src={U("leaf.png")} alt="" draggable={false} />
      </div>
    </div>
  );
}
