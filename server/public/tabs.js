// Tab switching functionality
function switchTab(tabName) {
  // Update sidebar navigation
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  const activeNavItem = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (activeNavItem) activeNavItem.classList.add('active');


  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  const activeTab = document.getElementById(`${tabName}-tab`);
  if (activeTab) activeTab.classList.add('active');

  // Load timesheet data if switching to timesheet tab
  if (tabName === 'timesheet' && typeof loadTimesheet === 'function') {
    loadTimesheet();
  }
  // Load settings if switching to settings tab
  if (tabName === 'settings') {
    loadSettings();
  }

  // Update stats cards when switching to issues tab
  if (tabName === 'issues') {
    updateStatsCards();
  }
}
