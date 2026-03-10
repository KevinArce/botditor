# Story 15: Moderation Style Profiles

Feature area: Moderation Styles

Story:
As a moderator, I want to select Strict, Chill, or Comedy modes, so that moderation behavior matches our culture.

Acceptance criteria:
- Each mode maps to different thresholds and response tone.
- Modes can be changed without redeploy.

Feasibility rating: Medium

Justification:
Thresholds are easy; tone generation depends on AI.

Implementation notes:
- Implement threshold presets first, then optional AI tone.

Modified story:
As a moderator, I want preset threshold profiles (Strict and Chill), so that I can quickly switch moderation sensitivity without relying on AI tone.
