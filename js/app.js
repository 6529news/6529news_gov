// MEMES 24H Governance - Main Application Controller
// Hash-based routing SPA

import { CONFIG, GITHUB_RAW } from './config.js';
import { connectWallet, disconnectWallet, getAddress, isConnected } from './wallet.js';
import { resolveIdentity, formatTDH, shortAddress, verifyWave } from './api6529.js';
import { listProposals, getProposal, getProposalVotes, tallyVotes, createProposal, hasVoted } from './proposals.js';
import { submitVote } from './voting.js';

// State
let userIdentity = null;
let currentView = 'dashboard';

// DOM
const app = document.getElementById('app');
const userArea = document.getElementById('userArea');

// === ROUTING ===
function route() {
  const hash = window.location.hash || '#/';
  if (hash === '#/' || hash === '#') renderDashboard();
  else if (hash.startsWith('#/proposal/')) renderProposalDetail(hash.split('#/proposal/')[1]);
  else if (hash === '#/create') renderCreateProposal();
  else if (hash === '#/create-request') renderCreateRequest();
  else if (hash === '#/requests') renderRequests();
  else if (hash.startsWith('#/request/')) renderRequestDetail(hash.split('#/request/')[1]);
  else if (hash === '#/config') renderConfig();
  else if (hash === '#/profile') renderProfile();
  else if (hash.startsWith('#/profile/')) renderProfile(hash.split('#/profile/')[1]);
  else renderDashboard();
}

window.addEventListener('hashchange', route);

