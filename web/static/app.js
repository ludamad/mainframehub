// State
let terminal = null;
let fitAddon = null;
let ws = null;
let currentSessionId = null;
let currentSetupAbort = null;
let githubToken = localStorage.getItem('githubToken') || '';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initForms();
  initTokenForm();
  initSettingsForm();
  handleRoute();

  // Check for token before loading anything
  if (!githubToken) {
    showTokenModal();
  } else {
    loadSessions();
  }

  // Handle browser back/forward
  window.addEventListener('popstate', handleRoute);
});

// Routing & Deep Linking
function handleRoute() {
  const path = window.location.pathname;

  // Terminal opens in separate window now, so no /session/ routing
  if (path === '/my-prs') {
    showTab('my-prs');
  } else if (path === '/branches') {
    showTab('branches');
  } else if (path === '/new-pr') {
    showTab('new-pr');
  } else if (path === '/sessions' || path === '/') {
    showTab('sessions');
  } else {
    showTab('sessions');
  }
}

function navigate(path) {
  window.history.pushState({}, '', path);
  handleRoute();
}

// Tabs
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      showTab(tabName);
      navigate(`/${tabName === 'sessions' ? '' : tabName}`);
    });
  });
}

function showTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });

  // Load data if needed
  if (tabName === 'sessions') {
    loadSessions();
  } else if (tabName === 'my-prs') {
    loadPRs();
  } else if (tabName === 'branches') {
    loadBranches();
  }
}

// Forms
function initForms() {
  // New PR form
  document.getElementById('new-pr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleNewPR();
  });

  // Setup PR form
  document.getElementById('pr-setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleSetupPR();
  });
}

// Token Management
function initTokenForm() {
  document.getElementById('token-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveToken();
  });
}

function showTokenModal() {
  const modal = document.getElementById('token-modal');
  modal.classList.add('active');
  document.getElementById('github-token').focus();
}

function hideTokenModal() {
  const modal = document.getElementById('token-modal');
  modal.classList.remove('active');
}

function showSettings() {
  showSettingsModal();
}

async function showSettingsModal() {
  const modal = document.getElementById('settings-modal');
  modal.classList.add('active');

  // Load current settings
  try {
    const response = await fetchWithAuth('/api/settings');
    const settings = await response.json();

    document.getElementById('skip-permissions-setting').checked = settings.dangerouslySkipPermissions || false;
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Initialize settings form
function initSettingsForm() {
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSettings();
  });
}

async function saveSettings() {
  const tokenInput = document.getElementById('github-token-setting');
  const skipPermissions = document.getElementById('skip-permissions-setting').checked;
  const errorDiv = document.getElementById('settings-error');

  try {
    // Save CLI settings
    const settingsResponse = await fetchWithAuth('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dangerouslySkipPermissions: skipPermissions })
    });

    if (!settingsResponse.ok) {
      throw new Error('Failed to save settings');
    }

    // If token was provided, update it
    const token = tokenInput.value.trim();
    if (token) {
      const validateResponse = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      const data = await validateResponse.json();

      if (!data.valid || !data.hasWriteAccess) {
        errorDiv.textContent = 'Invalid token or insufficient permissions (requires repo write access)';
        errorDiv.style.display = 'block';
        return;
      }

      // Save token
      localStorage.setItem('githubToken', token);
      githubToken = token;
    }

    // Clear error and hide modal
    errorDiv.style.display = 'none';
    tokenInput.value = '';
    closeModal('settings-modal');

    showToast('Settings saved successfully', 'success');

    // Reload if token changed
    if (token) {
      window.location.reload();
    }
  } catch (error) {
    errorDiv.textContent = `Error: ${error.message}`;
    errorDiv.style.display = 'block';
  }
}

