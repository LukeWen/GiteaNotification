// Login functionality
function checkLoginStatus() {
  return localStorage.getItem('isLoggedIn') === 'true';
}

function showLoginPage() {
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('main-app').style.display = 'none';
}

function showMainApp() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('main-app').style.display = 'block';
}

function handleLogin(event) {
  event.preventDefault();
  toggleLoading(true, 'Signing in...');

  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('login-error');

  // Simple authentication: admin/admin
  if (username === 'admin' && password === 'admin') {
    localStorage.setItem('isLoggedIn', 'true');
    errorDiv.style.display = 'none';
    showMainApp();
    initializeMainApp();
  } else {
    toggleLoading(false);
    errorDiv.style.display = 'flex';
  }
}

function handleLogout() {
  localStorage.removeItem('isLoggedIn');
  showLoginPage();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.classList.toggle('collapsed');
  }
}

// Settings functionality
// Settings functionality
async function loadSettings() {
  toggleLoading(true, 'Loading settings...');
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();

    const defaultOwner = settings.notifications?.defaultOwner || localStorage.getItem('defaultOwner') || 'IDITech';
    const holidays = settings.holidays || (localStorage.getItem('ontarioHolidays') ? JSON.parse(localStorage.getItem('ontarioHolidays')) : getDefaultHolidays());

    // Set form values
    const ownerInput = document.getElementById('default-owner');
    if (ownerInput) ownerInput.value = defaultOwner;

    // Set main form values
    const mainOwnerInput = document.getElementById('owner');
    if (mainOwnerInput) mainOwnerInput.value = defaultOwner;

    // Load holidays
    window.__settingsHolidays = holidays;
    renderSettingsHolidays();

    // Set notification values
    if (settings.notifications) {
      if ($('#notif-enabled')) $('#notif-enabled').checked = settings.notifications.enabled;

      const [h, m] = (settings.notifications.checkTime || '09:00').split(':');
      if ($('#notif-hour')) $('#notif-hour').value = h || '09';
      if ($('#notif-min')) $('#notif-min').value = m || '00';

      if ($('#notif-intervals')) $('#notif-intervals').value = (settings.notifications.reminderDays || [5, 3, 1]).join(', ');
    }
    window.__sentReminders = settings.sentReminders || {};
    renderSentReminders();
  } catch (e) {
    console.error('Failed to load settings:', e);
  } finally {
    toggleLoading(false);
  }
}

async function saveSettings() {
  const owner = document.getElementById('default-owner').value.trim();
  const notifEnabled = $('#notif-enabled').checked;
  const notifHour = $('#notif-hour').value;
  const notifMin = $('#notif-min').value;
  const notifTime = `${notifHour}:${notifMin}`;
  const notifIntervals = $('#notif-intervals').value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));

  const settings = {
    notifications: {
      enabled: notifEnabled,
      checkTime: notifTime,
      reminderDays: notifIntervals,
      defaultOwner: owner
    },
    holidays: window.__settingsHolidays,
    sentReminders: window.__sentReminders || {} // Preserve existing if possible
  };

  toggleLoading(true, 'Saving settings...');
  try {
    // 1. Save to server
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });

    if (!res.ok) throw new Error('Failed to save to server');

    // 2. Local fallback/sync
    if (owner) localStorage.setItem('defaultOwner', owner);
    if (window.__settingsHolidays) {
      localStorage.setItem('ontarioHolidays', JSON.stringify(window.__settingsHolidays));
      if (typeof ontarioHolidays !== 'undefined') {
        ontarioHolidays = [...window.__settingsHolidays];
      }
    }

    // Update main form
    const mainOwnerInput = document.getElementById('owner');
    if (mainOwnerInput) mainOwnerInput.value = owner;

    alert('Settings saved successfully!');
  } catch (e) {
    console.error('Save failed:', e);
    alert('Failed to save settings: ' + e.message);
  } finally {
    toggleLoading(false);
  }
}

