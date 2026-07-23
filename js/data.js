window.GameData = {
  saveVersion: 1,
  resources: {
    ore: { name: "Ore", capBase: 1200, color: "#c7d3dd" },
    solar: { name: "Solar", capBase: 1100, color: "#ffd166" },
    crystal: { name: "Crystal", capBase: 900, color: "#bf7bff" },
    isotopes: { name: "Isotopes", capBase: 700, color: "#69f0ae" }
  },

  buildings: {
    communicationsHub: {
      name: "Communications Hub",
      image: "assets/buildings/communications-hub.svg",
      effectText: "Activates world events and improves regional signal intelligence.",
      baseCost: { ore: 120, solar: 90, crystal: 40 },
      timeBase: 30,
      stat: "signal"
    },
    trainingFacility: {
      name: "Training Facility",
      image: "assets/buildings/training-facility.svg",
      effectText: "Improves troop training throughput and unlocks stronger force projection.",
      baseCost: { ore: 140, solar: 70, crystal: 30 },
      timeBase: 35,
      stat: "training"
    },
    extractionGrid: {
      name: "Extraction Grid",
      image: "assets/buildings/extraction-grid.svg",
      effectText: "Raises raw material harvesting rates across the colony network.",
      baseCost: { ore: 80, solar: 80, crystal: 60 },
      timeBase: 28,
      stat: "economy"
    },
    radarArray: {
      name: "Radar Array",
      image: "assets/buildings/radar-array.svg",
      effectText: "Improves scouting outcomes and early warning against incoming attacks.",
      baseCost: { ore: 100, solar: 100, crystal: 50 },
      timeBase: 30,
      stat: "recon"
    },
    defenseBunker: {
      name: "Warehouse",
      image: "assets/buildings/warehouse.svg",
      effectText: "Expands resource storage capacity across the colony. Each level increases all resource caps.",
      baseCost: { ore: 160, solar: 60, crystal: 20 },
      timeBase: 40,
      stat: "storage"
    },
    shieldGenerator: {
      name: "Shield Generator",
      image: "assets/buildings/shield-generator.svg",
      effectText: "Increases shield capacity and recharge resilience.",
      baseCost: { ore: 100, solar: 140, crystal: 60 },
      timeBase: 42,
      stat: "shield"
    },
    researchLab: {
      name: "Research Lab",
      image: "assets/buildings/research-lab.svg",

      effectText: "Accelerates strategic research and deep tech adaptation.",
      baseCost: { ore: 100, solar: 80, crystal: 100 },
      timeBase: 45,
      stat: "research"
    },
    marketNexus: {
      name: "Market Nexus",
      image: "assets/buildings/market-nexus.svg",
      effectText: "Improves exchange efficiency and expands artifact acquisition channels.",
      baseCost: { ore: 110, solar: 110, crystal: 80 },
      timeBase: 38,
      stat: "market"
    },
    tradePodTerminal: {
      name: "Trade Pod Terminal",
      image: "assets/buildings/trade-pod-terminal.svg",
      effectText: "Improves expedition payloads and artifact recovery return rates.",
      baseCost: { ore: 90, solar: 100, crystal: 70 },
      timeBase: 36,
      stat: "expedition"
    }
  },

  troops: {
    reconScout: {
      name: "Recon Scout",
      image: "assets/buildings/troops/recon-scout.svg",
      cost: { ore: 30, solar: 20, crystal: 8, isotopes: 2 },
      upkeep: 0.00015, power: 8, defense: 4, role: "Scout", trainTime: 12,
      traits: ["scout"]
    },
    rifleUnit: {
      name: "Rifle Unit",
      image: "assets/buildings/troops/rifle-unit.svg",
      cost: { ore: 40, solar: 25, crystal: 10, isotopes: 3 },
      upkeep: 0.0002, power: 12, defense: 8, role: "Line", trainTime: 15,
      traits: []
    },
    heavyTrooper: {
      name: "Heavy Trooper",
      image: "assets/buildings/troops/heavy-trooper.svg",
      cost: { ore: 55, solar: 30, crystal: 14, isotopes: 4 },
      upkeep: 0.0003, power: 18, defense: 13, role: "Assault", trainTime: 20,
      traits: []
    },
    siegeMech: {
      name: "Siege Mech",
      image: "assets/buildings/troops/siege-mech.svg",
      cost: { ore: 90, solar: 45, crystal: 24, isotopes: 7 },
      upkeep: 0.00055, power: 28, defense: 18, role: "Siege", trainTime: 35,
      traits: ["siege"]
    },
    droneSwarm: {
      name: "Drone Swarm",
      image: "assets/buildings/troops/drone-swarm.svg",
      cost: { ore: 50, solar: 45, crystal: 16, isotopes: 4 },
      upkeep: 0.00025, power: 14, defense: 7, role: "Harass", trainTime: 18,
      traits: ["swarm"]
    },
    sniperCell: {
      name: "Sniper Cell",
      image: "assets/buildings/troops/sniper-cell.svg",
      cost: { ore: 48, solar: 30, crystal: 18, isotopes: 4 },
      upkeep: 0.00025, power: 17, defense: 6, role: "Precision", trainTime: 19,
      traits: ["precision"]
    },
    shieldGuard: {
      name: "Shield Guard",
      image: "assets/buildings/troops/shield-guard.svg",
      cost: { ore: 60, solar: 35, crystal: 20, isotopes: 5 },
      upkeep: 0.00035, power: 13, defense: 19, role: "Defense", trainTime: 22,
      traits: ["supportShield"]
    },
    plasmaTank: {
      name: "Plasma Tank",
      image: "assets/buildings/troops/plasma-tank.svg",
      cost: { ore: 120, solar: 70, crystal: 28, isotopes: 9 },
      upkeep: 0.0007, power: 36, defense: 25, role: "Armor", trainTime: 42,
      traits: ["shieldBreak"]
    },
    empSpecialist: {
      name: "EMP Specialist",
      image: "assets/buildings/troops/emp-specialist.svg",
      cost: { ore: 68, solar: 45, crystal: 22, isotopes: 6 },
      upkeep: 0.0004, power: 16, defense: 10, role: "Tech", trainTime: 24,
      traits: ["shieldBreak"]
    },
    prototypeUnit: {
      name: "Prototype Unit",
      image: "assets/buildings/troops/prototype-unit.svg",
      cost: { ore: 180, solar: 110, crystal: 50, isotopes: 15 },
      upkeep: 0.001, power: 55, defense: 34, role: "Prototype", trainTime: 65,
      traits: ["siege", "shieldBreak"]
    }
  },

  research: {
    economy: {
      name: "Economy Research",
      desc: "Increases overall resource production.",
      baseCost: { ore: 120, solar: 100, crystal: 90, isotopes: 20 },
      durationBase: 45
    },
    military: {
      name: "Military Research",
      desc: "Increases troop combat power.",
      baseCost: { ore: 130, solar: 90, crystal: 100, isotopes: 25 },
      durationBase: 50
    },
    defense: {
      name: "Defense Research",
      desc: "Improves shield and defensive resilience.",
      baseCost: { ore: 110, solar: 110, crystal: 95, isotopes: 20 },
      durationBase: 48
    }
  },

  alliances: [
    {
      id: "iron-sigil",
      name: "Iron Sigil Pact",
      image: "assets/alliances/iron-sigil.svg",
      perkType: "economy",
      perkValue: 0.12,
      notices: ["Extraction sectors stabilized.", "Shared ore convoy routing active."],
      members: ["Astra-9", "Vel Mourne", "Kestrel Unit", "Null Harbor"]
    },
    {
      id: "aeon-lattice",
      name: "Aeon Lattice",
      image: "assets/alliances/aeon-lattice.svg",
      perkType: "research",
      perkValue: 0.15,
      notices: ["Data vault exchange window open.", "Relay scientists available for support."],
      members: ["Dr. Sel", "Orion Crest", "Helix Dawn", "Proxy-17"]
    },
    {
      id: "red-vanguard",
      name: "Red Vanguard",
      image: "assets/alliances/red-vanguard.svg",

      perkType: "military",
      perkValue: 0.12,
      notices: ["Forward strike doctrine uploaded.", "Militia synchronization active."],
      members: ["Morrow Lance", "Black Tide", "Karst", "Sable Wake"]
    }
  ],

  events: [
    {
      id: "artifactStorm",
      name: "Artifact Storm",
      desc: "Anomalous debris fields raise artifact recovery chance.",
      duration: 180,
      effect: { artifactChanceBonus: 0.18 }
    },
    {
      id: "isotopeSurge",
      name: "Isotope Surge",
      desc: "Volatile fissile seams increase isotope gains.",
      duration: 180,
      effect: { isotopeBoost: 0.35, expeditionIsotopeBonus: 0.4 }
    },
    {
      id: "warzoneEscalation",
      name: "Warzone Escalation",
      desc: "Hostile movements intensify across nearby sectors.",
      duration: 180,
      effect: { attackPressure: 0.2 }
    },
    {
      id: "researchBreakthrough",
      name: "Research Breakthrough",
      desc: "Rapid theory convergence reduces research durations.",
      duration: 180,
      effect: { researchTimeReduction: 0.25 }
    },
    {
      id: "allianceReliefWindow",
      name: "Alliance Relief Window",
      desc: "Friendly corridors occasionally deliver support packages.",
      duration: 180,
      effect: { reliefDrops: true }
    }
  ],

  artifacts: [
    { id: "quantum-shard", name: "Quantum Shard", image: "assets/artifacts/quantum-shard.svg", rarity: "Rare", type: "Science" },
    { id: "void-core", name: "Void Core", image: "assets/artifacts/void-core.svg", rarity: "Epic", type: "Power" },
    { id: "relay-spindle", name: "Relay Spindle", image: "assets/artifacts/relay-spindle.svg", rarity: "Common", type: "Comms" },
    { id: "exo-plating", name: "Exo Plating", image: "assets/artifacts/exo-plating.svg", rarity: "Uncommon", type: "Military" },
    { id: "sun-sigil", name: "Sun Sigil", image: "assets/artifacts/sun-sigil.svg", rarity: "Rare", type: "Economy" }
  ],

  marketListings: [
    { id: "m1", artifactId: "relay-spindle", price: { ore: 100, solar: 70, crystal: 20, isotopes: 8 } },
    { id: "m2", artifactId: "exo-plating", price: { ore: 140, solar: 80, crystal: 40, isotopes: 12 } },
    { id: "m3", artifactId: "quantum-shard", price: { ore: 180, solar: 120, crystal: 70, isotopes: 18 } },
    { id: "m4", artifactId: "sun-sigil", price: { ore: 220, solar: 160, crystal: 80, isotopes: 20 } }
  ],

  emblems: ["Δ", "☲", "⬢", "✦", "⟠", "⟁"],
  themes: [
    { id: "cyan", name: "Cyan", color: "#58d6ff" },
    { id: "violet", name: "Violet", color: "#9a7dff" },
    { id: "amber", name: "Amber", color: "#ffb84d" },
    { id: "emerald", name: "Emerald", color: "#46e6b0" }
  ],

  ranks: [
    { name: "Initiate", threshold: 0 },
    { name: "Warden", threshold: 3 },
    { name: "Marshal", threshold: 7 },
    { name: "Executor", threshold: 12 },
    { name: "Protocol Prime", threshold: 18 }
  ],

    mapNodes: [
    { id: "n-home", type: "player", region: "r1", regionName: "Ash Meridian", sector: "A-01", threatLevel: 1, icon: "⌂", name: "Command Bastion", desc: "Primary colony command base in the starter basin.", x: 18, y: 68, connections: ["n-resource-1", "n-enemy-1"] },

    { id: "n-enemy-1", type: "enemy", region: "r1", regionName: "Ash Meridian", sector: "A-03", threatLevel: 2, icon: "⚠", name: "Scavenger Nest", desc: "Light raider outpost with fragmented defenses.", x: 34, y: 58, connections: ["n-home", "n-resource-1", "n-enemy-2"] },

    { id: "n-enemy-2", type: "enemy", region: "r1", regionName: "Ash Meridian", sector: "A-06", threatLevel: 3, icon: "☠", name: "Iron Spire Hold", desc: "Fortified hostile base with bunker support.", x: 52, y: 44, connections: ["n-enemy-1", "n-resource-2", "n-alliance-1"] },

    { id: "n-resource-1", type: "resource", region: "r1", regionName: "Ash Meridian", sector: "A-04", threatLevel: 1, icon: "⛏", name: "Shale Rift", desc: "Recoverable ore and isotope fragments.", x: 28, y: 79, connections: ["n-home", "n-enemy-1", "n-resource-2"] },

    { id: "n-resource-2", type: "resource", region: "r2", regionName: "Glass Barrens", sector: "B-02", threatLevel: 2, icon: "◈", name: "Crystal Grave", desc: "Dense crystal shard fields beneath irradiated glass dunes.", x: 60, y: 71, connections: ["n-resource-1", "n-enemy-2", "n-alliance-1"] },

    { id: "n-alliance-1", type: "alliance", region: "r2", regionName: "Glass Barrens", sector: "B-05", threatLevel: 1, icon: "⟡", name: "Relay Outpost Sigma", desc: "Shared neutral relay used by alliance envoys and convoy drones.", x: 77, y: 54, connections: ["n-resource-2", "n-enemy-2", "n-enemy-3"] },

    { id: "n-enemy-3", type: "enemy", region: "r3", regionName: "Black Scar", sector: "C-01", threatLevel: 4, icon: "☢", name: "Wraith Foundry", desc: "Heavy war-machine enclave with strong shield signatures.", x: 86, y: 24, connections: ["n-alliance-1"] }
  ],

  missions: [
    { id: "mission-build-3", name: "Raise the Grid", type: "buildingLevel", targetKey: "extractionGrid", target: 3, reward: { ore: 180, solar: 120 }, desc: "Upgrade Extraction Grid to level 3." },
    { id: "mission-troops-15", name: "Standing Force", type: "troopCount", target: 15, reward: { ore: 120, isotopes: 35 }, desc: "Train 15 total troops." },
    { id: "mission-research-2", name: "Adaptive Theory", type: "researchCount", target: 2, reward: { crystal: 120, solar: 80 }, desc: "Complete 2 research levels." },
    { id: "mission-scout-2", name: "Eyes Beyond Dust", type: "scoutCount", target: 2, reward: { ore: 100, crystal: 60 }, desc: "Scout 2 enemy bases." },
    { id: "mission-attack-2", name: "Suppress Hostiles", type: "attackWins", target: 2, reward: { ore: 150, solar: 90, isotopes: 25 }, desc: "Win 2 raids." },
    { id: "mission-defense-2", name: "Hold the Line", type: "defenseWins", target: 2, reward: { crystal: 100, isotopes: 50 }, desc: "Repel 2 attacks." }
  ]
};