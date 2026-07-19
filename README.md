# Dead Earth Protocol

A browser-based dark sci-fi strategy prototype built with only HTML, CSS, and vanilla JavaScript.

## Features
- Single-page command dashboard
- Resource production and caps
- Building upgrades, integrity, and repairs
- Troop training queue
- Research progression
- Enemy scouting and raids
- Incoming attacks and defense reports
- World map with selectable nodes
- Expeditions to resource nodes
- Market exchange and artifact purchases
- Artifact inventory
- Alliance perks with gameplay impact
- Activatable timed events
- Commander customization with theme accent swap
- Missions with rewards
- Mailbox with report tabs
- Rolling command log
- localStorage save/load with normalization-safe structure

## Setup
1. Create the folder structure exactly as specified.
2. Save each file into place.
3. Open `index.html` in any modern browser.

No server or build step is required.

## Suggested Test Checklist
- Verify resources increase every second.
- Upgrade a building from its modal.
- Damage a building by waiting for or triggering attacks, then repair it.
- Train troops and confirm queue completion.
- Start a research project and let it complete.
- Select an enemy node, scout it, then raid it.
- Wait for an incoming attack and inspect the defense report.
- Launch expeditions to resource nodes and confirm rewards.
- Use Market Nexus exchange and buy an artifact listing.
- Join and leave alliances and observe perk effects.
- Activate an event from Communications Hub.
- Edit commander profile and change theme accent.
- Claim mission rewards when objectives are met.
- Reload the page and confirm save persistence.
- Reset save and confirm a clean restart.

## Known Limitations
- Prototype is offline-first and single-player only.
- Combat uses simplified aggregate calculations rather than tactical battlefield simulation.
- Buildings do not yet have unique sub-upgrades beyond their core system effects.
- Enemy bases are generated from node threat level rather than persistent independent world states.
- Expedition fleets are abstracted and do not consume troop detachments yet.
- No audio, animations beyond CSS glow/progress, or backend services are included.
- MMO evolution hooks are conceptual via modular systems and data-driven state, but no networking exists yet.