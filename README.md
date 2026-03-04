# Fartman - The Office Stealth Game

A side-scrolling stealth game where you play as Fartman, an office worker with a gassy problem. Navigate through the office, manage your gas meter, and reach the restroom without dying of embarrassment!

## How to Play

- **Arrow Keys (← →)** - Move left/right
- **Hold SPACE** - Slowly release gas (quiet, small detection radius)
- Your gas meter fills up constantly
- At **100% gas**, you'll have an uncontrollable **BIG BLAST** (loud, 2x detection radius, knocks out nearby distractions)
- Release gas near **noisy distractions** (printers, sick coworkers, maintenance workers) to mask the sound
- If a **coworker hears you**, you die of embarrassment - Game Over!
- Reach the **restroom** at the end of the level to win

## Distractions

| Type | Description |
|------|-------------|
| Loud Printer | Mechanical whirring masks nearby farts |
| Sick Coworker | Constant sneezing provides sound cover |
| Maintenance Worker | Drilling noise hides your gas |

**Warning:** A 100% gas blast will knock out nearby distractions for 5 seconds!

## Play

Open `index.html` in any modern browser. No dependencies or build step required.

## Tech

Built with vanilla JavaScript and HTML5 Canvas. All sound effects are generated in real-time using the Web Audio API - no external audio files needed.
