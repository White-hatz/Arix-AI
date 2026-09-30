/**
 * Shared sizing and styling tokens for Arix Voice Orbs.
 * Centralized so Home Voice Workspace, Assistant Stage, and Desktop Overlay stay visually consistent.
 */
export const ORB_TOKENS = {
  jules: {
    // Reduced by ~25-30% from 520px so it no longer dominates the container
    homeSize: 360,
    homeContainerWidth: 'min(420px, 75vw)',
    homeContainerHeight: 'min(420px, 50vh)',
    overlaySize: 140,
    assistantSize: 220,
  },
  quantum: {
    // Increased by ~30% for strong visual presence on Home
    rootScaleHome: 0.84,      // increased from 0.64
    rootScaleOverlay: 0.52,   // tailored for small compact desktop overlay
    homeContainerWidth: 'min(840px, 92vw)',
    homeContainerHeight: 'min(580px, 62vh)',
    maxBufferWidth: 880,
    maxBufferHeight: 600,
    overlaySize: 170,
    assistantSize: 240,
  },
  classic: {
    homeSize: 380,
    overlaySize: 140,
    assistantSize: 220,
  },
} as const
