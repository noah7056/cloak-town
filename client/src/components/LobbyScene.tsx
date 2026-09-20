import TintedCloakling from "./TintedCloakling";
import type { Avatar } from "../game/avatar";

type Props = {
  /** Player's avatar — the foreground PNG is recolored per region to it. */
  avatar: Avatar;
  /** Home-menu cloakling visibility (settings toggle). */
  showBuddy: boolean;
};

const BG_SRC = `${import.meta.env.BASE_URL}lobby/bg.jpg`;

/**
 * Home-screen scene: painted background + the player's cloakling floating
 * nearby, recolored per region (cloak/trim/boots/skin) to mirror their
 * avatar, bobbing gently. Floaters can be layered in later the same way
 * (absolute <img> + bob). The lobby controls sit directly over the art.
 */
export default function LobbyScene({ avatar, showBuddy }: Props) {
  return (
    <>
      <img
        src={BG_SRC}
        className="pp-lobby-bgimg"
        draggable={false}
        alt=""
      />
      {showBuddy && (
        <div className="pp-lobby-player" aria-hidden="true">
          <div className="pp-player-bob">
            <TintedCloakling
              colors={{
                cloak: avatar.color,
                cloakEnd: avatar.gradient ? avatar.cloakEnd : null,
                trim: avatar.trim,
                boots: avatar.boots,
                skin: avatar.skin,
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