// === WALLET CONNECTION ===
window.connectWalletBtn = async function() {
  try {
    const address = await connectWallet();
    userIdentity = await resolveIdentity(address);
    renderUserArea();
    route(); // refresh current view
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.disconnectWalletBtn = function() {
  disconnectWallet();
  userIdentity = null;
  renderUserArea();
  route();
};

window.addEventListener('wallet-changed', async (e) => {
  if (e.detail.address) {
    userIdentity = await resolveIdentity(e.detail.address);
  } else {
    userIdentity = null;
  }
  renderUserArea();
  route();
});

// === USER AREA ===
function renderUserArea() {
  if (!userIdentity) {
    userArea.innerHTML = `
      <button class="btn btn-connect" onclick="connectWalletBtn()">Connect Wallet</button>
    `;
    return;
  }

  const delegateTag = userIdentity.isDelegate ? '<span class="tag-delegate">via delegate</span>' : '';
  const pfpSrc = userIdentity.pfp
    ? (userIdentity.pfp.startsWith('ipfs://') ? userIdentity.pfp.replace('ipfs://', 'https://ipfs.io/ipfs/') : userIdentity.pfp)
    : '';
  const pfpHtml = pfpSrc ? `<img src="${pfpSrc}" class="user-pfp" alt="">` : '<div class="user-pfp-placeholder"></div>';

  userArea.innerHTML = `
    <div class="user-info">
      <a href="#/profile" class="user-link">
        ${pfpHtml}
        <div class="user-details">
          <div class="user-handle">${userIdentity.handle || shortAddress(userIdentity.address)} ${delegateTag}</div>
          <div class="user-tdh">${formatTDH(userIdentity.tdh)} TDH &middot; Level ${userIdentity.level}</div>
        </div>
      </a>
      <button class="btn btn-sm btn-disconnect" onclick="disconnectWalletBtn()">Disconnect</button>
    </div>
  `;
}

// === DASHBOARD ===
async function renderDashboard() {
  currentView = 'dashboard';
  app.innerHTML = '<div class="loading">Loading proposals...</div>';

  const proposals = await listProposals();
  const configRes = await fetch(`${GITHUB_RAW}/${CONFIG.WAVES_CONFIG_PATH}?t=${Date.now()}`);
  const config = await configRes.json();

  const activeProposals = proposals.filter(p => p.status === 'active');
  const pastProposals = proposals.filter(p => p.status !== 'active');

  let html = `
    <div class="section-header">
      <h2>Active Proposals</h2>
      ${userIdentity && userIdentity.tdh >= CONFIG.MIN_TDH_PROPOSE
        ? '<a href="#/create" class="btn btn-primary">+ New Proposal</a>'
        : ''}
    </div>
  `;

  if (activeProposals.length === 0) {
    html += '<div class="empty-state">No active proposals. ';
    if (userIdentity && userIdentity.tdh >= CONFIG.MIN_TDH_PROPOSE) {
      html += '<a href="#/create">Create one</a>';
    } else {
      html += `Need ${formatTDH(CONFIG.MIN_TDH_PROPOSE)} TDH to propose.`;
    }
    html += '</div>';
  } else {
    html += '<div class="proposals-grid">';
    for (const p of activeProposals) {
      html += renderProposalCard(p);
    }
    html += '</div>';
  }

  // Current config
  html += `
    <div class="section-header" style="margin-top:32px">
      <h2>Current News Sources</h2>
      <a href="#/config" class="btn btn-sm">View Config</a>
    </div>
    <div class="config-grid">
      ${config.waves.map(w => `
        <div class="config-item">
          <span class="config-type">${w.type}</span>
          <span class="config-name">${w.name}</span>
        </div>
      `).join('')}
      ${config.collections.map(c => `
        <div class="config-item">
          <span class="config-type">market</span>
          <span class="config-name">${c.name}</span>
        </div>
      `).join('')}
    </div>
  `;

  // Past proposals
  if (pastProposals.length > 0) {
    html += `<div class="section-header" style="margin-top:32px"><h2>Past Proposals</h2></div>`;
    html += '<div class="proposals-grid">';
    for (const p of pastProposals) {
      html += renderProposalCard(p);
    }
    html += '</div>';
  }

  app.innerHTML = html;
}

function renderProposalCard(p) {
  const isExpired = new Date(p.expiresAt) < new Date();
  const statusClass = p.status === 'active' ? (isExpired ? 'status-expired' : 'status-active') : (p.status === 'passed' ? 'status-passed' : 'status-failed');
  const statusLabel = p.status === 'active' ? (isExpired ? 'EXPIRED' : 'ACTIVE') : p.status.toUpperCase();
  const daysLeft = Math.max(0, Math.ceil((new Date(p.expiresAt) - new Date()) / 86400000));
  const actionLabel = p.action === 'add' ? 'Add' : 'Remove';

  return `
    <a href="#/proposal/${p.id}" class="proposal-card">
      <div class="proposal-header">
        <span class="proposal-action action-${p.action}">${actionLabel}</span>
        <span class="proposal-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="proposal-wave">${p.waveName}</div>
      <div class="proposal-reason">${p.reason || ''}</div>
      <div class="proposal-meta">
        <span>by ${p.proposer.handle || shortAddress(p.proposer.address)}</span>
        <span>${p.status === 'active' && !isExpired ? daysLeft + 'd left' : ''}</span>
      </div>
    </a>
  `;
}

// === PROPOSAL DETAIL ===
async function renderProposalDetail(id) {
  currentView = 'proposal';
  app.innerHTML = '<div class="loading">Loading proposal...</div>';

  const proposal = await getProposal(id);
  if (!proposal) {
    app.innerHTML = '<div class="empty-state">Proposal not found. <a href="#/">Back</a></div>';
    return;
  }

  const votes = await getProposalVotes(id);
  const tally = await tallyVotes(votes);
  const isExpired = new Date(proposal.expiresAt) < new Date();
  const daysLeft = Math.max(0, Math.ceil((new Date(proposal.expiresAt) - new Date()) / 86400000));
  const voted = userIdentity ? await hasVoted(id) : false;

  const actionLabel = proposal.action === 'add' ? 'Add Wave' : 'Remove Wave';

  let voteSection = '';
  if (userIdentity && proposal.status === 'active' && !isExpired && !voted) {
    voteSection = `
      <div class="vote-panel">
        <h3>Cast Your Vote</h3>
        <div class="tdh-allocator">
          <div class="tdh-allocator-header">
            <label>TDH to allocate</label>
            <span class="tdh-allocator-max">Max: ${formatTDH(userIdentity.tdh)}</span>
          </div>
          <div class="tdh-slider-row">
            <input type="range" id="tdhSlider" min="1" max="${userIdentity.tdh}" value="${userIdentity.tdh}" class="tdh-slider">
            <input type="number" id="tdhInput" min="1" max="${userIdentity.tdh}" value="${userIdentity.tdh}" class="tdh-input">
          </div>
          <div class="tdh-presets">
            <button class="btn btn-sm tdh-preset" data-pct="25">25%</button>
            <button class="btn btn-sm tdh-preset" data-pct="50">50%</button>
            <button class="btn btn-sm tdh-preset" data-pct="75">75%</button>
            <button class="btn btn-sm tdh-preset" data-pct="100">100%</button>
          </div>
        </div>
        <div class="vote-actions">
          <button class="btn btn-yes" id="btnYes">Vote YES</button>
          <button class="btn btn-no" id="btnNo">Vote NO</button>
        </div>
        <div id="voteStatus" class="vote-status"></div>
      </div>
    `;
  } else if (voted) {
    voteSection = '<div class="voted-msg">You have already voted on this proposal.</div>';
  } else if (!userIdentity) {
    voteSection = '<div class="voted-msg">Connect your wallet to vote.</div>';
  }

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Dashboard</a>
    <div class="proposal-detail">
      <div class="proposal-detail-header">
        <span class="proposal-action action-${proposal.action}">${actionLabel}</span>
        <h2>${proposal.waveName}</h2>
      </div>

      <div class="proposal-info-grid">
        <div class="info-box">
          <div class="info-label">Proposer</div>
          <div class="info-value">${proposal.proposer.handle || shortAddress(proposal.proposer.address)}</div>
          <div class="info-sub">${formatTDH(proposal.proposer.tdh)} TDH</div>
        </div>
        <div class="info-box">
          <div class="info-label">Time Left</div>
          <div class="info-value">${isExpired ? 'Expired' : daysLeft + ' days'}</div>
          <div class="info-sub">${new Date(proposal.expiresAt).toLocaleDateString()}</div>
        </div>
        <div class="info-box">
          <div class="info-label">Status</div>
          <div class="info-value">${proposal.status.toUpperCase()}</div>
          <div class="info-sub">${tally.yesCount + tally.noCount} votes</div>
        </div>
      </div>

      <div class="reason-box">
        <div class="info-label">Reason</div>
        <p>${proposal.reason || 'No reason provided.'}</p>
      </div>

      <div class="tally-section">
        <div class="tally-header">
          <span>Progress: ${formatTDH(tally.yesTDH)} / ${formatTDH(CONFIG.TDH_THRESHOLD_PASS)} TDH</span>
          <span>${tally.progress.toFixed(1)}%</span>
        </div>
        <div class="tally-bar">
          <div class="tally-fill" style="width: ${tally.progress}%"></div>
        </div>
        <div class="tally-detail">
          <span class="tally-yes">YES: ${formatTDH(tally.yesTDH)} TDH (${tally.yesCount} votes)</span>
          <span class="tally-no">NO: ${formatTDH(tally.noTDH)} TDH (${tally.noCount} votes)</span>
        </div>
      </div>

      ${voteSection}

      ${tally.votes.length > 0 ? `
        <div class="votes-list">
          <h3>Votes</h3>
          ${tally.votes.map(v => `
            <div class="vote-item">
              <span class="vote-badge vote-${v.vote}">${v.vote.toUpperCase()}</span>
              <span class="vote-handle">${v.voterHandle || shortAddress(v.voter)}</span>
              <span class="vote-tdh">${formatTDH(v.effectiveTDH || v.currentTDH)} TDH${v.allocatedTDH ? ' (allocated)' : ''}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;

  // TDH slider/input sync
  const slider = document.getElementById('tdhSlider');
  const input = document.getElementById('tdhInput');
  if (slider && input) {
    slider.addEventListener('input', () => { input.value = slider.value; });
    input.addEventListener('input', () => { slider.value = input.value; });

    // Preset buttons
    document.querySelectorAll('.tdh-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const pct = parseInt(btn.dataset.pct);
        const val = Math.floor(userIdentity.tdh * pct / 100);
        slider.value = val;
        input.value = val;
      });
    });
  }

  // Vote handlers
  const btnYes = document.getElementById('btnYes');
  const btnNo = document.getElementById('btnNo');
  if (btnYes) btnYes.addEventListener('click', () => handleVote(id, 'yes'));
  if (btnNo) btnNo.addEventListener('click', () => handleVote(id, 'no'));
}

