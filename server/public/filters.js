// Filter and rendering functions



// 全局变量存储issues缓存
let __allIssuesCache = [];
let __filtersLoaded = false;
let __currentRepo = '';
let __filtersDelegated = false;
let __selectionDelegated = false;
let __currentPage = 1;
let __pageSize = 20;
let __totalCount = 0;

// getContrastColor is now shared in utils.js

async function loadFiltersOnce(owner) {
  try {
    const repos = await fetch(`/api/owner/${owner}/repos`).then(r => r.json()).catch(() => []);

    // repository checkboxes
    const repoGroup = $('#repo-group');
    if (repoGroup) {
      repoGroup.innerHTML = repos.map(r => {
        const id = `repo_${r.id}`;
        return `<label for="${id}" class="filter-option">
          <input type="checkbox" name="repo_filter" id="${id}" value="${r.name}" checked/> ${r.name}
        </label>`;
      }).join('');
    }

    // state radios
    const stateGroup = $('#state-group');
    if (stateGroup) {
      stateGroup.innerHTML = ['all', 'open', 'closed'].map((s, i) => {
        const id = `state_${s}`;
        const checked = s === 'open' ? 'checked' : '';
        return `<label for="${id}" class="filter-option"><input type="radio" name="state" id="${id}" value="${s}" ${checked}/> ${s.toUpperCase()}</label>`;
      }).join('');
    }

    // assignee radios
    const assigneeGroup = $('#assignee-group');
    if (assigneeGroup) {
      assigneeGroup.innerHTML = `<label for="assignee_all" class="filter-option"><input type="radio" name="assignee" id="assignee_all" value="" checked/> All</label>`;
    }
  } catch (e) {
    console.error('Failed to load filters:', e);
  }
}

