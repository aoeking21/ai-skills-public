# Provenance

This is an original JEV skill inspired by three public projects. It does not vendor their runtime code.

- nathanonn/agent-skills — ask-first
  - pinned repository commit: 9be9fcbe25ab549a6f46da372d9a2c9a1bc7cd59
  - source path: skills/ask-first/SKILL.md
  - adopted ideas: ambiguity scan, focused question batches, enough-confidence stop

- fabkury/twq
  - pinned repository commit: 3391d5b158b341363e9f2ae1ab25afb40a44ebc8
  - source path: SKILL.md
  - adopted ideas: ask-before-act when invoked, wait for answers, multi-round follow-up

- CyberZenithX/Rich-Elicitation-Skill
  - pinned repository commit: b3cc200139b79eaeec4372968ff5bf2b29b7ae1a
  - source path: SKILL.md
  - adopted ideas: ambiguity threshold, grouped questions, maximum rounds, intelligent stopping

JEV-specific changes:
- consult known context before asking
- maximum three highest-value questions in the default first round
- zero-question fast path for clear/simple tasks
- explicit user bypass
- Confirmed Task Brief
- integration with Capability / Skill / Agent / Model / Node routing
- no security-policy bypass