async function resetSettings() {
  if (!confirm('Are you sure you want to reset all settings to default?')) return;

  const defaultOwner = 'IDITech';
  const defaultHolidays = getDefaultHolidays();
  const defaultSettings = {
    notifications: { enabled: false, checkTime: '09:00', reminderDays: [5, 3, 1], defaultOwner: defaultOwner },
    holidays: defaultHolidays,
    sentReminders: {}
  };

  toggleLoading(true, 'Resetting settings...');
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaultSettings)
    });

    // Clear localStorage
    localStorage.removeItem('defaultOwner');
    localStorage.removeItem('ontarioHolidays');

    await loadSettings();
  } catch (e) {
    alert('Reset failed: ' + e.message);
  } finally {
    toggleLoading(false);
  }
}

function renderSentReminders() {
  const container = document.getElementById('sent-reminders-list');
  if (!container) return;

  const records = window.__sentReminders || {};
  const entries = Object.entries(records);

  if (entries.length === 0) {
    container.innerHTML = '<div style="font-style: italic; color: #999;">No reminders sent yet today.</div>';
    return;
  }

  container.innerHTML = entries.map(([issueId, reminders]) => {
    return reminders.map(r => {
      const key = typeof r === 'string' ? r : r.key;
      const days = key.replace('reminder_', '');
      const hasCommentId = typeof r === 'object' && r.commentId;

      return `
        <div style="padding: 4px 0; border-bottom: 1px solid #f5f5f5; display: flex; justify-content: space-between; align-items: center;">
          <span>Issue #${issueId} (${days}d)</span>
          <button class="btn btn-secondary btn-small" onclick="deleteReminder('${issueId}', '${key}')" 
                  style="padding: 1px 6px; font-size: 10px; border-color: #ffcfcf; color: ${hasCommentId ? '#dc2626' : '#999'};"
                  title="${hasCommentId ? 'Delete record and Gitea comment' : 'Delete local record only'}">
            Delete ${hasCommentId ? 'Comment' : 'Record'}
          </button>
        </div>
      `;
    }).join('');
  }).join('');
}