async function render(keepPage = false) {
  if (!keepPage) __currentPage = 1;
  toggleLoading(true, 'Updating issues...');
  try {
    const owner = $('#owner').value.trim();
    if (!owner) {
      toggleLoading(false);
      return;
    }
    const msgEl = $('#msg'); if (msgEl) msgEl.textContent = '';

    // Only load filters if not already loaded for this owner
    if (!__filtersLoaded || window.__currentOwner !== owner) {
      await loadFiltersOnce(owner);
      __filtersLoaded = true;
      window.__currentOwner = owner;
    }

    // event delegation for auto-apply (survives DOM rebuilds)
    if (!window.__filtersDelegated) {
      const filtersEl = document.querySelector('.filters-section');
      if (filtersEl) {
        filtersEl.addEventListener('change', (e) => {
          const t = e.target;
          if (t && (t.matches?.('input[type=radio]') || t.matches?.('input[type=checkbox]'))) {
            render();
          }
        });
      }
      window.__filtersDelegated = true;
    }

    // Get filter values
    const state = (document.querySelector('input[name=state]:checked')?.value) || 'open';
    const selectedRepos = Array.from(document.querySelectorAll('#repo-group input[type=checkbox]:checked')).map(cb => cb.value);

    // Fetch matching issues from server (owner-wide aggregation)
    console.log(`[Render] Fetching all issues for owner: ${owner}...`);
    let issuesRes = await fetch(`/api/owner/${owner}/issues?${new URLSearchParams({ state, limit: '500' })}`).then(async r => {
      if (!r.ok) { const t = await r.text(); throw new Error(t || 'HTTP ' + r.status); }
      return r.json();
    }).catch((e) => {
      console.error('[Render] Fetch failed:', e);
      const msgEl = $('#msg'); if (msgEl) msgEl.textContent = 'Failed to load issues'; return { data: [] };
    });

    console.log('[Render] API Response:', issuesRes);

    // Normalize response
    let allIssues = [];
    if (Array.isArray(issuesRes)) {
      allIssues = issuesRes;
    } else if (issuesRes.data && Array.isArray(issuesRes.data)) {
      allIssues = issuesRes.data;
    } else if (issuesRes.data && issuesRes.data.data && Array.isArray(issuesRes.data.data)) {
      allIssues = issuesRes.data.data;
    }

    console.log(`[Render] Parsed ${allIssues.length} issues`);

    // Dynamic Filter Aggregation (Assignees, Labels, Milestones) from all available issues
    updateDynamicFilters(allIssues);

    // Get filter values (milestone, project and assignee are managed by updateDynamicFilters to preserve selection)
    const selectedAssignee = (document.querySelector('input[name=assignee]:checked')?.value) || '';
    const selectedMilestone = (document.querySelector('input[name=milestone]:checked')?.value) || '';
    const selectedProject = (document.querySelector('input[name=project]:checked')?.value) || '';
    const selectedLabels = Array.from(document.querySelectorAll('#labels-group input[type=checkbox]:checked')).map(cb => cb.value);

    // Filter by selection
    const ownerLower = owner.toLowerCase();
    let filteredIssues = allIssues.filter(issue => {
      // Basic owner check
      const issueOwner = (issue.repository?.owner?.login || '').toLowerCase();
      if (issueOwner && issueOwner !== ownerLower) return false;

      // Repo filter
      if (selectedRepos.length > 0) {
        const issueRepo = (issue.repository?.name || '');
        if (!selectedRepos.includes(issueRepo)) return false;
      }

      // State filter
      if (state !== 'all' && issue.state !== state) return false;

      // Assignee filter
      if (selectedAssignee) {
        const hasAssignee = issue.assignees?.some(a => a.login === selectedAssignee);
        if (!hasAssignee) return false;
      }

      // Milestone filter
      if (selectedMilestone) {
        const issueMilestone = issue.milestone?.title || '';
        if (issueMilestone !== selectedMilestone) return false;
      }

      // Project filter
      if (selectedProject) {
        const issueProject = issue.project?.title || '';
        if (issueProject !== selectedProject) return false;
      }

      // Labels filter
      if (selectedLabels.length > 0) {
        const issueLabels = (issue.labels || []).map(l => l.name);

        // Handle "No Label" logic
        if (selectedLabels.includes('[No Label]') && issueLabels.length === 0) {
          // Keep it
        } else {
          // Check if any selected label is present
          const found = selectedLabels.some(sl => issueLabels.includes(sl));
          if (!found) return false;
        }
      }

      return true;
    });

    console.log(`[Render] Filtered down to ${filteredIssues.length} issues for owner ${owner}`);

    __totalCount = filteredIssues.length;
    const totalPages = Math.ceil(__totalCount / __pageSize);
    if (__currentPage > totalPages && totalPages > 0) __currentPage = totalPages;
    // Fetch repo-wide time map for list display
    let hoursMap = window.__repoTimeMap || {};
    if (!window.__repoTimeMap || window.__currentOwner !== owner) {
      try {
        // Fetching map for ALL repos might be slow, but let's try a user-wide map if it exists
        hoursMap = await fetch(`/api/user/times/map`).then(r => r.json()).catch(() => ({}));
        window.__repoTimeMap = hoursMap;
      } catch (e) {
        console.warn('Failed to fetch time map:', e);
      }
    }

    // Update stat cards based on filtered issues (owner-wide)
    const openCount = filteredIssues.length;
    updateStatsCards({
      total: openCount,
      open: openCount,
      closed: 0,
      totalHours: filteredIssues.reduce((acc, issue) => acc + (hoursMap[issue.number] || 0) / 3600, 0)
    });

    // Paginate filtered issues
    const startIdx = (__currentPage - 1) * __pageSize;
    const paginatedIssues = filteredIssues.slice(startIdx, startIdx + __pageSize);

    // Load time data for only the paginated issues
    const timeData = window.__issueTimeData || {};
    paginatedIssues.forEach(issue => {
      timeData[issue.number] = { total: (hoursMap[issue.number] || 0) / 3600, sessions: '?' };
    });
    window.__issueTimeData = timeData;

    // Render list
    const issuesHtml = paginatedIssues.map(i => {
      try {
        // Use repo from issue object
        const issueOwner = i.repository?.owner?.login || owner;
        const issueRepo = i.repository?.name || '';
        return renderIssue(i, true, issueOwner, issueRepo);
      } catch (err) {
        return `<div class="error-card">Error rendering issue #${i.number}</div>`;
      }
    }).join('');
    $('#issues').innerHTML = issuesHtml || '<div class="no-issues">No issues found matching filters</div>';

    // Render Pagination
    renderPagination(totalPages);

    // Setup expansion
    setupIssueExpansion();

    // Re-initialize Lucide icons for any new elements
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }

    // Selection logic (re-sync)
    if (!window.__selectionDelegated) {
      setupSelectionListeners();
      window.__selectionDelegated = true;
    }
    updateSelectionUI();

    // Stats cards are now updated asynchronously by refreshGlobalStats()
    toggleLoading(false);
  } catch (error) {
    console.error('Error in render function:', error);
    const msgEl = $('#msg');
    if (msgEl) msgEl.textContent = 'Failed to load data: ' + error.message;
    toggleLoading(false);
  }
}

