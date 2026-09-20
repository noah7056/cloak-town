import ReactDOM from "react-dom/client";
import "./cozy.css";
import App from "./App";

// No StrictMode on purpose: in dev it double-mounts every component, which
// replays each menu's enter animation twice (visible flicker) and double-runs
// the canvas engine, socket listeners and auth session. Production builds
// ignore StrictMode anyway, so dropping it only removes dev-only glitches.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
