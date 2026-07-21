/**
 * WebSocket test for Dead Earth Protocol
 * Connect, auth, inspect colony_state, try building upgrade
 */
const WebSocket = require('ws');
const https = require('https');
const http = require('http');

const BASE = 'death-earth-protocol-production.up.railway.app';
const TOKEN = process.argv[2] || '36e24b5a3b0d8eaa7b0e4c352582b1a2eb61a27691578bef1990687f47b984f6';
const USERNAME = 'NovaBot';

// ——— WebSocket Connection ———
const url = `wss://${BASE}/`;
console.log(`Connecting to ${url}...`);
const ws = new WebSocket(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; NovaBot/1.0)'
  }
});

let colonyReceived = false;

ws.on('open', () => {
  console.log('✅ WebSocket connected');
  
  // Send auth
  const authMsg = JSON.stringify({ type: 'auth', token: TOKEN, username: USERNAME });
  ws.send(Buffer.from(authMsg));
  console.log('📤 Auth sent');
});

ws.on('message', (data) => {
  const raw = data.toString();
  console.log(`📥 ${raw.substring(0, 200)}${raw.length > 200 ? '...' : ''}`);
  
  try {
    const msg = JSON.parse(raw);
    
    if (msg.type === 'auth_ok') {
      console.log('✅ Auth OK — waiting for colony_state');
    }
    
    if (msg.type === 'colony_state') {
      colonyReceived = true;
      console.log('\n═══ COLONY STATE RECEIVED ═══');
      
      const c = msg.colony;
      console.log(`Planet: ${c.planetName}`);
      console.log(`\n--- Resources ---`);
      Object.entries(c.resources).forEach(([k, v]) => {
        console.log(`  ${k}: ${v.amount} / ${v.cap} (prod: ${v.production})`);
      });
      
      console.log(`\n--- Buildings ---`);
      Object.entries(c.buildings).forEach(([k, v]) => {
        console.log(`  ${k}: level ${v.level}, integrity ${v.integrity}, upgrading: ${JSON.stringify(v.upgrading)}`);
      });
      
      console.log(`\n--- Shield ---`);
      console.log(`  ${c.shield.current} / ${c.shield.max}`);
      
      console.log(`\n--- Universe ---`);
      if (msg.universe && msg.universe.galaxies) {
        const gs = msg.universe.galaxies;
        console.log(`  Galaxies: ${gs.length}`);
        if (gs.length > 0) {
          const secs = gs[0].sectors || [];
          console.log(`  Sectors in G1: ${secs.length}`);
          if (secs.length > 0) {
            const planets = secs[0].planets || [];
            console.log(`  Planets in G1-S1: ${planets.length}`);
            // Show planet info
            planets.forEach(p => {
              console.log(`    ${p.name} (${p.type}) colonizedBy=${p.colonizedBy || 'none'}`);
            });
          }
        }
      }
      
      // Now try upgrading a building
      console.log(`\n═══ TRYING BUILDING UPGRADE ═══`);
      // Pick the first building
      const buildingKeys = Object.keys(c.buildings);
      if (buildingKeys.length > 0) {
        const target = buildingKeys[0];
        console.log(`Attempting upgrade: ${target} (level ${c.buildings[target].level})`);
        
        const upgradeMsg = JSON.stringify({ type: 'build', buildingId: target });
        ws.send(Buffer.from(upgradeMsg));
        console.log(`📤 Build request sent for ${target}`);
      }
    }
    
    if (msg.type === 'build_result') {
      console.log(`\n✅ BUILD RESULT: ok=${msg.ok}`);
      if (msg.ok) {
        console.log(`   New colony state received — upgrade succeeded!`);
        const c = msg.colony;
        Object.entries(c.buildings).forEach(([k, v]) => {
          console.log(`  ${k}: level ${v.level}, upgrading: ${JSON.stringify(v.upgrading)}`);
        });
      } else {
        console.log(`   Error: ${msg.reason || msg.error || 'unknown'}`);
      }
    }
    
  } catch(e) {
    // raw message that's not JSON
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
});

ws.on('close', () => {
  console.log('\n🔌 WebSocket closed');
  if (!colonyReceived) {
    console.log('⚠️  Never received colony_state!');
  }
  process.exit(0);
});

// Timeout after 15 seconds
setTimeout(() => {
  console.log('\n⏰ Timeout — closing');
  ws.close();
}, 15000);