// Dynamically update filters based on fetched issues
function updateDynamicFilters(issues) {
  // Aggregate unique assignees, milestones, projects, and labels
  const assignees = new Set();
  const milestones = new Set();
  const projects = new Set();
  const labels = new Map(); // name -> {color, count}

  issues.forEach(issue => {
    (issue.assignees || []).forEach(a => assignees.add(a.login));
    if (issue.milestone) milestones.add(issue.milestone.title);
    if (issue.project) projects.add(issue.project.title);

    (issue.labels || []).forEach(l => {
      const current = labels.get(l.name) || { color: l.color, count: 0 };
      current.count++;
      labels.set(l.name, current);
    });
  });

  // Update DOM preserving selections
  updateFilterUI('assignee', Array.from(assignees).sort());
  updateFilterUI('milestone', Array.from(milestones).sort());
  updateFilterUI('project', Array.from(projects).sort());
  updateLabelUI(Array.from(labels.entries()).sort((a, b) => a[0].localeCompare(b[0])));
}

function updateFilterUI(name, items) {
  const group = $(`#${name}-group`);
  if (!group) return;

  const currentSelection = (document.querySelector(`input[name=${name}]:checked`)?.value) || '';

  let html = `<label class="filter-option"><input type="radio" name="${name}" value="" ${currentSelection === '' ? 'checked' : ''}/> All</label>`;
  html += items.map(item => {
    const checked = item === currentSelection ? 'checked' : '';
    return `<label class="filter-option"><input type="radio" name="${name}" value="${item}" ${checked}/> ${item}</label>`;
  }).join('');

  group.innerHTML = html;
}

