// MEMES 24H Governance - 6529 API Client
// Handles profile lookup, TDH, consolidation/delegation resolution

import { CONFIG } from './config.js';

const profileCache = new Map();

// Resolve a wallet address to its full 6529 identity
// Handles consolidation (delegate wallets -> primary identity)
export async function resolveIdentity(address) {
  const addr = address.toLowerCase();

  // Check cache
  const cached = profileCache.get(addr);
  if (cached && Date.now() - cached.ts < CONFIG.CACHE_PROFILE_TTL) {
    return cached.data;
  }

  try {
    const res = await fetch(`${CONFIG.API_6529}/profiles/${addr}`);
    const data = await res.json();

    const identity = {
      address: addr,
      primaryAddress: addr,
      handle: null,
      tdh: 0,
      rep: 0,
      level: 0,
      pfp: null,
      cic: 0,
      isDelegate: false,
      consolidationWallets: []
    };

    // Check consolidation
    if (data.consolidation) {
      const wallets = data.consolidation.wallets || [];
      identity.consolidationWallets = wallets.map(w => w.wallet.address);
      identity.tdh = data.consolidation.tdh || 0;
      identity.primaryAddress = data.consolidation.consolidation_key || addr;
    }

    // Check profile
    if (data.profile) {
      identity.handle = data.profile.handle;
      identity.pfp = data.profile.pfp || null;
    }

    identity.level = data.level || 0;
    identity.rep = data.rep || 0;
    identity.cic = data.cic?.cic_rating || 0;

    // Check if connected wallet is a delegate (not the primary)
    if (identity.primaryAddress.toLowerCase() !== addr) {
      identity.isDelegate = true;
    }

    // If no handle from profile, try to get it from the consolidation display
    if (!identity.handle && data.consolidation?.consolidation_display) {
      const display = data.consolidation.consolidation_display;
      // If it looks like a handle (not an address), use it
      if (!display.startsWith('0x')) {
        identity.handle = display;
      }
    }

    // Cache
    profileCache.set(addr, { data: identity, ts: Date.now() });

    return identity;
  } catch (err) {
    console.error('Failed to resolve identity:', err);
    return {
      address: addr,
      primaryAddress: addr,
      handle: null,
      tdh: 0,
      rep: 0,
      level: 0,
      pfp: null,
      cic: 0,
      isDelegate: false,
      consolidationWallets: [],
      error: err.message
    };
  }
}

// Get TDH for an address (uses resolveIdentity)
export async function getTDH(address) {
  const identity = await resolveIdentity(address);
  return identity.tdh;
}

// Verify a wave exists on 6529
export async function verifyWave(waveId) {
  try {
    const res = await fetch(`${CONFIG.API_6529}/drops?wave_id=${waveId}&limit=1`);
    const data = await res.json();
    if (data.length > 0) {
      return {
        exists: true,
        name: data[0].wave.name,
        id: data[0].wave.id
      };
    }
    return { exists: false };
  } catch {
    return { exists: false };
  }
}

// Format TDH for display
export function formatTDH(tdh) {
  if (tdh >= 1_000_000) return (tdh / 1_000_000).toFixed(1) + 'M';
  if (tdh >= 1_000) return (tdh / 1_000).toFixed(0) + 'K';
  return tdh.toString();
}

// Format address for display
export function shortAddress(address) {
  if (!address) return '';
  return address.substring(0, 6) + '...' + address.substring(address.length - 4);
}