async function deleteReminder(issueId, key) {
  if (!confirm(`Are you sure you want to delete this reminder record?`)) return;

  toggleLoading(true, 'Deleting reminder...');
  try {
    const res = await fetch(`/api/settings/reminders/${issueId}/${key}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete reminder');

    // Refresh local state and UI
    await loadSettings();
    alert('Reminder deleted successfuly!');
  } catch (e) {
    alert('Delete failed: ' + e.message);
  } finally {
    toggleLoading(false);
  }
}
async function resetSentReminders() {
  if (!confirm('Are you sure you want to clear all sent reminder records? This will allow reminders to be re-sent if you trigger them again today.')) return;

  toggleLoading(true, 'Resetting records...');
  try {
    const res = await fetch('/api/settings/reset-reminders', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to reset records');

    window.__sentReminders = {};
    renderSentReminders();
    alert('Sent reminder records cleared successfully!');
  } catch (e) {
    alert('Clear failed: ' + e.message);
  } finally {
    toggleLoading(false);
  }
}

function renderSettingsHolidays() {
  const container = document.getElementById('settings-holiday-list');
  if (!container || !window.__settingsHolidays) return;

  container.innerHTML = window.__settingsHolidays.map((holiday, index) => `
    <div class="holiday-item">
      <span>${holiday.date} - ${holiday.name}</span>
      <button type="button" class="btn btn-remove" onclick="removeSettingsHoliday(${index})">Remove</button>
    </div>
  `).join('');
}

function addSettingsHoliday() {
  const dateInput = document.getElementById('settings-holiday-date');
  const nameInput = document.getElementById('settings-holiday-name');

  const date = dateInput.value;
  const name = nameInput.value.trim();

  if (!date || !name) return;

  if (!window.__settingsHolidays) window.__settingsHolidays = [];
  window.__settingsHolidays.push({ date, name });

  dateInput.value = '';
  nameInput.value = '';
  renderSettingsHolidays();
}

function removeSettingsHoliday(index) {
  if (window.__settingsHolidays) {
    window.__settingsHolidays.splice(index, 1);
    renderSettingsHolidays();
  }
}

function getDefaultHolidays() {
  return [
    // 2026
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-02-16', name: 'Family Day' },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-05-18', name: 'Victoria Day' },
    { date: '2026-07-01', name: 'Canada Day' },
    { date: '2026-08-03', name: 'Civic Holiday' },
    { date: '2026-09-07', name: 'Labour Day' },
    { date: '2026-10-12', name: 'Thanksgiving Day' },
    { date: '2026-12-25', name: 'Christmas Day' },
    { date: '2026-12-26', name: 'Boxing Day' },
    // 2027
    { date: '2027-01-01', name: "New Year's Day" },
    { date: '2027-02-15', name: 'Family Day' },
    { date: '2027-03-26', name: 'Good Friday' },
    { date: '2027-05-24', name: 'Victoria Day' },
    { date: '2027-07-01', name: 'Canada Day' },
    { date: '2027-08-02', name: 'Civic Holiday' },
    { date: '2027-09-06', name: 'Labour Day' },
    { date: '2027-10-11', name: 'Thanksgiving Day' },
    { date: '2027-12-25', name: 'Christmas Day' },
    { date: '2027-12-27', name: 'Boxing Day (Observed)' },
    // 2028
    { date: '2028-01-03', name: "New Year's Day (Observed)" },
    { date: '2028-02-21', name: 'Family Day' },
    { date: '2028-04-14', name: 'Good Friday' },
    { date: '2028-05-22', name: 'Victoria Day' },
    { date: '2028-07-03', name: 'Canada Day (Observed)' },
    { date: '2028-08-07', name: 'Civic Holiday' },
    { date: '2028-09-04', name: 'Labour Day' },
    { date: '2028-10-09', name: 'Thanksgiving Day' },
    { date: '2028-12-25', name: 'Christmas Day' },
    { date: '2028-12-26', name: 'Boxing Day' },
    // 2029
    { date: '2029-01-01', name: "New Year's Day" },
    { date: '2029-02-19', name: 'Family Day' },
    { date: '2029-03-30', name: 'Good Friday' },
    { date: '2029-05-21', name: 'Victoria Day' },
    { date: '2029-07-02', name: 'Canada Day (Observed)' },
    { date: '2029-08-06', name: 'Civic Holiday' },
    { date: '2029-09-03', name: 'Labour Day' },
    { date: '2029-10-08', name: 'Thanksgiving Day' },
    { date: '2029-12-25', name: 'Christmas Day' },
    { date: '2029-12-26', name: 'Boxing Day' },
    // 2030
    { date: '2030-01-01', name: "New Year's Day" },
    { date: '2030-02-18', name: 'Family Day' },
    { date: '2030-04-19', name: 'Good Friday' },
    { date: '2030-05-20', name: 'Victoria Day' },
    { date: '2030-07-01', name: 'Canada Day' },
    { date: '2030-08-05', name: 'Civic Holiday' },
    { date: '2030-09-02', name: 'Labour Day' },
    { date: '2030-10-14', name: 'Thanksgiving Day' },
    { date: '2030-12-25', name: 'Christmas Day' },
    { date: '2030-12-26', name: 'Boxing Day' }
  ];
}


// auto-load on first paint
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // Check login status
  if (checkLoginStatus()) {
    showMainApp();
    initializeMainApp();
  } else {
    showLoginPage();
  }

  // Setup login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
});

async function initializeMainApp() {
  toggleLoading(true, 'Initializing application...');
  try {
    await initGiteaConfig();
    await loadSettings();
    loadOntarioHolidays();
    initSidebarNavigation();

    // ... (rest of the code remains same, adding toggleLoading(false) at the end of this block)

    // wire auto assign navigation buttons
    const btnToAuto = document.getElementById('issues-auto-assign');
    if (btnToAuto) btnToAuto.onclick = () => switchTab('autoassign');
    const btnBack = document.getElementById('autoassign-back');
    if (btnBack) btnBack.onclick = () => switchTab('issues');

    // wire train buttons
    const btnStartAssigneeTraining = document.getElementById('start-assignee-training');
    if (btnStartAssigneeTraining) btnStartAssigneeTraining.onclick = () => startAssigneeTraining();

    const btnStartDurationTraining = document.getElementById('start-duration-training');
    if (btnStartDurationTraining) btnStartDurationTraining.onclick = () => startDurationTraining();

    $('#load').onclick = () => render();

    // Setup logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }

    // Setup sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', toggleSidebar);
    }

    // Setup sidebar collapse button
    const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
    if (sidebarCollapseBtn) {
      sidebarCollapseBtn.addEventListener('click', toggleSidebar);
    }

    // Setup settings tab
    const settingsSave = document.getElementById('settings-save');
    const settingsReset = document.getElementById('settings-reset');
    const settingsAddHoliday = document.getElementById('settings-add-holiday');

    if (settingsSave) {
      settingsSave.addEventListener('click', saveSettings);
    }

    if (settingsReset) {
      settingsReset.addEventListener('click', resetSettings);
    }

    if (settingsAddHoliday) {
      settingsAddHoliday.addEventListener('click', addSettingsHoliday);
    }

    const resetRemindersBtn = document.getElementById('btn-reset-reminders');
    if (resetRemindersBtn) {
      resetRemindersBtn.addEventListener('click', resetSentReminders);
    }

    switchTab('issues');

    // Perform initial data fetch and render
    try {
      await render(); // Already calls toggleLoading(true/false) internally
      await refreshGlobalStats(true); // Call silently as render already covers it
    } catch (e) {
      console.error('Error during initial render:', e);
    } finally {
      toggleLoading(false, 'Initialization complete');
    }
  } catch (e) {
    console.error('Initialization error:', e);
    toggleLoading(false);
  }
}

// Initialize sidebar navigation
function initSidebarNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = item.getAttribute('data-tab');
      if (tabName) {
        switchTab(tabName);
      }
    });
  });
}

// Animate number change with rolling effect
function animateNumber(element, targetValue, duration = 800) {
  if (!element) return;

  const startValue = parseFloat(element.textContent) || 0;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Easing function for smooth animation
    const easeOutCubic = 1 - Math.pow(1 - progress, 3);
    const currentValue = startValue + (targetValue - startValue) * easeOutCubic;

    // Handle hours display
    if (element.id === 'assigned-issues') {
      element.textContent = currentValue.toFixed(1) + 'h';
    } else {
      element.textContent = Math.round(currentValue);
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// Update statistics cards with repository-wide data
async function refreshGlobalStats(silent = false) {
  const owner = $('#owner')?.value?.trim();
  if (!owner) return;

  if (!silent) toggleLoading(true, 'Refreshing statistics...');
  try {
    const stats = await fetch(`/api/repos/${owner}/${repo}/stats`).then(r => r.json());

    // Update stat cards with animation
    const totalEl = document.getElementById('total-issues');
    const openEl = document.getElementById('open-issues');
    const closedEl = document.getElementById('closed-issues');
    const assignedEl = document.getElementById('assigned-issues');

    if (totalEl) animateNumber(totalEl, stats.total || 0);
    if (openEl) animateNumber(openEl, stats.open || 0);
    if (closedEl) animateNumber(closedEl, stats.closed || 0);
    if (assignedEl) animateNumber(assignedEl, stats.totalHours || 0);
  } catch (e) {
    console.warn('Failed to refresh global stats:', e);
  } finally {
    if (!silent) toggleLoading(false);
  }
}

// Fallback or for manual trigger
function updateStatsCards(stats = null) {
  if (!stats) return refreshGlobalStats();

  const totalEl = document.getElementById('total-issues');
  const openEl = document.getElementById('open-issues');
  const closedEl = document.getElementById('closed-issues');
  const assignedEl = document.getElementById('assigned-issues');

  if (totalEl) animateNumber(totalEl, stats.total || 0);
  if (openEl) animateNumber(openEl, stats.open || 0);
  if (closedEl) animateNumber(closedEl, stats.closed || 0);
  if (assignedEl) animateNumber(assignedEl, stats.totalHours || 0);
}