async function saveToken() {
  const tokenInput = document.getElementById('github-token');
  const errorDiv = document.getElementById('token-error');
  const token = tokenInput.value.trim();

  if (!token) {
    errorDiv.textContent = 'Token is required';
    errorDiv.style.display = 'block';
    return;
  }

  try {
    // Validate token with server
    const response = await fetch('/api/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });

    const data = await response.json();

    if (!data.valid || !data.hasWriteAccess) {
      errorDiv.textContent = 'Invalid token or insufficient permissions (requires repo write access)';
      errorDiv.style.display = 'block';
      return;
    }

    // Save token
    localStorage.setItem('githubToken', token);
    githubToken = token;

    // Clear error and hide modal
    errorDiv.style.display = 'none';
    tokenInput.value = '';
    hideTokenModal();

    // Load initial data
    showToast('Token saved successfully', 'success');
    loadSessions();
  } catch (error) {
    errorDiv.textContent = `Error: ${error.message}`;
    errorDiv.style.display = 'block';
  }
}

// Helper to fetch with auth header
async function fetchWithAuth(url, options = {}) {
  if (!githubToken) {
    showTokenModal();
    throw new Error('GitHub token required');
  }

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${githubToken}`
    }
  });
}

// Sessions
async function loadSessions() {
  try {
    showLoading('sessions');
    const response = await fetchWithAuth('/api/discover');
    const data = await response.json();

    renderSessions(data.sessions);
  } catch (error) {
    showToast(`Error loading sessions: ${error.message}`, 'error');
    hideLoading('sessions');
  }
}

function refreshSessions() {
  loadSessions();
}

// PRs
async function loadPRs() {
  try {
    showLoading('prs');
    const response = await fetchWithAuth('/api/prs');
    const data = await response.json();

    renderPRs(data.prs);
  } catch (error) {
    showToast(`Error loading PRs: ${error.message}`, 'error');
    hideLoading('prs');
  }
}

function refreshPRs() {
  loadPRs();
}

function renderPRs(prs) {
  const list = document.getElementById('prs-list');
  const loading = document.getElementById('prs-loading');
  const empty = document.getElementById('prs-empty');

  hideLoading('prs');

  if (prs.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'block';

  // Group PRs by status
  const withSessions = prs.filter(item => item.session);
  const withClones = prs.filter(item => !item.session && item.hasClone);
  const withoutClones = prs.filter(item => !item.hasClone);

  const renderPR = (item) => {
    const { pr, session, hasClone } = item;
    const hasSession = !!session;

    const statusClass = hasSession ? 'active' : hasClone ? 'has-clone' : 'no-clone';
    const statusText = hasSession ? 'ACTIVE' : hasClone ? 'HAS CLONE' : 'NO CLONE';

    return `
      <div class="pr-item">
        <div class="pr-header">
          <div class="pr-info">
            <div class="pr-title">${pr.title}</div>
            <div class="pr-meta">#${pr.number} • ${pr.branch} → ${pr.baseBranch}</div>
          </div>
          <div class="pr-status-badge ${statusClass}">${statusText}</div>
        </div>
        <div class="pr-actions">
          ${hasSession
            ? `<button class="btn btn-primary" onclick="openTerminalBySession('${session.id}')">OPEN TERMINAL</button>`
            : `<button class="btn btn-primary" onclick="setupPRFromCard(${pr.number})">SETUP + ATTACH</button>`
          }
          <a href="${pr.url}" target="_blank" class="btn btn-secondary">VIEW ON GITHUB</a>
        </div>
        <div class="pr-setup-status" id="setup-status-${pr.number}"></div>
      </div>
    `;
  };

  let html = '';

  if (withSessions.length > 0) {
    html += '<div class="pr-group">';
    html += '<div class="pr-group-title">WITH ACTIVE SESSIONS</div>';
    html += withSessions.map(renderPR).join('');
    html += '</div>';
  }

  if (withClones.length > 0) {
    html += '<div class="pr-group">';
    html += '<div class="pr-group-title">WITH CLONES (NO SESSION)</div>';
    html += withClones.map(renderPR).join('');
    html += '</div>';
  }

  if (withoutClones.length > 0) {
    html += '<div class="pr-group">';
    html += '<div class="pr-group-title">WITHOUT CLONES</div>';
    html += withoutClones.map(renderPR).join('');
    html += '</div>';
  }

  list.innerHTML = html;
}

async function setupPRFromCard(prNumber) {
  const statusEl = document.getElementById(`setup-status-${prNumber}`);

  if (!statusEl) {
    showToast('Setup status element not found', 'error');
    return;
  }

  statusEl.classList.add('visible');
  statusEl.innerHTML = `
    <div class="setup-message">
      Cloning repository and setting up PR #${prNumber}... this may take a minute
      <button class="btn btn-secondary" onclick="cancelSetup(${prNumber})">CANCEL</button>
    </div>
  `;

  currentSetupAbort = new AbortController();

  try {
    const response = await fetchWithAuth(`/api/setup/${prNumber}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: currentSetupAbort.signal
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Setup failed');
    }

    const result = await response.json();

    statusEl.innerHTML = `
      <div class="setup-message success">
        ✓ Setup complete! Opening terminal...
      </div>
    `;

    showToast(`Setup complete: ${result.pr.title}`, 'success');

    // Open terminal after a brief delay
    setTimeout(() => {
      window.open(`/terminal.html?session=${result.session.id}`, '_blank');
    }, 500);
  } catch (error) {
    if (error.name === 'AbortError') {
      statusEl.innerHTML = `
        <div class="setup-message">
          Setup cancelled
        </div>
      `;
      setTimeout(() => {
        statusEl.classList.remove('visible');
      }, 2000);
    } else {
      statusEl.innerHTML = `
        <div class="setup-message">
          Error: ${error.message}
        </div>
      `;
      showToast(`Setup failed: ${error.message}`, 'error');
    }
  } finally {
    currentSetupAbort = null;
  }
}

