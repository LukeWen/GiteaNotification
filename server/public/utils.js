console.log('[Utils] Initializing loading tracker...');
window.__loadingRequests = 0;

/**
 * Get contrast color (black or white) for a given hex color
 */
function getContrastColor(hexColor) {
  if (!hexColor) return '#000000';
  const color = hexColor.replace('#', '');
  const r = parseInt(color.substr(0, 2), 16);
  const g = parseInt(color.substr(2, 2), 16);
  const b = parseInt(color.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Shows or hides the loading overlay
 * @param {boolean} show - Whether to show or hide
 * @param {string} [message] - Optional message to show
 */
function toggleLoading(show, message = 'Loading...') {
  const overlay = document.getElementById('loading-overlay');
  const msgEl = document.getElementById('loading-message');
  if (!overlay) return;

  if (show) {
    window.__loadingRequests++;
    if (msgEl) msgEl.textContent = message;
    overlay.classList.add('active');
    console.log(`[Loading] Show: "${message}" (Active requests: ${window.__loadingRequests})`);
  } else {
    window.__loadingRequests = Math.max(0, window.__loadingRequests - 1);
    console.log(`[Loading] Hide (Active requests: ${window.__loadingRequests})`);
    if (window.__loadingRequests === 0) {
      overlay.classList.remove('active');
    }
  }
}

// Global renderIssue function
function renderIssue(i, showCheckbox = true, owner = null, repo = null, showExpand = true) {
  const stateClass = i.state === 'open' ? 'state-open' : 'state-closed';
  const disabled = i.state === 'closed' ? 'disabled' : '';
  const checked = window.__selectedIssues?.has?.(i.number) ? 'checked' : '';
  const checkboxHtml = showCheckbox ? `<input type="checkbox" class="issue-select" data-num="${i.number}" ${checked} ${disabled} />` : '';

  const issueUrl = (GITEA_BASE_URL && owner && repo) ? `${GITEA_BASE_URL}/${owner}/${repo}/issues/${i.number}` : null;
  const titleHtml = issueUrl ?
    `<a href="${issueUrl}" target="_blank" class="issue-title-link" style="flex: 1; min-width: 0;">${i.title} <span style="color:#999; font-size: 12px; font-weight: normal; margin-left: 6px;">#${i.number}</span></a>` :
    `<div class="issue-title" style="flex: 1; min-width: 0;">${i.title} <span style="color:#999; font-size: 12px; font-weight: normal; margin-left: 6px;">#${i.number}</span></div>`;

  // Get total hours from timesheet data if available
  const totalHours = window.__issueTimeData?.[i.number]?.total || 0;

  // Prepare labels HTML - show all labels
  let labelsHtml = '';
  if (i.labels && i.labels.length > 0) {
    const validLabels = i.labels.filter(l => l.name && l.name.trim() !== '');
    labelsHtml = validLabels.map(l => {
      const col = l?.color || '007bff';
      const hex = String(col).startsWith('#') ? String(col) : `#${col}`;
      const textColor = getContrastColor(hex);
      return `<span class="issue-label" style="background:${hex}; color:${textColor}">${l.name}</span>`;
    }).join('');
  }

  // Milestone info
  const milestone = i.milestone?.title;

  // Author and dates
  const author = i.user?.login || '';
  const created = i.created_at ? new Date(i.created_at).toLocaleDateString() : '';
  const updated = i.updated_at ? new Date(i.updated_at).toLocaleDateString() : '';
  const dueDate = i.due_date ? new Date(i.due_date).toLocaleDateString() : '';
  const closedAt = i.closed_at ? new Date(i.closed_at).toLocaleDateString() : '';
  const body = (i.body || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
  const stateBadge = i.state === 'open' ? '<span class="badge badge-open">OPEN</span>' : '<span class="badge badge-closed">CLOSED</span>';

  // Urgent due date logic (color coded by days remaining)
  let dueDateUrgentStyle = '';
  if (i.state === 'open' && i.due_date) {
    const dueDate = new Date(i.due_date);
    const now = new Date();
    // Normalize to midnight for calendar day comparison
    const d1 = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    const d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((d1 - d2) / (1000 * 60 * 60 * 24));

    if (diff > 5) {
      dueDateUrgentStyle = 'color:#16a34a; font-weight:bold;'; // Green
    } else if (diff === 5) {
      dueDateUrgentStyle = 'color:#eab308; font-weight:bold;'; // Yellow
    } else if (diff === 4) {
      dueDateUrgentStyle = 'color:#f97316; font-weight:bold;'; // Yellow-Orange
    } else if (diff === 3) {
      dueDateUrgentStyle = 'color:#ea580c; font-weight:bold;'; // Orange
    } else if (diff === 2) {
      dueDateUrgentStyle = 'color:#f43f5e; font-weight:bold;'; // Orange-Red
    } else {
      dueDateUrgentStyle = 'color:#dc2626; font-weight:bold;'; // Red
    }
  }

  const metaHtml = `<div class="issue-meta" style="margin-top: 4px; color: #666; font-size: 12px;">
    Creator: ${author} · Created: ${created} · Updated: ${updated}${i.project ? ` · Project: ${i.project.title}` : ''}${dueDate ? ` · <span style="${dueDateUrgentStyle}">Due: ${dueDate}</span>` : ''}${closedAt ? ` · Closed: ${closedAt}` : ''}
  </div>`;

  return `<div class="issue-card ${stateClass}" data-issue-id="${i.number}" data-owner="${owner}" data-repo="${repo}">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; gap: 12px;">
      <div style="display:flex; align-items:center; gap:12px; flex: 1; min-width: 0;">
        ${showCheckbox ? `<div style="flex-shrink: 0; display: flex; align-items: center;">${checkboxHtml}</div>` : ''}
        ${titleHtml}
      </div>
      <div>
        ${stateBadge}
      </div>
    </div>
    
    ${metaHtml}

    <div style="display:flex; justify-content:space-between; align-items:center; margin: 6px 0;">
      <div class="issue-meta">
        Assignee: ${i.assignees && i.assignees.length > 0 ?
      i.assignees.map(a => {
        const avatarUrl = window.GITEA_BASE_URL ? `${window.GITEA_BASE_URL}/user/avatar/${a.login}/-1` : '';
        return `<a href="${GITEA_BASE_URL || ''}/${a.login}" target="_blank" class="assignee-btn">${avatarUrl ? `<img src="${avatarUrl}" alt="${a.login}" style="width:20px; height:20px; border-radius:50%; border:1px solid #ddd;" onerror="this.outerHTML='👤';" />` : ''}${a.login}</a>`;
      }).join('') :
      '<span class="assignee-unassigned">👤Unassigned</span>'
    }
      </div>
      <div style="display:flex; gap: 4px;">
        ${i.project ? `<span class="issue-label" style="background:#0284c7;color:white;"><i data-lucide="layout-grid" style="width:12px;height:12px;vertical-align:middle;margin-right:2px;"></i>${i.project.title}</span>` : ''}
        ${milestone ? `<span class="issue-label" style="background:#6c757d;color:white;">${milestone}</span>` : ''}
      </div>
    </div>
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div style="display:flex; align-items:center; gap:8px;">
        ${labelsHtml ? `<div class="issue-labels">${labelsHtml}</div>` : ''}
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        ${showExpand ?
      (totalHours > 0 ? `<span class="total-hours">${totalHours.toFixed(1)}h</span>` : '') :
      (i.due_date ? `<span class="due-date" style="color:#dc3545; font-weight:500;">Due: ${new Date(i.due_date).toLocaleDateString()}</span>` : '')
    }
        ${showExpand ? `<button class="btn btn-small expand-btn" data-issue="${i.number}" style="padding:2px 6px; font-size:11px;">Expand</button>` : ''}
      </div>
    </div>
    <div class="issue-expanded-content" style="display:none; margin-top:8px; padding-top:8px; border-top:1px solid #e0e0e0;">
      ${body ? `<div class="issue-body">${body}</div>` : ''}
      <div class="issue-comments" id="c_${i.number}"></div>
      <div class="issue-time" id="t_${i.number}"></div>
    </div>
  </div>`;
}

function setupIssueExpansion() {
  // Remove existing event listeners to avoid duplicates
  document.querySelectorAll('.expand-btn').forEach(btn => {
    btn.removeEventListener('click', handleExpandClick);
  });

  // Add event listeners for expand/collapse buttons
  const buttons = document.querySelectorAll('.expand-btn');
  console.log(`Setting up ${buttons.length} expand buttons`);
  buttons.forEach((btn, index) => {
    btn.addEventListener('click', handleExpandClick);
    // Add visual feedback for debugging
    btn.style.cursor = 'pointer';
  });
}

function handleExpandClick(e) {
  e.preventDefault();
  e.stopPropagation();

  const btn = e.target;
  const issueId = btn.getAttribute('data-issue');
  const issueCard = btn.closest('.issue-card');
  const expandedContent = issueCard.querySelector('.issue-expanded-content');

  if (btn.classList.contains('expanded')) {
    // Collapse
    expandedContent.style.display = 'none';
    btn.textContent = 'Expand';
    btn.classList.remove('expanded');
  } else {
    // Expand
    expandedContent.style.display = 'block';
    btn.textContent = 'Collapse';
    btn.classList.add('expanded');

    // Get owner and repo from the issue card or global context
    // In owner-centric view, we should have owner/repo info per issue
    const owner = issueCard.getAttribute('data-owner');
    const repo = issueCard.getAttribute('data-repo');

    // Load comments and time data if not already loaded
    loadIssueDetails(issueId, 1, owner, repo);
  }
}

async function loadIssueDetails(issueId, page = 1, owner = null, repo = null) {
  const commentsEl = document.getElementById(`c_${issueId}`);
  const timeEl = document.getElementById(`t_${issueId}`);
  if (!commentsEl || !timeEl) return;

  const currentOwner = owner || window.__currentOwner;
  const currentRepo = repo || window.__currentRepo;

  const limit = 10;

  try {
    // Show loading state if first page
    if (page === 1 && !commentsEl.hasChildNodes()) {
      commentsEl.innerHTML = '<div style="padding:10px; color:#666;">Loading timeline...</div>';
    }

    const res = await fetch(`/api/repos/${currentOwner}/${currentRepo}/issues/${issueId}?page=${page}&limit=${limit}`);
    if (!res.ok) throw new Error('Failed to fetch issue details');

    const data = await res.json();
    const events = (data.comments || []).filter(event => {
      const action = event.event || event.type;
      // Hide noisy events as requested by user
      return !['assignees', 'label', 'add_time_manual', 'close', 'closed'].includes(action);
    });
    const total = data.totalComments || 0;

    if (events.length > 0) {
      const eventsHtml = events.map(event => {
        const author = event.user?.login || event.actor?.login || 'Unknown';
        const created = event.created_at ? new Date(event.created_at).toLocaleDateString() : '';
        const avatarUrl = window.GITEA_BASE_URL ? `${window.GITEA_BASE_URL}/user/avatar/${author}/-1` : '';

        let content = '';
        let icon = 'message-square';
        let color = '#333';

        if (event.type === 'comment') {
          content = (event.body || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
        } else if (event.type === 'tracked_time_added') {
          icon = 'clock';
          content = `added <strong>${(event.tracked_time?.time / 3600).toFixed(2)}h</strong> of tracked time.`;
          color = '#16a34a';
        } else if (event.event === 'closed') {
          icon = 'circle-off';
          content = 'closed this issue.';
          color = '#dc2626';
        } else if (event.event === 'reopened') {
          icon = 'rotate-ccw';
          content = 'reopened this issue.';
          color = '#16a34a';
        } else {
          content = `performed action: <strong>${event.event || event.type}</strong>`;
          color = '#6b7280';
        }

        return `
          <div class="timeline-event" style="margin:8px 0; padding:8px; border-left:3px solid #e0e0e0; background:#f9f9f9;">
            <div style="color:#666; font-size:13px; display:flex; align-items:center; gap:6px; margin-bottom:4px;">
              <img src="${avatarUrl}" alt="${author}" style="width:20px; height:20px; border-radius:50%; border:1px solid #ddd;" onerror="this.outerHTML='👤';" />
              <span style="font-weight:bold; color:#000;">${author}</span> 
              <span style="color:${color}">${content}</span>
              <span style="margin-left:auto; font-size:11px;">${created}</span>
            </div>
          </div>
        `;
      }).join('');

      let paginationHtml = '';
      if (total > limit) {
        const totalPages = Math.ceil(total / limit);
        let pageButtons = '';

        const maxVisible = 5;
        let startPage = Math.max(1, page - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        if (endPage - startPage + 1 < maxVisible) {
          startPage = Math.max(1, endPage - maxVisible + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
          pageButtons += `
            <button class="details-pagination-btn ${i === page ? 'active' : ''}" 
                    style="${i === page ? 'background:var(--primary);color:white;' : ''}"
                    onclick="loadIssueDetails(${issueId}, ${i})">${i}</button>
          `;
        }

        paginationHtml = `
          <div class="details-pagination">
            <button class="details-pagination-btn" ${page <= 1 ? 'disabled' : ''} onclick="loadIssueDetails(${issueId}, ${page - 1})">&laquo;</button>
            ${pageButtons}
            <button class="details-pagination-btn" ${page >= totalPages ? 'disabled' : ''} onclick="loadIssueDetails(${issueId}, ${page + 1})">&raquo;</button>
          </div>
        `;
      }

      commentsEl.innerHTML = `<div style="font-weight:600; font-size:13px; margin-bottom:8px; color:#4b5563; border-top: 1px solid #eee; padding-top: 12px; margin-top: 12px;">Timeline Events</div>` + eventsHtml + paginationHtml;
    } else {
      commentsEl.innerHTML = ''; // Hide entirely if no relevant events
    }

    // Load detailed time session data (already optimized to only fetch once or on expand)
    if (page === 1) {
      loadTimeSessions(issueId, timeEl);
    }
  } catch (error) {
    console.error(`Error loading details for issue ${issueId}:`, error);
    commentsEl.innerHTML = '<div style="color:red; font-size:12px;">Error loading timeline</div>';
  }
}

async function loadTimeSessions(issueId, timeEl) {
  try {
    const res = await fetch(`/api/repos/${window.__currentRepo}/issues/${issueId}/times`);
    if (!res.ok) return;

    const timesData = await res.json();
    if (timesData && timesData.entries && timesData.entries.length > 0) {
      const sessionsHtml = timesData.entries.map(entry => {
        const user = entry.user_name || `User ${entry.user_id}`;
        const timeHours = (entry.time / 3600).toFixed(2);
        const created = entry.created ? new Date(entry.created).toLocaleDateString() : 'Unknown';
        const avatarUrl = window.GITEA_BASE_URL ? `${window.GITEA_BASE_URL}/user/avatar/${user}/-1` : '';

        return `
          <div style="margin:4px 0; padding:6px 10px; background:#f0f9ff; border-radius:6px; font-size:12px; border-left:4px solid #0369a1; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <img src="${avatarUrl}" alt="${user}" style="width:20px; height:20px; border-radius:50%; border:1px solid #ddd;" onerror="this.outerHTML='👤';" />
              <span style="font-weight:600;">${user}</span>
              <span style="color:#059669; font-weight:700;">+${timeHours}h</span>
            </div>
            <span style="color:#6b7280; font-style:italic; font-size:10px;">${created}</span>
          </div>
        `;
      }).join('');

      timeEl.innerHTML = `
        <div style="margin-top:12px; padding:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
          <div style="font-weight:600; font-size:13px; margin-bottom:8px; color:#4b5563;">Time Sessions (${timesData.entries.length})</div>
          ${sessionsHtml}
        </div>
      `;
    }
  } catch (e) {
    console.warn('Failed to load sessions:', e);
  }
}
