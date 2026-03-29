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
  localStorage.setItem('gov_wallet', connectedAddress);

  // Listen for account changes
  eth.on('accountsChanged', (accs) => {
    connectedAddress = accs[0] || null;
    localStorage.setItem('gov_wallet', connectedAddress || '');
    window.dispatchEvent(new CustomEvent('wallet-changed', { detail: { address: connectedAddress } }));
  });

  eth.on('chainChanged', () => {
    window.dispatchEvent(new CustomEvent('wallet-changed', { detail: { address: connectedAddress } }));
  });

  return connectedAddress;
}

// Try to reconnect on page load (silent, no popup)
export async function tryReconnect() {
  const saved = localStorage.getItem('gov_wallet');
  if (!saved) return null;
  const eth = getProvider();
  if (!eth) return null;
  try {
    const accounts = await eth.request({ method: 'eth_accounts' });
    if (accounts && accounts.length > 0) {
      const match = accounts.find(a => a.toLowerCase() === saved.toLowerCase());
      if (match) {
        connectedAddress = match;
        eth.on('accountsChanged', (accs) => {
          connectedAddress = accs[0] || null;
          localStorage.setItem('gov_wallet', connectedAddress || '');
          window.dispatchEvent(new CustomEvent('wallet-changed', { detail: { address: connectedAddress } }));
        });
        eth.on('chainChanged', () => {
          window.dispatchEvent(new CustomEvent('wallet-changed', { detail: { address: connectedAddress } }));
        });
        return connectedAddress;
      }
    }
  } catch {}
  return null;
}

// Disconnect (clear local state)
export function disconnectWallet() {
  connectedAddress = null;
  provider = null;
  localStorage.removeItem('gov_wallet');
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

// Ensure wallet is on the correct chain for EIP-712 signing
async function ensureCorrectChain() {
  const eth = getProvider();
  const targetChainId = '0x' + CONFIG.EIP712_DOMAIN.chainId.toString(16);
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetChainId }] });
  } catch (e) {
    throw new Error('Please switch to Ethereum Mainnet in your wallet to sign.');
  }
}

// Sign a proposal with EIP-712
export async function signProposal(action, waveId, waveName, reason) {
  if (!connectedAddress) throw new Error('Wallet not connected');
  const eth = getProvider();
  await ensureCorrectChain();

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
  await ensureCorrectChain();

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