function updateLabelUI(labelEntries) {
  const group = $('#labels-group');
  if (!group) return;

  const selectedLabels = Array.from(document.querySelectorAll('#labels-group input[type=checkbox]:checked')).map(cb => cb.value);

  // No Label option
  let html = `<label class="filter-option" style="display:flex; align-items:center; gap:4px; padding:4px 8px; min-width:140px;">
    <input type="checkbox" id="lb_no_label" value="[No Label]" ${selectedLabels.includes('[No Label]') ? 'checked' : ''} />
    <span class="issue-label" style="background:#6c757d;color:white; flex:1; text-align:center; padding:2px 8px; border-radius:4px; font-size:11px;">[No Label]</span>
  </label>`;

  html += labelEntries.map(([name, info]) => {
    const col = info.color || '007bff';
    const hex = col.startsWith('#') ? col : `#${col}`;
    const textColor = getContrastColor(hex);
    const id = `lb_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const checked = selectedLabels.includes(name) ? 'checked' : '';

    return `<label for="${id}" class="filter-option" style="display:flex; align-items:center; gap:4px; padding:4px 8px; min-width:140px;">
      <input type="checkbox" id="${id}" value="${name}" ${checked} />
      <span class="issue-label" style="background:${hex};color:${textColor}; flex:1; text-align:center; padding:2px 8px; border-radius:4px; font-size:11px;">${name}</span>
    </label>`;
  }).join('');

  group.innerHTML = html;
}

function renderPagination(totalPages) {
  const container = $('#main-pagination');
  if (!container) return;

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let buttonsHtml = `
    <button class="pagination-btn" ${__currentPage <= 1 ? 'disabled' : ''} id="prev-page">
      <i data-lucide="chevron-left"></i>
    </button>
  `;

  // Page Numbers
  const maxVisible = 7;
  let startPage = Math.max(1, __currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage + 1 < maxVisible) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  if (startPage > 1) {
    buttonsHtml += `<button class="pagination-btn page-num" data-page="1">1</button>`;
    if (startPage > 2) buttonsHtml += `<span class="pagination-dots">...</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    buttonsHtml += `
      <button class="pagination-btn page-num ${i === __currentPage ? 'active' : ''}" data-page="${i}">
        ${i}
      </button>
    `;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) buttonsHtml += `<span class="pagination-dots">...</span>`;
    buttonsHtml += `<button class="pagination-btn page-num" data-page="${totalPages}">${totalPages}</button>`;
  }

  buttonsHtml += `
    <button class="pagination-btn" ${__currentPage >= totalPages ? 'disabled' : ''} id="next-page">
      <i data-lucide="chevron-right"></i>
    </button>
  `;

  container.innerHTML = buttonsHtml;

  if (typeof lucide !== 'undefined') lucide.createIcons();

  $('#prev-page').onclick = () => {
    if (__currentPage > 1) {
      __currentPage--;
      render(true);
    }
  };
  $('#next-page').onclick = () => {
    if (__currentPage < totalPages) {
      __currentPage++;
      render(true);
    }
  };

  container.querySelectorAll('.page-num').forEach(btn => {
    btn.onclick = () => {
      const p = parseInt(btn.getAttribute('data-page'));
      if (p !== __currentPage) {
        __currentPage = p;
        render(true);
      }
    };
  });
}

function setupSelectionListeners() {
  const issuesEl = $('#issues');
  if (!issuesEl) return;

  issuesEl.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.classList.contains('issue-select')) {
      const num = Number(t.getAttribute('data-num'));
      if (!window.__selectedIssues) window.__selectedIssues = new Set();
      if (t.checked) window.__selectedIssues.add(num); else window.__selectedIssues.delete(num);
      updateSelectionUI();
    }
  });

  const btnAll = $('#issues-select-all');
  if (btnAll) {
    btnAll.onclick = () => {
      if (!window.__selectedIssues) window.__selectedIssues = new Set();
      document.querySelectorAll('.issue-select:not([disabled])').forEach(cb => {
        cb.checked = true;
        window.__selectedIssues.add(Number(cb.getAttribute('data-num')));
      });
      updateSelectionUI();
    };
  }

  const btnNone = $('#issues-select-none');
  if (btnNone) {
    btnNone.onclick = () => {
      if (!window.__selectedIssues) window.__selectedIssues = new Set();
      window.__selectedIssues.clear();
      document.querySelectorAll('.issue-select').forEach(cb => cb.checked = false);
      updateSelectionUI();
    };
  }
}

// Update selection UI
function updateSelectionUI() {
  const selCountEl = document.getElementById('selected-count');
  const total = document.querySelectorAll('#issues .issue-select').length;
  const selected = window.__selectedIssues ? window.__selectedIssues.size : 0;
  if (selCountEl) selCountEl.textContent = `Selected: ${selected}`;
}