function cancelSetup(prNumber) {
  if (currentSetupAbort) {
    currentSetupAbort.abort();
    showToast('Cancelling setup...', 'info');
  }
}

// Branches
async function loadBranches() {
  try {
    showLoading('branches');
    const response = await fetchWithAuth('/api/branches');

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to load branches');
    }

    const data = await response.json();
    renderBranches(data.branches);
  } catch (error) {
    showToast(`Error loading branches: ${error.message}`, 'error');
    hideLoading('branches');
  }
}

function refreshBranches() {
  loadBranches();
}

function renderBranches(branches) {
  const list = document.getElementById('branches-list');
  const loading = document.getElementById('branches-loading');
  const empty = document.getElementById('branches-empty');

  hideLoading('branches');

  if (branches.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'block';

  list.innerHTML = branches.map(branch => `
    <div class="branch-item">
      <div class="branch-info">
        <div class="branch-name">${branch.name}</div>
        ${branch.protected ? '<span class="branch-badge">PROTECTED</span>' : ''}
      </div>
      <div class="branch-actions">
        <button class="btn btn-primary" onclick="createPRFromBranch('${branch.name}')">CREATE PR</button>
      </div>
    </div>
  `).join('');
}

async function createPRFromBranch(branchName) {
  const title = prompt(`Enter PR title for branch "${branchName}":`);
  if (!title) return;

  try {
    setStatus('BUSY');
    showToast(`Creating PR from ${branchName}...`, 'info');

    const response = await fetchWithAuth('/api/from-branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branchName,
        title,
        baseBranch: 'next' // TODO: Make configurable
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create PR');
    }

    const result = await response.json();
    showToast(`Created PR #${result.pr.number}`, 'success');

    // Open terminal
    setTimeout(() => {
      window.open(`/terminal.html?session=${result.session.id}`, '_blank');
    }, 500);
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  } finally {
    setStatus('READY');
  }
}

function renderSessions(sessions) {
  const list = document.getElementById('sessions-list');
  const loading = document.getElementById('sessions-loading');
  const empty = document.getElementById('sessions-empty');

  loading.style.display = 'none';

  if (sessions.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'flex';

  list.innerHTML = sessions.map(session => {
    // Use PR title as the main name, or session ID as fallback
    const displayName = session.pr ? session.pr.title : session.sessionId;
    const subtitle = session.pr
      ? `PR #${session.pr.number} • ${session.pr.branch} → ${session.pr.baseBranch}`
      : 'No PR associated';

    return `
      <div class="session-item ${session.isActive ? 'active' : ''}" onclick="openTerminalBySession('${session.sessionId}')">
        <div class="session-header">
          <span class="session-name">${displayName}</span>
          <span class="session-status-indicator ${session.isActive ? 'active' : ''}">
            ${session.isActive ? '●' : '○'}
          </span>
        </div>
        <div class="session-subtitle">${subtitle}</div>
        <div class="session-id-small">${session.sessionId}</div>
      </div>
    `;
  }).join('');
}

function showLoading(type) {
  const loading = document.getElementById(`${type}-loading`);
  if (loading) loading.style.display = 'block';
}

function hideLoading(type) {
  const loading = document.getElementById(`${type}-loading`);
  if (loading) loading.style.display = 'none';
}

// New PR
async function handleNewPR() {
  const prompt = document.getElementById('pr-prompt').value.trim();
  const baseBranch = document.getElementById('base-branch').value.trim();

  if (!prompt) {
    showToast('Please enter a prompt', 'error');
    return;
  }

  try {
    setStatus('BUSY');
    showToast('Creating new PR...', 'info');

    const response = await fetchWithAuth('/api/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, baseBranch })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create PR');
    }

    const result = await response.json();
    showToast(`Created PR #${result.pr.number}: ${result.pr.title}`, 'success');

    // Reset form
    document.getElementById('new-pr-form').reset();

    // Open terminal
    setTimeout(() => {
      window.open(`/terminal.html?session=${result.session.id}`, '_blank');
    }, 500);
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  } finally {
    setStatus('READY');
  }
}

// Setup PR
function openSetupModal() {
  const modal = document.getElementById('pr-setup-modal');
  modal.classList.add('active');
  document.getElementById('setup-pr-number').focus();
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

async function handleSetupPR() {
  const prNumber = parseInt(document.getElementById('setup-pr-number').value);

  if (!prNumber || prNumber <= 0) {
    showToast('Please enter a valid PR number', 'error');
    return;
  }

  try {
    setStatus('BUSY');
    closeModal('pr-setup-modal');
    showToast(`Setting up PR #${prNumber}...`, 'info');

    const response = await fetchWithAuth(`/api/setup/${prNumber}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Setup failed');
    }

    const result = await response.json();
    showToast(`Setup complete: ${result.pr.title}`, 'success');

    // Reset form
    document.getElementById('pr-setup-form').reset();

    // Open terminal
    setTimeout(() => {
      window.open(`/terminal.html?session=${result.session.id}`, '_blank');
    }, 500);
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  } finally {
    setStatus('READY');
  }
}

// Terminal
function openTerminalBySession(sessionId) {
  // Open terminal in new window/tab (token will be read from localStorage)
  window.open(`/terminal.html?session=${sessionId}`, '_blank');
}

function openTerminal(sessionId) {
  currentSessionId = sessionId;

  // Hide main, show terminal
  document.getElementById('main-content').style.display = 'none';
  document.getElementById('terminal-view').style.display = 'flex';

  // Update terminal info
  document.getElementById('terminal-session-id').textContent = sessionId;
  loadSessionInfo(sessionId);

  // Initialize xterm if needed
  if (!terminal) {
    terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Cascadia Code, Courier New, monospace',
      theme: {
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#ffffff',
        black: '#000000',
        brightBlack: '#cccccc',  // Light grey for dim text
        white: '#ffffff',
        brightWhite: '#ffffff'
      },
      scrollback: 10000
    });

    fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);

    const container = document.getElementById('xterm-container');
    terminal.open(container);
    fitAddon.fit();

    // Handle input
    terminal.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'input',
          data
        }));
      }
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (fitAddon && terminal) {
        fitAddon.fit();
        sendResize();
      }
    });
  }

  // Connect WebSocket
  connectWebSocket(sessionId);
}

async function loadSessionInfo(sessionId) {
  try {
    const response = await fetchWithAuth('/api/discover');
    const data = await response.json();
    const session = data.sessions.find(s => s.sessionId === sessionId);

    if (session && session.pr) {
      const prInfo = `PR #${session.pr.number}: ${session.pr.title}`;
      document.getElementById('terminal-pr-info').textContent = prInfo;
    }
  } catch (error) {
    console.error('Failed to load session info:', error);
  }
}

function connectWebSocket(sessionId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    ws.send(JSON.stringify({
      type: 'attach',
      sessionId
    }));
    setStatus('CONNECTED');
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleWSMessage(message);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    showToast('Terminal connection error', 'error');
  };

  ws.onclose = () => {
    console.log('WebSocket closed');
    ws = null;
    setStatus('DISCONNECTED');
  };
}

function handleWSMessage(message) {
  switch (message.type) {
    case 'output':
      if (terminal) {
        terminal.write(message.data);
      }
      break;

    case 'exit':
      showToast('Terminal session exited', 'info');
      setTimeout(() => closeTerminal(), 1000);
      break;

    case 'error':
      showToast(`Terminal error: ${message.message}`, 'error');
      break;
  }
}

function sendResize() {
  if (ws && ws.readyState === WebSocket.OPEN && fitAddon) {
    const dimensions = fitAddon.proposeDimensions();
    ws.send(JSON.stringify({
      type: 'resize',
      cols: dimensions.cols,
      rows: dimensions.rows
    }));
  }
}

function closeTerminal() {
  // Close WebSocket
  if (ws) {
    ws.close();
    ws = null;
  }

  // Dispose terminal
  if (terminal) {
    terminal.dispose();
    terminal = null;
    fitAddon = null;
  }

  currentSessionId = null;

  // Show main content
  document.getElementById('terminal-view').style.display = 'none';
  document.getElementById('main-content').style.display = 'flex';

  // Navigate back to sessions
  navigate('/');

  setStatus('READY');
}

// UI Helpers
function setStatus(status) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = status;
  statusEl.className = 'terminal-status' + (status === 'BUSY' || status === 'CONNECTED' ? ' busy' : '');
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = 'block';

  // Auto-hide after 5 seconds
  setTimeout(() => {
    toast.style.display = 'none';
  }, 5000);
}
