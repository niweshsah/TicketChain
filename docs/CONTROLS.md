# Retained control checklist

| Page           | Control                                                | Behavior and validation                                                                              |
| -------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Navigation     | Brand, Discover, My tickets, Organizer                 | Real routes; organizer navigation is role-scoped                                                     |
| Navigation     | Sign in/out                                            | Memory-only access token, rotating HttpOnly cookie, private cache reset                              |
| Navigation     | Theme                                                  | Light/dark/system, pre-render application and system-change tracking                                 |
| Home           | Hero CTA, event cards, all events                      | Links derive from published events                                                                   |
| Home           | Previous/next, Pause/Play                              | Bounded carousel, hover/focus pause, reduced-motion disable                                          |
| Home           | Create event                                           | Role/authentication gate and organizer dashboard                                                     |
| Discovery      | Search, city, category, availability, sort, pagination | API-backed, bounded and deterministic                                                                |
| Event          | Choose tickets                                         | Event-specific checkout with live tier availability                                                  |
| Authentication | Login, register, role selection                        | Validation and retained form values; no admin registration                                           |
| Authentication | Google/GitHub continue and account connection          | Server-side OAuth, PKCE, single-use browser state, configured-provider feedback and explicit linking |
| Checkout       | Quantities, payment choice, Reserve                    | Maximum ten tickets; server calculates snapshots; scoped retry key                                   |
| Payment        | Continue, demo scenario, Pay                           | Durable setup, pending feedback, production demo prohibition                                         |
| Payment        | Razorpay checkout / Aptos hash                         | Test notices at the decision; server verifies evidence                                               |
| Orders         | Resume / status link                                   | Same order survives refresh; worker-driven pending/refund status                                     |
| Account        | QR reveal, download, manual copy                       | Owned paid valid tickets only; opaque code, no personal information                                  |
| Account        | Full refund                                            | Whole order, before start and wholly unused; immediate admission block                               |
| Account        | Wallet connect, verification, disconnect               | Optional lazy SDK, supported-scheme and signature rejection                                          |
| Account        | Collectible claim                                      | Single claim, recipient snapshot, configuration/eligibility feedback                                 |
| Organizer      | Create/edit/preview/publish                            | Validated tiers and dates; frozen sold prices/dates                                                  |
| Organizer      | Cancel confirmation / keep event                       | Concrete cancellation impact shown before action                                                     |
| Organizer      | Finish                                                 | Available after event end                                                                            |
| Check-in       | Manual entry, camera/start/stop                        | Permission/unsupported-browser feedback; single-use owned admission                                  |
| Check-in       | Attendees and totals                                   | Live status, currency-specific totals, no admission secrets in lists                                 |
| Footer         | Discover, organizer, brand                             | Real routes; no speculative social/contact actions                                                   |
| Microphone     | Attribution                                            | Preserved author and CC BY 4.0 link, static failure fallback                                         |

Browser automation covers attendee purchase/refund, organizer draft/publication/check-in, carousel pause, theme changes and horizontal overflow at desktop/mobile sizes. Screenshots capture both themes. Manual screenshot inspection checks responsive layout and the retained concert imagery, gradient treatment, cards, navigation and microphone. The original source layout informed the redesign; the reference video remains available for review, without a pixel comparison claim. Actual camera hardware and live wallet-provider signing require separate interactive checks; QR manual entry is automated. The wallet adapter and Three.js remain large optional bundles.

## October service and profile update

- Profile navigation: editable display name, connected providers, optional wallet, tickets link, organizer access.
- Organizer access: explicit same-account onboarding; ownership enforced by Booking.
- Theme selector removed; dark palette applied before render, including light system preference.
- Checkout: plus/minus controls, bounded numeric quantities, explanatory zero-quantity state, submission errors, live availability and idempotent retry.
- Waiting room: organizer enable control, join/leave, position feedback, expiring reservation opportunity, unavailable state.
- Concert imagery: eight locally hosted photographs; no placeholder image destinations.