async function handleVote(proposalId, vote) {
  const statusEl = document.getElementById('voteStatus');
  const tdhInput = document.getElementById('tdhInput');
  const allocatedTDH = tdhInput ? parseInt(tdhInput.value) : userIdentity.tdh;

  // Disable buttons
  const btnYes = document.getElementById('btnYes');
  const btnNo = document.getElementById('btnNo');
  if (btnYes) btnYes.disabled = true;
  if (btnNo) btnNo.disabled = true;

  if (!ensureGitHubToken()) {
    if (btnYes) btnYes.disabled = false;
    if (btnNo) btnNo.disabled = false;
    return;
  }

  if (statusEl) statusEl.innerHTML = '<span class="status-pending">Signing with wallet...</span>';

  try {
    const result = await submitVote(proposalId, vote, allocatedTDH);

    if (result.issue?.fallback) {
      if (statusEl) statusEl.innerHTML = '<span class="status-info">Redirected to GitHub to complete submission.</span>';
    } else {
      if (statusEl) statusEl.innerHTML = `
        <span class="status-success">
          Vote submitted successfully! Allocating ${formatTDH(allocatedTDH)} TDH.
          <br>Processing by GitHub Actions...
          <a href="${result.issue?.html_url}" target="_blank">View Issue</a>
        </span>
      `;
    }

    showToast(`Vote ${vote.toUpperCase()} submitted with ${formatTDH(allocatedTDH)} TDH!`, 'success');
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span class="status-error">${err.message}</span>`;
    if (btnYes) btnYes.disabled = false;
    if (btnNo) btnNo.disabled = false;
    showToast(err.message, 'error');
  }
}

// === CREATE PROPOSAL ===
async function renderCreateProposal() {
  currentView = 'create';

  if (!userIdentity) {
    app.innerHTML = '<div class="empty-state">Connect your wallet to create a proposal. <a href="#/">Back</a></div>';
    return;
  }

  if (userIdentity.tdh < CONFIG.MIN_TDH_PROPOSE) {
    app.innerHTML = `<div class="empty-state">You need ${formatTDH(CONFIG.MIN_TDH_PROPOSE)} TDH to create a proposal. You have ${formatTDH(userIdentity.tdh)}. <a href="#/">Back</a></div>`;
    return;
  }

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Dashboard</a>
    <div class="create-form">
      <h2>Create Proposal</h2>
      <p class="form-sub">Propose adding or removing a wave from the MEMES 24H news sources.</p>

      <div class="form-group">
        <label>Action</label>
        <select id="propAction">
          <option value="add">Add Wave</option>
          <option value="remove">Remove Wave</option>
        </select>
      </div>

      <div class="form-group">
        <label>Wave ID (UUID from 6529.io URL)</label>
        <input type="text" id="propWaveId" placeholder="e.g. b38288e6-ca9d-45ce-8323-3dc5e094f04e">
        <div class="form-hint">Copy the wave UUID from the 6529.io URL</div>
        <div id="waveVerify" class="wave-verify"></div>
      </div>

      <div class="form-group">
        <label>Reason</label>
        <textarea id="propReason" rows="3" placeholder="Why should this wave be added/removed?"></textarea>
      </div>

      <div class="form-footer">
        <span class="form-cost">Your TDH: ${formatTDH(userIdentity.tdh)}</span>
        <button class="btn btn-primary" id="btnSubmitProposal">Sign & Submit Proposal</button>
      </div>
      <div id="proposalStatus" class="vote-status" style="margin-top:16px"></div>
    </div>
  `;

  // Verify wave on blur
  document.getElementById('propWaveId').addEventListener('blur', async (e) => {
    const waveId = e.target.value.trim();
    const verifyEl = document.getElementById('waveVerify');
    if (!waveId) { verifyEl.innerHTML = ''; return; }

    verifyEl.innerHTML = '<span class="verifying">Verifying...</span>';
    const wave = await verifyWave(waveId);
    if (wave.exists) {
      verifyEl.innerHTML = `<span class="verified">Found: ${wave.name}</span>`;
    } else {
      verifyEl.innerHTML = '<span class="not-found">Wave not found on 6529.io</span>';
    }
  });

  // Submit handler
  document.getElementById('btnSubmitProposal').addEventListener('click', async () => {
    const action = document.getElementById('propAction').value;
    const waveId = document.getElementById('propWaveId').value.trim();
    const reason = document.getElementById('propReason').value.trim();

    if (!waveId) { showToast('Enter a wave ID', 'error'); return; }
    if (!reason) { showToast('Enter a reason', 'error'); return; }

    if (!ensureGitHubToken()) return;

    const statusEl = document.getElementById('proposalStatus');
    const btn = document.getElementById('btnSubmitProposal');
    btn.disabled = true;
    btn.textContent = 'Signing...';
    if (statusEl) statusEl.innerHTML = '<span class="status-pending">Signing proposal with wallet...</span>';

    try {
      const result = await createProposal(action, waveId, reason);

      if (result.issue?.fallback) {
        if (statusEl) statusEl.innerHTML = '<span class="status-info">Redirected to GitHub to complete submission.</span>';
        btn.disabled = false;
        btn.textContent = 'Sign & Submit Proposal';
      } else {
        if (statusEl) statusEl.innerHTML = `
          <span class="status-success">
            Proposal submitted successfully!
            <a href="${result.issue?.html_url}" target="_blank">View on GitHub</a>
            <br>Redirecting to dashboard...
          </span>
        `;
        showToast('Proposal submitted!', 'success');
        setTimeout(() => { window.location.hash = '#/'; }, 2000);
      }
    } catch (err) {
      if (statusEl) statusEl.innerHTML = `<span class="status-error">${err.message}</span>`;
      btn.disabled = false;
      btn.textContent = 'Sign & Submit Proposal';
      showToast(err.message, 'error');
    }
  });
}

// === CONFIG VIEW ===
async function renderConfig() {
  app.innerHTML = '<div class="loading">Loading config...</div>';

  const res = await fetch(`${GITHUB_RAW}/${CONFIG.WAVES_CONFIG_PATH}?t=${Date.now()}`);
  const config = await res.json();

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Dashboard</a>
    <h2>Current News Configuration</h2>
    <p class="form-sub">This is what the MEMES 24H news card currently monitors. Create a proposal to change it.</p>

    <h3 style="margin-top:24px">Waves</h3>
    <div class="config-detail-grid">
      ${config.waves.map(w => `
        <div class="config-detail-item">
          <div class="config-detail-name">${w.name}</div>
          <div class="config-detail-meta">
            <span class="config-type">${w.type}</span>
            <span>Added by ${w.addedBy}</span>
            <span>${new Date(w.addedAt).toLocaleDateString()}</span>
          </div>
          <div class="config-detail-id">${w.id}</div>
        </div>
      `).join('')}
    </div>

    <h3 style="margin-top:24px">Collections (OpenSea)</h3>
    <div class="config-detail-grid">
      ${config.collections.map(c => `
        <div class="config-detail-item">
          <div class="config-detail-name">${c.name}</div>
          <div class="config-detail-meta">
            <span class="config-type">market</span>
            <span>Added by ${c.addedBy}</span>
          </div>
          <div class="config-detail-id">${c.slug}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// === PROFILE ===
async function renderProfile(addressParam) {
  currentView = 'profile';
  app.innerHTML = '<div class="loading">Loading profile...</div>';

  let identity;

  if (addressParam) {
    // Viewing someone else's profile
    identity = await resolveIdentity(addressParam);
  } else if (userIdentity) {
    // Viewing own profile
    identity = userIdentity;
  } else {
    app.innerHTML = '<div class="empty-state">Connect your wallet to view your profile. <a href="#/">Back</a></div>';
    return;
  }

  // Resolve pfp
  let pfpSrc = '';
  if (identity.pfp) {
    pfpSrc = identity.pfp.startsWith('ipfs://')
      ? identity.pfp.replace('ipfs://', 'https://ipfs.io/ipfs/')
      : identity.pfp;
  }

  // Find all proposals and votes by this user
  const proposals = await listProposals();
  const primaryAddr = identity.primaryAddress.toLowerCase();

  const userProposals = proposals.filter(p =>
    p.proposer.address.toLowerCase() === primaryAddr ||
    (p.proposer.handle && p.proposer.handle === identity.handle)
  );

  // Check votes across all active proposals
  let allocatedTDH = 0;
  let voteHistory = [];

  for (const p of proposals) {
    const votes = await getProposalVotes(p.id);
    for (const v of votes) {
      const voterAddr = (v.voter || '').toLowerCase();
      const submitterAddr = (v.submittedBy || '').toLowerCase();
      if (voterAddr === primaryAddr || submitterAddr === primaryAddr) {
        const currentTDH = identity.tdh;
        if (p.status === 'active') {
          allocatedTDH += currentTDH;
        }
        voteHistory.push({
          proposalId: p.id,
          waveName: p.waveName,
          vote: v.vote,
          status: p.status,
          tdhAtVote: v.voterTDH || v.currentTDH || 0
        });
      }
    }
  }

  const freeTDH = identity.tdh; // TDH is not locked, it's used as weight
  const canPropose = identity.tdh >= CONFIG.MIN_TDH_PROPOSE;

  // 6529 profile link
  const seizeLink = identity.handle
    ? `https://6529.io/${identity.handle}`
    : `https://6529.io/identity/${identity.primaryAddress}`;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Dashboard</a>

    <div class="profile-page">
      <!-- Profile Header -->
      <div class="profile-header">
        <div class="profile-pfp-container">
          ${pfpSrc
            ? `<img src="${pfpSrc}" class="profile-pfp" alt="${identity.handle || 'Profile'}">`
            : '<div class="profile-pfp-empty"></div>'
          }
        </div>
        <div class="profile-info">
          <h2 class="profile-name">${identity.handle || shortAddress(identity.primaryAddress)}</h2>
          ${identity.isDelegate ? '<span class="tag-delegate">Connected via delegate wallet</span>' : ''}
          <div class="profile-address">${identity.primaryAddress}</div>
          <a href="${seizeLink}" target="_blank" class="profile-6529-link">View on 6529.io &rarr;</a>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="profile-stats">
        <div class="profile-stat">
          <div class="profile-stat-value">${formatTDH(identity.tdh)}</div>
          <div class="profile-stat-label">Total TDH</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-value">${identity.level}</div>
          <div class="profile-stat-label">Level</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-value">${formatTDH(identity.rep)}</div>
          <div class="profile-stat-label">Rep</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-value">${formatTDH(identity.cic)}</div>
          <div class="profile-stat-label">CIC</div>
        </div>
      </div>

      <!-- Governance Stats -->
      <div class="profile-section">
        <h3>Governance Activity</h3>
        <div class="profile-stats">
          <div class="profile-stat">
            <div class="profile-stat-value">${voteHistory.length}</div>
            <div class="profile-stat-label">Votes Cast</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-value">${userProposals.length}</div>
            <div class="profile-stat-label">Proposals Created</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-value">${formatTDH(allocatedTDH)}</div>
            <div class="profile-stat-label">TDH on Active Votes</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-value">${canPropose ? 'Yes' : 'No'}</div>
            <div class="profile-stat-label">Can Propose (1M+)</div>
          </div>
        </div>
      </div>

      <!-- Consolidation -->
      ${identity.consolidationWallets.length > 1 ? `
        <div class="profile-section">
          <h3>Consolidated Wallets</h3>
          <div class="wallet-list">
            ${identity.consolidationWallets.map(w => `
              <div class="wallet-item">
                <span class="wallet-addr">${w}</span>
                ${w.toLowerCase() === identity.primaryAddress.toLowerCase() ? '<span class="tag-primary">Primary</span>' : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- User Proposals -->
      ${userProposals.length > 0 ? `
        <div class="profile-section">
          <h3>My Proposals</h3>
          <div class="proposals-grid">
            ${userProposals.map(p => renderProposalCard(p)).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Vote History -->
      ${voteHistory.length > 0 ? `
        <div class="profile-section">
          <h3>Vote History</h3>
          <div class="vote-history">
            ${voteHistory.map(v => `
              <div class="vote-history-item">
                <span class="vote-badge vote-${v.vote}">${v.vote.toUpperCase()}</span>
                <a href="#/proposal/${v.proposalId}" class="vote-history-wave">${v.waveName}</a>
                <span class="vote-history-tdh">${formatTDH(v.tdhAtVote)} TDH</span>
                <span class="proposal-status status-${v.status}">${v.status.toUpperCase()}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// === REQUESTS (generic text + TDH vote) ===
async function renderRequests() {
  currentView = 'requests';
  app.innerHTML = '<div class="loading">Loading requests...</div>';

  const proposals = await listProposals();
  const requests = proposals.filter(p => p.action === 'request');
  const active = requests.filter(p => p.status === 'active' && new Date(p.expiresAt) > new Date());
  const past = requests.filter(p => p.status !== 'active' || new Date(p.expiresAt) <= new Date());

  let html = `
    <div class="section-header">
      <h2>Community Requests</h2>
      ${userIdentity && userIdentity.tdh >= CONFIG.MIN_TDH_PROPOSE
        ? '<a href="#/create-request" class="btn btn-primary">+ New Request</a>'
        : ''}
    </div>
    <p class="form-sub">Submit any request — feature ideas, UI changes, anything. Requests reaching ${formatTDH(CONFIG.TDH_THRESHOLD_REQUEST)} TDH get reviewed for production. Below that they stay in queue.</p>
  `;

  if (active.length === 0) {
    html += '<div class="empty-state">No active requests. ';
    if (userIdentity && userIdentity.tdh >= CONFIG.MIN_TDH_PROPOSE) {
      html += '<a href="#/create-request">Submit one</a>';
    }
    html += '</div>';
  } else {
    html += '<div class="proposals-grid">';
    for (const r of active) {
      html += renderRequestCard(r);
    }
    html += '</div>';
  }

  if (past.length > 0) {
    html += '<div class="section-header" style="margin-top:32px"><h2>Past Requests</h2></div>';
    html += '<div class="proposals-grid">';
    for (const r of past) html += renderRequestCard(r);
    html += '</div>';
  }

  app.innerHTML = html;
}

function renderRequestCard(r) {
  const isExpired = new Date(r.expiresAt) < new Date();
  const daysLeft = Math.max(0, Math.ceil((new Date(r.expiresAt) - new Date()) / 86400000));
  const statusClass = r.status === 'active' ? (isExpired ? 'status-expired' : 'status-active') : (r.status === 'passed' ? 'status-passed' : 'status-failed');
  const statusLabel = r.status === 'active' ? (isExpired ? 'EXPIRED' : 'ACTIVE') : r.status.toUpperCase();

  return `
    <a href="#/request/${r.id}" class="proposal-card">
      <div class="proposal-header">
        <span class="proposal-action action-request">Request</span>
        <span class="proposal-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="proposal-wave">${r.waveName || r.reason?.substring(0, 60) || 'Request'}</div>
      <div class="proposal-reason">${r.reason || ''}</div>
      <div class="proposal-meta">
        <span>by ${r.proposer.handle || shortAddress(r.proposer.address)}</span>
        <span>${r.status === 'active' && !isExpired ? daysLeft + 'd left' : ''}</span>
      </div>
    </a>
  `;
}

async function renderRequestDetail(id) {
  // Reuse proposal detail — requests are stored as proposals with action='request'
  return renderProposalDetail(id);
}

async function renderCreateRequest() {
  currentView = 'create-request';

  if (!userIdentity) {
    app.innerHTML = '<div class="empty-state">Connect your wallet to submit a request. <a href="#/requests">Back</a></div>';
    return;
  }

  if (userIdentity.tdh < CONFIG.MIN_TDH_PROPOSE) {
    app.innerHTML = `<div class="empty-state">You need ${formatTDH(CONFIG.MIN_TDH_PROPOSE)} TDH to submit a request. You have ${formatTDH(userIdentity.tdh)}. <a href="#/requests">Back</a></div>`;
    return;
  }

  app.innerHTML = `
    <a href="#/requests" class="back-link">&larr; Back to Requests</a>
    <div class="create-form">
      <h2>Submit a Request</h2>
      <p class="form-sub">Any idea, feature, change — write it here. The community votes with TDH. Requests reaching ${formatTDH(CONFIG.TDH_THRESHOLD_REQUEST)} TDH get reviewed and implemented.</p>

      <div class="form-group">
        <label>Your Request</label>
        <textarea id="reqText" rows="4" placeholder="e.g. 'Let's change the background color!' or 'Add dark mode' or 'Show more market data'"></textarea>
      </div>

      <div class="form-footer">
        <span class="form-cost">Your TDH: ${formatTDH(userIdentity.tdh)} &middot; Threshold: ${formatTDH(CONFIG.TDH_THRESHOLD_REQUEST)}</span>
        <button class="btn btn-primary" id="btnSubmitRequest">Sign & Submit Request</button>
      </div>
      <div id="requestStatus" class="vote-status" style="margin-top:16px"></div>
    </div>
  `;

  document.getElementById('btnSubmitRequest').addEventListener('click', async () => {
    const text = document.getElementById('reqText').value.trim();
    if (!text) { showToast('Write your request', 'error'); return; }
    if (!ensureGitHubToken()) return;

    const btn = document.getElementById('btnSubmitRequest');
    const statusEl = document.getElementById('requestStatus');
    btn.disabled = true;
    btn.textContent = 'Signing...';
    if (statusEl) statusEl.innerHTML = '<span class="status-pending">Signing request with wallet...</span>';

    try {
      // Submit as a proposal with action='request', using the text as both waveName and reason
      const result = await createProposal('request', 'generic-request', text);

      if (result.issue?.fallback) {
        if (statusEl) statusEl.innerHTML = '<span class="status-info">Redirected to GitHub to complete submission.</span>';
        btn.disabled = false;
        btn.textContent = 'Sign & Submit Request';
      } else {
        if (statusEl) statusEl.innerHTML = `
          <span class="status-success">
            Request submitted! Community can now vote on it.
            <a href="${result.issue?.html_url}" target="_blank">View on GitHub</a>
          </span>
        `;
        showToast('Request submitted!', 'success');
        setTimeout(() => { window.location.hash = '#/requests'; }, 2000);
      }
    } catch (err) {
      if (statusEl) statusEl.innerHTML = `<span class="status-error">${err.message}</span>`;
      btn.disabled = false;
      btn.textContent = 'Sign & Submit Request';
      showToast(err.message, 'error');
    }
  });
}

// === TOAST ===
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// === GITHUB TOKEN SETUP ===
// Check URL param for token (one-time setup link)
const urlParams = new URLSearchParams(window.location.search);
const tokenParam = urlParams.get('token');
if (tokenParam) {
  localStorage.setItem('memes24h_gh_token', tokenParam);
  window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  showToast('GitHub token saved!', 'success');
}

// Prompt for token when needed (before first proposal/vote)
export function ensureGitHubToken() {
  if (CONFIG.GITHUB_TOKEN) return true;

  const token = prompt(
    'To submit proposals and votes on-site, enter a GitHub Personal Access Token.\n\n' +
    'Create one at: github.com/settings/personal-access-tokens/new\n' +
    'Permissions needed: Issues (Read & Write) on the memes24h repo.\n\n' +
    'This is saved locally in your browser only.'
  );

  if (token && token.trim()) {
    localStorage.setItem('memes24h_gh_token', token.trim());
    showToast('Token saved! You can now submit on-site.', 'success');
    return true;
  }
  return false;
}

// Make it available globally for the settings link
window.clearGHToken = function() {
  localStorage.removeItem('memes24h_gh_token');
  showToast('Token removed.', 'info');
};

// === ALERT BANNER ===
async function updateAlertBanner() {
  try {
    const proposals = await listProposals();
    const active = proposals.filter(p => p.status === 'active' && new Date(p.expiresAt) > new Date());
    const banner = document.getElementById('alertBanner');

    if (active.length > 0 && banner) {
      const nearest = active.reduce((a, b) =>
        new Date(a.expiresAt) < new Date(b.expiresAt) ? a : b
      );
      const daysLeft = Math.max(0, Math.ceil((new Date(nearest.expiresAt) - new Date()) / 86400000));

      banner.style.display = 'flex';
      banner.innerHTML = `
        <span class="alert-dot"></span>
        ${active.length} active proposal${active.length > 1 ? 's' : ''} need${active.length === 1 ? 's' : ''} your vote!
        Nearest deadline: ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left.
        <a href="#/">Vote now</a>
      `;
    }
  } catch (e) {}
}

// === INIT ===
renderUserArea();
route();
updateAlertBanner();
