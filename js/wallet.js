// MEMES 24H Governance - Wallet Connection
// Supports MetaMask, Rabby, and any EIP-1193 provider

import { CONFIG } from './config.js';

let connectedAddress = null;
let provider = null;

// Detect available wallets via EIP-6963 and fallback to window.ethereum
function getProvider() {
  if (provider) return provider;
  if (window.ethereum) {
    provider = window.ethereum;
    return provider;
  }
  return null;
}

// Connect wallet - returns checksummed address
export async function connectWallet() {
  const eth = getProvider();
  if (!eth) {
    throw new Error('No wallet detected. Install MetaMask or Rabby.');
  }

  const accounts = await eth.request({ method: 'eth_requestAccounts' });
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned from wallet.');
  }

  connectedAddress = accounts[0];

  // Listen for account changes
  eth.on('accountsChanged', (accs) => {
    connectedAddress = accs[0] || null;
    window.dispatchEvent(new CustomEvent('wallet-changed', { detail: { address: connectedAddress } }));
  });

  eth.on('chainChanged', () => {
    window.dispatchEvent(new CustomEvent('wallet-changed', { detail: { address: connectedAddress } }));
  });

  return connectedAddress;
}

// Disconnect (clear local state)
export function disconnectWallet() {
  connectedAddress = null;
  provider = null;
  window.dispatchEvent(new CustomEvent('wallet-changed', { detail: { address: null } }));
}

// Get current connected address
export function getAddress() {
  return connectedAddress;
}

// Check if connected
export function isConnected() {
  return connectedAddress !== null;
}

// Sign a proposal with EIP-712
export async function signProposal(action, waveId, waveName, reason) {
  if (!connectedAddress) throw new Error('Wallet not connected');
  const eth = getProvider();

  const timestamp = Math.floor(Date.now() / 1000);

  const msgParams = {
    domain: CONFIG.EIP712_DOMAIN,
    message: { action, waveId, waveName, reason, timestamp },
    primaryType: 'Proposal',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' }
      ],
      ...CONFIG.EIP712_TYPES
    }
  };

  const signature = await eth.request({
    method: 'eth_signTypedData_v4',
    params: [connectedAddress, JSON.stringify(msgParams)]
  });

  return { signature, timestamp, address: connectedAddress };
}

// Sign a vote with EIP-712
export async function signVote(proposalId, vote) {
  if (!connectedAddress) throw new Error('Wallet not connected');
  const eth = getProvider();

  const timestamp = Math.floor(Date.now() / 1000);

  const msgParams = {
    domain: CONFIG.EIP712_DOMAIN,
    message: { proposalId, vote, timestamp },
    primaryType: 'Vote',
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' }
      ],
      ...CONFIG.EIP712_TYPES
    }
  };

  const signature = await eth.request({
    method: 'eth_signTypedData_v4',
    params: [connectedAddress, JSON.stringify(msgParams)]
  });

  return { signature, timestamp, address: connectedAddress };
}
