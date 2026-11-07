// In-memory work state for the AI order tab. It survives route unmounts,
// but is cleared when the user closes that tab or logs out.
export const aiOrderPageSession = {
  documents: [],
  selectedId: null,
  activeRequests: new Set(),
  abortControllers: new Map(),
};

export function clearAIOrderPageSession() {
  aiOrderPageSession.abortControllers.forEach((controller) => controller.abort());
  aiOrderPageSession.abortControllers.clear();
  aiOrderPageSession.activeRequests.clear();
  aiOrderPageSession.documents = [];
  aiOrderPageSession.selectedId = null;
}
