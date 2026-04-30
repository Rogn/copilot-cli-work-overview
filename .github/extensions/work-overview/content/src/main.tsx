import { createRoot } from "react-dom/client";
import { App, renderFatal } from "./App.js";

window.addEventListener("error", (event) => {
    renderFatal(event.message || "Unhandled window error", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
    renderFatal("Unhandled promise rejection", event.reason);
});

try {
    const rootEl = document.getElementById("root");
    if (!rootEl) {
        throw new Error("Missing #root element");
    }

    createRoot(rootEl).render(<App />);
} catch (error) {
    renderFatal("Top-level boot failure", error);
}
