// The credits roll's data, ported off screens.js's CREDITS_FALLBACK/
// loadCredits (screens.js:384-420) unchanged — same file, same fallback, same
// "bad data is dropped, never trusted" rule.
const CREDITS_FALLBACK = {
  sections: [
    { role: "Created by", names: ["v-p-m"] },
    { role: "Code assistance", names: ["Claude (Anthropic)"] },
  ],
  footer: "Pure HTML5 Canvas · no engine, no dependencies",
};
let Credits = CREDITS_FALLBACK;

// Never throws and never rejects: the credits are decoration.
async function loadCredits() {
  try {
    const res = await fetch(`credits.json?v=${window.BUILD}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const sections = (Array.isArray(data.sections) ? data.sections : [])
      .filter((s) => s && typeof s.role === "string" && Array.isArray(s.names))
      .map((s) => ({
        role: s.role,
        names: s.names.filter((n) => typeof n === "string" && n.trim() !== ""),
      }))
      .filter((s) => s.names.length > 0);

    if (sections.length === 0) return; // keep the fallback rather than draw nothing
    Credits = {
      sections,
      footer:
        typeof data.footer === "string" ? data.footer : CREDITS_FALLBACK.footer,
    };
  } catch (err) {
    console.warn("credits.json unavailable, using the built-in roll:", err);
  }
}
