# TapKit OAuth Consent Design QA

## Comparison target

- Source visual truth: `/Users/toddlittlejohn/.codex/generated_images/019fb06e-ae3c-7c21-96dd-f61d1cc47f29/exec-2cca8bbe-b47e-4697-be4e-40ab37996aa6.png`
- User-directed deviation: remove the entire `Signed in as …` identity row.
- Browser-rendered implementation: `/private/tmp/tapkit-consent-implementation-1.png`
- Full-view side-by-side evidence: `/private/tmp/tapkit-consent-comparison-1.png`
- Focused card comparison: `/private/tmp/tapkit-consent-focus-1.png`
- Responsive evidence: `/private/tmp/tapkit-consent-mobile-viewport.png`
- Desktop viewport and source pixels: 1117 × 1408.
- Browser CSS viewport: 1117 × 1408 at device pixel ratio 2; the browser capture was normalized to 1117 × 1408 CSS-pixel resolution for direct comparison with the 1117 × 1408 source.
- Responsive viewport checked: 390 × 844; card width 347 px with no horizontal overflow.
- State: ChatGPT client requesting TapKit access, consent not yet submitted.

## Full-view comparison

The rendered page uses a fixed TapKit lockup and a compact centered 500 px white card with a restrained border and shadow, app icon, centered heading/subtitle, two emoji-led permission rows, request origin, black primary action, outlined secondary action, and legal links. Dynamic request-origin text reflects the actual registered callback host rather than hard-coded mock content.

## Focused comparison

The focused card evidence was used to inspect typography, dividers, emoji scale, permission-row rhythm, button sizing, radii, and legal-link spacing. Important details are readable at this crop, so no additional region crop was required.

## Required fidelity surfaces

- Fonts and typography: hierarchy, weight, line height, wrapping, and letter spacing match the source closely. The implementation intentionally uses a secure system-font stack rather than adding a remote font dependency; this is an acceptable P3-level difference from the Inter-like mock.
- Spacing and layout rhythm: the compact 500 px desktop card uses 32 px horizontal padding, a 72 px app icon, 56 px permission rows, 48 px actions, and reduced section gaps. The card now occupies only the space needed by its contents.
- Colors and visual tokens: `#fafafa` page, white card, `#111` text, `#666` secondary copy, `#e5e5e5` borders, `#007aff` accents, and black primary CTA are consistent with the existing TapKit auth surface and selected mock.
- Image quality and asset fidelity: the page uses TapKit's existing 180 × 180 app-icon asset at a smaller display size. Permission rows use native eye and pointing-finger emoji.
- Copy and content: both requested capabilities, origin, action, legal, and support copy are present. The former checkout safety row and account identity copy are absent. Client name and callback host remain escaped dynamic values.

## Interaction and responsive checks

- Both consent buttons render as enabled native submit buttons.
- Automated protocol coverage verifies POST action, hidden transaction and consent tokens, `approve`/`deny` decision values, final redirects, legal links, and the absence of identity copy.
- Focus-visible, hover, active, reduced-motion, and mobile layout styles are present.
- At 390 × 844 the page scrolls vertically, keeps all controls reachable, and does not overflow horizontally.
- Browser console errors/warnings checked: none.

## Comparison history

- Pass 1: no actionable P0, P1, or P2 mismatch found. No visual fixes were required after the first browser comparison.
- Pass 2: condensed the card from 572 × 917 px to 500 × 604 px in the desktop render, removed the checkout safety row, and replaced the permission checks with emoji. No browser console errors or horizontal overflow were introduced.

## Findings

- No actionable P0, P1, or P2 findings.
- P3: the system-font stack can differ subtly from Inter/Space Grotesk on non-Apple platforms; this is acceptable because it avoids an external font/CSP dependency on the OAuth security surface.

## Implementation checklist

- [x] Preserve OAuth POST semantics and one-time hidden values.
- [x] Preserve no-store, no-referrer, nosniff, frame, base, and dynamic form-action protections.
- [x] Restrict inline styling to a per-response CSP nonce and images to same-origin assets.
- [x] Remove the identity row.
- [x] Verify desktop and responsive layouts.
- [x] Verify tests, typecheck, build, and browser console.

## Follow-up polish

- None required for launch.

final result: passed
