// Filter and rendering functions

// Get contrast color for labels
function getContrastColor(hexColor) {
  // Remove # if present
  const color = hexColor.replace('#', '');

  // Convert to RGB
  const r = parseInt(color.substr(0, 2), 16);
  const g = parseInt(color.substr(2, 2), 16);
  const b = parseInt(color.substr(4, 2), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.5 ? '#000000' : '#ffffff';
}

async function render() {
  try {
    const owner = $('#owner').value.trim();
    const repo = $('#repo').value.trim();
    if (!owner || !repo) return;
    const msgEl = $('#msg'); if (msgEl) msgEl.textContent = '';

    // Only load filters if not already loaded for this repo
    if (!__filtersLoaded || __currentRepo !== `${owner}/${repo}`) {
      await loadFiltersOnce(owner, repo);
      __filtersLoaded = true;
      __currentRepo = `${owner}/${repo}`;
    }

    // event delegation for auto-apply (survives DOM rebuilds)
    if (!window.__filtersDelegated) {
      const filtersEl = document.querySelector('.filters');
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

    // Load both stats and time data
    const [stats, timeData] = await Promise.all([
      fetch(`/api/repos/${owner}/${repo}/stats`).then(r=>r.json()).catch((e)=>{ const msgEl = $('#msg'); if (msgEl) msgEl.textContent = 'Failed to load stats'; return {total:0,open:0,closed:0}; }),
      fetch(`/api/repos/${owner}/${repo}/timesheet`).then(r=>r.json()).catch(()=>({}))
    ]);
    window.__issueTimeData = timeData;

    // Removed: summary-issues content as requested
    // $('#summary-issues').innerHTML = `
    //   <span class="summary-badge total"><span>Total</span><span class="val">${stats.total ?? 0}</span></span>
    //   <span class="summary-badge open"><span>Open</span><span class="val">${stats.open ?? 0}</span></span>
    //   <span class="summary-badge closed"><span>Closed</span><span class="val">${stats.closed ?? 0}</span></span>
    //   <span class="summary-badge"><span>Total Time</span><span class="val">${toH(timeData.totalSeconds||0)}</span></span>
    //   ${timeItems ? '<span class="summary-time-details">' + timeItems + '</span>' : ''}
    `;

    // Get all issues first, then filter on frontend
    let allIssues = await fetch(`/api/repos/${owner}/${repo}/issues?${new URLSearchParams({ state: 'all', limit: '100' })}`).then(async r=>{
      if (!r.ok) { const t = await r.text(); throw new Error(t||'HTTP '+r.status); }
      return r.json();
    }).catch((e)=>{ const msgEl = $('#msg'); if (msgEl) msgEl.textContent = 'Failed to load issues'; return []; });

    // Cache all issues for Auto Assign tab reuse
    window.__allIssuesCache = Array.isArray(allIssues) ? allIssues : [];

    // If state=all returns empty, try open+closed and merge
    if (Array.isArray(allIssues) && allIssues.length === 0) {
      try {
        const [openList, closedList] = await Promise.all([
          fetch(`/api/repos/${owner}/${repo}/issues?${new URLSearchParams({ limit:'100', state:'open' })}`).then(r=>r.json()),
          fetch(`/api/repos/${owner}/${repo}/issues?${new URLSearchParams({ limit:'100', state:'closed' })}`).then(r=>r.json()),
        ]);
        if (Array.isArray(openList) || Array.isArray(closedList)) {
          allIssues = [ ...(Array.isArray(openList)?openList:[]), ...(Array.isArray(closedList)?closedList:[]) ];
        }
      } catch {}
    }

    // Get filter values
    const state = (document.querySelector('input[name=state]:checked')?.value) || 'all';
    const assignee = (document.querySelector('input[name=assignee]:checked')?.value) || '';
    const milestone = (document.querySelector('input[name=milestone]:checked')?.value) || '';
    const allLabels = Array.from(document.querySelectorAll('#labels-group input[type=checkbox]'));
    const labelsSel = allLabels.filter((c)=>c.checked).map((c)=>c.value);

    console.log('=== FILTER DEBUG ===');
    console.log('All issues count:', allIssues.length);
    console.log('State filter:', state);
    console.log('Assignee filter:', assignee);
    console.log('Milestone filter:', milestone);
    console.log('Labels filter:', labelsSel);

    // Apply frontend filtering
    let issues = allIssues.filter(issue => {
      // State filter
      if (state !== 'all' && issue.state !== state) {
        return false;
      }

      // Assignee filter
      if (assignee) {
        if (assignee === '[Unassigned]') {
          if (issue.assignees && issue.assignees.length > 0) return false;
        } else {
          const hasAssignee = issue.assignees?.some(a => a.login === assignee);
          if (!hasAssignee) return false;
        }
      }

      // Milestone filter
      if (milestone) {
        if (milestone === '[No Milestone]') {
          if (issue.milestone) return false;
        } else {
          if (!issue.milestone || issue.milestone.title !== milestone) return false;
        }
      }

      // Labels filter
      if (labelsSel.length > 0) {
        const issueLabels = (issue.labels || [])
          .map(l => l.name)
          .filter(name => name && name.trim() !== ''); // 过滤掉空白labels
        const hasNoLabel = issueLabels.length === 0;
        const hasMatchingLabel = labelsSel.some(selectedLabel => {
          if (selectedLabel === '[No Label]') {
            return hasNoLabel;
          }
          return issueLabels.includes(selectedLabel);
        });
        if (!hasMatchingLabel) {
          return false;
        }
      } else {
        // 如果没有任何label被选中，不显示任何issues
        return false;
      }

      return true;
    });

    console.log('Filtered issues count:', issues.length);

    const totalCountEl = $('#total-count');
    if (totalCountEl) totalCountEl.textContent = issues.length;
    // 绑定选择相关的事件（仅绑定一次）
    if (!window.__selectionDelegated) {
      const issuesEl = document.getElementById('issues');
      if (issuesEl) {
        issuesEl.addEventListener('change', (e) => {
          const t = e.target;
          if (t && t.classList && t.classList.contains('issue-select') && !t.disabled) {
            const num = Number(t.getAttribute('data-num'));
            if (!window.__selectedIssues) window.__selectedIssues = new Set();
            if (t.checked) window.__selectedIssues.add(num); else window.__selectedIssues.delete(num);
            updateSelectionUI();
          }
        });
      }
      const selAll = document.getElementById('issues-select-all');
      const selNone = document.getElementById('issues-select-none');
      if (selAll) selAll.addEventListener('click', () => {
        if (!window.__selectedIssues) window.__selectedIssues = new Set();
        // 选择所有当前可见的open issues（排除closed issues）
        issues.filter(it => it.state === 'open').forEach(it => window.__selectedIssues.add(it.number));
        // 勾选DOM中的enabled checkbox
        document.querySelectorAll('.issue-select:not([disabled])').forEach(cb => { cb.checked = true; });
        updateSelectionUI();
      });
      if (selNone) selNone.addEventListener('click', () => {
        if (!window.__selectedIssues) window.__selectedIssues = new Set();
        window.__selectedIssues.clear();
        document.querySelectorAll('.issue-select').forEach(cb => { cb.checked = false; });
        updateSelectionUI();
      });
      const selUnassigned = document.getElementById('issues-select-unassigned');
      if (selUnassigned) selUnassigned.addEventListener('click', () => {
        if (!window.__selectedIssues) window.__selectedIssues = new Set();
        // 选择所有open且未分配的issues
        document.querySelectorAll('.issue-select:not([disabled])').forEach(cb => {
          const issueNum = Number(cb.getAttribute('data-num'));
          const issueCard = cb.closest('.issue-card');
          const assigneeEl = issueCard?.querySelector('.assignee-unassigned');
          const isUnassigned = assigneeEl?.textContent?.trim() === 'Unassigned';
          if (isUnassigned) {
            cb.checked = true;
            window.__selectedIssues.add(issueNum);
          }
        });
        updateSelectionUI();
      });
      const autoAssign = document.getElementById('issues-auto-assign');
      if (autoAssign) autoAssign.addEventListener('click', async () => {
        const selectedIssues = window.__selectedIssues ? Array.from(window.__selectedIssues) : [];
        if (selectedIssues.length === 0) {
          alert('Please select some issues first.');
          return;
        }
        // Switch to Auto Assign tab
        switchTab('autoassign');
      });
      window.__selectionDelegated = true;
    }
    // 初始化已选集合
    if (!window.__selectedIssues) window.__selectedIssues = new Set();
    // 只保留当前可见 issues 的选择状态
    const visibleNums = new Set(issues.map(it => it.number));
    Array.from(window.__selectedIssues).forEach(n => { if (!visibleNums.has(n)) window.__selectedIssues.delete(n); });
    // 渲染列表
    $('#issues').innerHTML = issues.filter(Boolean).map(i => renderIssue(i, true, owner, repo)).join('');
    // 设置展开/收起按钮的事件监听器
    setupIssueExpansion();
    // 更新计数显示
    updateSelectionUI();
    // async load comments and time for each issue
    for (const it of issues) {
      (async () => {
        const d = await fetch(`/api/repos/${owner}/${repo}/issues/${it.number}`).then(r=>r.json()).catch(()=>null);
        if (d) {
          const comments = (d.comments||[]).map(c=>{
            const ctime = c.created_at ? new Date(c.created_at).toLocaleString() : '';
            return `<div class="comment" style="margin:4px 0;padding:4px;border-left:2px solid #ddd;"><small><b>${c.user?.login||'Unknown'}</b> ${ctime}</small><br/>${(c.body||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>')}</div>`;
          }).join('');
          const cEl = $(`#c_${it.number}`);
          if (cEl && comments) cEl.innerHTML = comments;

          const tEl = $(`#t_${it.number}`);
          if (tEl && timeData[it.number]) {
            const td = timeData[it.number];
            tEl.innerHTML = `<div style="margin-top:4px; color:#666; font-size:12px;">Time: ${td.total?.toFixed(1)||0}h ${td.sessions ? '('+td.sessions+' sessions)' : ''}</div>`;
          }
        }
      })();
    }

    // Update statistics cards after rendering
    updateStatsCards();
  } catch (error) {
    console.error('Error in render function:', error);
    const msgEl = $('#msg');
    if (msgEl) msgEl.textContent = 'Failed to load data: ' + error.message;
  }
}

// Update selection UI
function updateSelectionUI() {
  const selCountEl = document.getElementById('selected-count');
  const total = document.querySelectorAll('#issues .issue-select').length;
  const selected = window.__selectedIssues ? window.__selectedIssues.size : 0;
  if (selCountEl) selCountEl.textContent = `Selected: ${selected}`;
}
