// MEMES 24H Governance - Vote Submission
// Votes submitted via Cloudflare Worker proxy (token server-side)

import { CONFIG } from './config.js';
import { getAddress, signVote } from './wallet.js';
import { resolveIdentity, formatTDH } from './api6529.js';

// Submit a vote on a proposal with TDH allocation
export async function submitVote(proposalId, vote, allocatedTDH) {
  if (vote !== 'yes' && vote !== 'no') {
    throw new Error('Vote must be "yes" or "no"');
  }

  const address = getAddress();
  if (!address) throw new Error('Wallet not connected');

  const identity = await resolveIdentity(address);
  if (identity.tdh === 0) {
    throw new Error('You need TDH to vote. Collect The Memes NFTs to earn TDH.');
  }

  if (!allocatedTDH || allocatedTDH <= 0) {
    throw new Error('You must allocate some TDH to your vote.');
  }
  if (allocatedTDH > identity.tdh) {
    throw new Error(`Cannot allocate more TDH than you have (${formatTDH(identity.tdh)}).`);
  }

  const { signature, timestamp } = await signVote(proposalId, vote);

  const voteData = {
    proposalId,
    vote,
    voter: identity.primaryAddress,
    voterHandle: identity.handle,
    voterTDH: identity.tdh,
    allocatedTDH,
    timestamp,
    submittedBy: address
  };

  // Submit via Worker proxy
  const res = await fetch(`${CONFIG.WORKER_URL}/api/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voteData, signature })
  });

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || `Worker error: ${res.status}`);

  return { voteData, issue: result.issue };
}
