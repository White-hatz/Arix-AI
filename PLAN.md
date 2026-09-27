# Plan: Remove "01" Version Label from Navigation Rail

## Summary
The user requested removing the "01" indicator written at the bottom of the left navigation rail.

## Architecture & Component Analysis
- The primary desktop application shell navigation rail is rendered by `frontend/src/components/NavigationRail.tsx`.
- At the bottom of `NavigationRail.tsx`, `<span className="rail-version">01</span>` is rendered directly beneath the Settings button.
- Related styling exists in `frontend/src/styles.css` under `.rail-version`.

## Affected Files
- `frontend/src/components/NavigationRail.tsx` (workspace relative)
- `frontend/src/styles.css` (workspace relative, optional cleanup of unused `.rail-version` class if no longer referenced elsewhere)

## Design Rationale
- Removing `<span className="rail-version">01</span>` from `NavigationRail.tsx` cleanly eliminates the hardcoded "01" label at the bottom of the left nav rail.
- Keeping or cleaning the `.rail-version` CSS rule will avoid residual unused CSS.

## Open Questions & Considerations
1. Should the version display be completely removed, or replaced with dynamic versioning from `package.json` (e.g. `v0.1.0` or hidden behind settings)?
2. Does the bottom padding/spacing of the navigation rail require minor adjustment once the version text element is omitted?
