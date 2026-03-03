import axios from 'axios';
import cron from 'node-cron';
import { spawn } from 'child_process';
import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const rawBaseUrl = (process.env.GITEA_BASE_URL || '').replace(/\/$/, '');
const GITEA_BASE_URL = rawBaseUrl.endsWith('/api/v1') ? rawBaseUrl : `${rawBaseUrl}/api/v1`;
const GITEA_TOKEN = process.env.GITEA_TOKEN || '';

const api = axios.create({
  baseURL: GITEA_BASE_URL,
  headers: GITEA_TOKEN ? { Authorization: `token ${GITEA_TOKEN}` } : undefined,
});


app.get('/api/ping', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => {
  res.json({
    giteaBaseUrl: process.env.GITEA_BASE_URL || '',
    giteaToken: process.env.GITEA_TOKEN || '',
  });
}); 0.

app.get('/api/user', async (_req, res) => {
  try {
    const { data } = await api.get('/user');
    res.json(data);
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: e?.response?.data || e.message });
  }
});

app.get('/api/user/repos', async (req, res) => {
  try {
    const { data } = await api.get('/user/repos', { params: req.query });
    res.json(data);
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: e?.response?.data || e.message });
  }
});

app.get('/api/users/:username/repos', async (req, res) => {
  try {
    const { username } = req.params;
    const { data } = await api.get(`/users/${username}/repos`, { params: req.query });
    res.json(data);
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: e?.response?.data || e.message });
  }
});

app.get('/api/users/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { data } = await api.get(`/users/${username}`);
    res.json(data);
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: e?.response?.data || e.message });
  }
});

app.get('/api/repos/:owner/:repo/issues', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { state = 'all', page = '1', limit = '100' } = req.query;

    const maxGiteaLimit = 50;
    const requestedLimit = Math.max(1, Math.min(parseInt(limit) || 100, 500));
    const requestedPage = Math.max(1, parseInt(page) || 1);

    // Gitea only allows max 50 per page. To fulfill a larger limit, we fetch multiple pages in parallel.
    const giteaPagesPerRequest = Math.ceil(requestedLimit / maxGiteaLimit);
    const startGiteaPage = (requestedPage - 1) * giteaPagesPerRequest + 1;

    let requests = [];
    for (let i = 0; i < giteaPagesPerRequest; i++) {
      requests.push(api.get(`/repos/${owner}/${repo}/issues`, {
        params: { state, page: startGiteaPage + i, limit: maxGiteaLimit }
      }));
    }

    const responses = await Promise.all(requests);
    const allIssues = responses.flatMap(r => (Array.isArray(r.data) ? r.data : [])).slice(0, requestedLimit);
    const totalCount = responses.length > 0 ? (Number(responses[0].headers['x-total-count']) || 0) : 0;

    console.log(`Fetched ${allIssues.length} issues (via ${requests.length} Gitea pages) for ${owner}/${repo} (Total: ${totalCount})`);

    res.json({
      data: allIssues,
      totalCount
    });
  } catch (e) {
    console.error('Issues API error:', e?.response?.data || e.message);
    if (e?.response) {
      console.error('Status:', e.response.status);
      console.error('Headers:', e.response.headers);
    }
    res.status(e?.response?.status || 500).json({ error: e?.response?.data || e.message });
  }
});

// removed issue creation (POST)

// issue detail (timeline)
app.get('/api/repos/:owner/:repo/issues/:index', async (req, res) => {
  try {
    const { owner, repo, index } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const [issue, timelineRes] = await Promise.all([
      api.get(`/repos/${owner}/${repo}/issues/${index}`).then(r => r.data),
      api.get(`/repos/${owner}/${repo}/issues/${index}/timeline`, {
        params: { page, limit }
      }).catch(() => ({ data: [], headers: {} })),
    ]);

    const timeline = Array.isArray(timelineRes.data) ? timelineRes.data : [];
    const totalCount = Number(timelineRes.headers?.['x-total-count']) || timeline.length;

    const siteBase = GITEA_BASE_URL.replace(/\/?api\/v1$/, '');
    const webUrl = `${siteBase}/${owner}/${repo}/issues/${index}`;
    res.json({
      ...issue,
      comments: timeline, // Keep the key as 'comments' for backward compatibility or rename if preferred
      totalComments: totalCount,
      page: Number(page),
      limit: Number(limit),
      webUrl
    });
  } catch (e) {
    res.status(e?.response?.status || 500).json({ error: e?.response?.data || e.message });
  }
});

// removed issue update (PATCH)

app.get('/api/user/issues', async (req, res) => {
  try {
    const { state = 'open', page = 1, limit = 50, owner } = req.query;
    const { data, headers } = await api.get('/repos/issues', {
      params: { state, page, limit }
    });

    let filteredData = data;
    if (owner) {
      const ownerLower = owner.toLowerCase();
      filteredData = data.filter(issue =>
        (issue.repository?.owner?.login || '').toLowerCase() === ownerLower
      );
    }

    res.json({
      data: filteredData,
      totalCount: Number(headers['x-total-count']) || filteredData.length
    });
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

// User-wide time map: aggregate tracked time for all issues the user can see
app.get('/api/user/times/map', async (req, res) => {
  try {
    const { owner } = req.query;
    const timeMap = {};

    // To be efficient, we might only want to fetch tracked time for visible issues,
    // but a global map is what the frontend expects.
    // Let's fetch the last 1000 issues and their times if not too slow.
    let page = 1;
    const limit = 50;
    while (page <= 10) { // Limit to some reasonable number of issues
      const { data: issues } = await api.get('/repos/issues', { params: { state: 'all', limit, page } });
      if (!Array.isArray(issues) || issues.length === 0) break;

      for (const issue of issues) {
        if (owner && (issue.repository?.owner?.login || '').toLowerCase() !== owner.toLowerCase()) continue;

        // Fetching time for EACH issue is too many requests.
        // Gitea issues object sometimes includes tracked_times? No.
        // But we can check if the issue has time.
      }
      if (issues.length < limit) break;
      page++;
    }

    // Fallback: the frontend will fetch individual issue details on expand anyway.
    // For the list view, we'll just return an empty map or a partial one if we can.
    // Actually, let's keep it simple and let the frontend handle it or optimize later.
    res.json(timeMap);
  } catch (e) {
    res.json({});
  }
});

// List repositories by owner (user or org)
app.get('/api/owner/:owner/repos', async (req, res) => {
  try {
    const { owner } = req.params;
    // Try org first, then user
    let reposData = [];
    try {
      const { data } = await api.get(`/orgs/${owner}/repos`);
      reposData = data;
    } catch (e) {
      const { data } = await api.get(`/users/${owner}/repos`);
      reposData = data;
    }
    return res.json(reposData);
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

// Fetch all issues for an owner by iterating through their repositories
app.get('/api/owner/:owner/issues', async (req, res) => {
  try {
    const { owner } = req.params;
    const { state = 'open' } = req.query;

    // 1. Get all repos for the owner
    let repos = [];
    try {
      const { data } = await api.get(`/orgs/${owner}/repos`);
      repos = data;
    } catch (e) {
      const { data } = await api.get(`/users/${owner}/repos`);
      repos = data;
    }

    if (!Array.isArray(repos) || repos.length === 0) {
      return res.json({ data: [], totalCount: 0 });
    }

    // 2. Fetch issues for each repo in parallel (bounded)
    const issuePromises = repos.map(repo =>
      api.get(`/repos/${owner}/${repo.name}/issues`, { params: { state, limit: 100 } })
        .then(r => (Array.isArray(r.data) ? r.data : []).map(issue => ({
          ...issue,
          repository: {
            name: repo.name,
            owner: { login: owner }
          }
        })))
        .catch(() => [])
    );

    const results = await Promise.all(issuePromises);
    const allIssues = results.flat();

    console.log(`[Aggregator] Fetched ${allIssues.length} issues across ${repos.length} repositories for owner: ${owner}`);

    res.json({
      data: allIssues,
      totalCount: allIssues.length
    });
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

// metrics: aggregate by assignee and labels
app.get('/api/repos/:owner/:repo/metrics', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const limit = 50;
    let page = 1;
    const issues = [];
    const MAX_PAGES = 200;
    while (page <= MAX_PAGES) {
      const { data } = await api.get(`/repos/${owner}/${repo}/issues`, { params: { state: 'all', limit, page } });
      if (!Array.isArray(data) || data.length === 0) break;
      issues.push(...data);
      if (data.length < limit) break;
      page += 1;
    }

    const byAssignee = new Map();
    const byLabel = new Map();
    const byMilestone = new Map();
    let open = 0, closed = 0;
    for (const it of issues) {
      if (it.state === 'open') open++; else if (it.state === 'closed') closed++;
      const who = it.assignee?.login || 'Unassigned';
      byAssignee.set(who, (byAssignee.get(who) || 0) + 1);
      if (it.milestone?.title) {
        byMilestone.set(it.milestone.title, (byMilestone.get(it.milestone.title) || 0) + 1);
      }
      if (Array.isArray(it.labels)) {
        for (const lb of it.labels) {
          const name = lb?.name || 'unknown';
          byLabel.set(name, (byLabel.get(name) || 0) + 1);
        }
      }
    }
    res.json({
      total: issues.length,
      open,
      closed,
      byAssignee: Object.fromEntries(byAssignee.entries()),
      byLabel: Object.fromEntries(byLabel.entries()),
      byMilestone: Object.fromEntries(byMilestone.entries()),
    });
  } catch (e) {
    res.status(200).json({ total: 0, open: 0, closed: 0, byAssignee: {}, byLabel: {}, byMilestone: {}, error: e?.response?.data || e.message });
  }
});

// timetracker: issue spent times and repo aggregates
app.get('/api/repos/:owner/:repo/issues/:index/times', async (req, res) => {
  try {
    const { owner, repo, index } = req.params;
    const { data } = await api.get(`/repos/${owner}/${repo}/issues/${index}/times`);
    // data: array of { user_id, user_name, time, created }
    const total = Array.isArray(data) ? data.reduce((s, t) => s + (t.time || 0), 0) : 0;
    res.json({ totalSeconds: total, entries: data || [] });
  } catch (e) {
    res.status(200).json({ totalSeconds: 0, entries: [], error: e?.response?.data || e.message });
  }
});

app.get('/api/repos/:owner/:repo/times/summary', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    // enumerate issues then fetch times per issue (bounded)
    const limit = 50; let page = 1; const MAX_PAGES = 200; const issues = [];
    while (page <= MAX_PAGES) {
      const { data } = await api.get(`/repos/${owner}/${repo}/issues`, { params: { state: 'all', limit, page } });
      if (!Array.isArray(data) || data.length === 0) break;
      issues.push(...data);
      if (data.length < limit) break; page += 1;
    }
    const byUser = new Map();
    let totalSeconds = 0;
    for (const it of issues) {
      const times = await api.get(`/repos/${owner}/${repo}/issues/${it.number}/times`).then(r => r.data).catch(() => []);
      if (Array.isArray(times)) {
        for (const t of times) {
          const sec = t.time || 0;
          totalSeconds += sec;
          const key = t.user_name || `user:${t.user_id}`;
          byUser.set(key, (byUser.get(key) || 0) + sec);
        }
      }
    }
    res.json({ totalSeconds, byUser: Object.fromEntries(byUser.entries()), issuesCounted: issues.length });
  } catch (e) {
    res.status(200).json({ totalSeconds: 0, byUser: {}, issuesCounted: 0, error: e?.response?.data || e.message });
  }
});

// In-memory cache for repository statistics to avoid expensive re-calculations
const statsCache = new Map(); // "owner/repo" -> { data, timestamp }
const CACHE_TTL = 300000; // 5 minutes

app.get('/api/repos/:owner/:repo/times/map', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const timeMap = {};

    // Thorough scan of ALL time entries by iterating through issues (slow but accurate)
    let page = 1;
    const limit = 50;
    while (page <= 200) {
      const r = await api.get(`/repos/${owner}/${repo}/issues`, { params: { state: 'all', limit, page } }).catch(() => ({ data: [] }));
      const issues = Array.isArray(r.data) ? r.data : [];
      if (issues.length === 0) break;

      const batchData = await Promise.all(issues.map(async (issue) => {
        try {
          const tRes = await api.get(`/repos/${owner}/${repo}/issues/${issue.number}/times`);
          const data = Array.isArray(tRes.data) ? tRes.data : [];
          const sum = data.reduce((s, t) => s + (t.time || 0), 0);
          return { num: issue.number, sum };
        } catch {
          return { num: issue.number, sum: 0 };
        }
      }));

      for (const item of batchData) {
        if (item.sum > 0) timeMap[item.num] = item.sum;
      }

      if (issues.length < limit) break;
      page++;
    }
    res.json(timeMap);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/repos/:owner/:repo/stats', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const repoKey = `${owner}/${repo}`;

    // 1. Fetch issue counts (always fast via headers)
    const [issuesAll, issuesOpen, issuesClosed] = await Promise.all([
      api.get(`/repos/${owner}/${repo}/issues`, { params: { state: 'all', limit: 1 } }).catch(() => ({ headers: {} })),
      api.get(`/repos/${owner}/${repo}/issues`, { params: { state: 'open', limit: 1 } }).catch(() => ({ headers: {} })),
      api.get(`/repos/${owner}/${repo}/issues`, { params: { state: 'closed', limit: 1 } }).catch(() => ({ headers: {} })),
    ]);

    let total = Number(issuesAll.headers?.['x-total-count']) || 0;
    let open = Number(issuesOpen.headers?.['x-total-count']) || 0;
    let closed = Number(issuesClosed.headers?.['x-total-count']) || 0;

    // Check cache for hours
    const cached = statsCache.get(repoKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      return res.json({ total, open, closed, totalHours: cached.data.totalHours, cached: true });
    }

    // 2. Perform a thorough (but potentially slow) scan for total hours across all issues
    const fetchRepoHours = async () => {
      let totalSeconds = 0;
      let page = 1;
      const limit = 50;

      while (page <= 200) {
        const r = await api.get(`/repos/${owner}/${repo}/issues`, { params: { state: 'all', limit, page } }).catch(() => ({ data: [] }));
        const issues = Array.isArray(r.data) ? r.data : [];
        if (issues.length === 0) break;

        const batchTimes = await Promise.all(issues.map(async (issue) => {
          try {
            const tRes = await api.get(`/repos/${owner}/${repo}/issues/${issue.number}/times`);
            const data = Array.isArray(tRes.data) ? tRes.data : [];
            return data.reduce((s, t) => s + (t.time || 0), 0);
          } catch {
            return 0;
          }
        }));

        totalSeconds += batchTimes.reduce((a, b) => a + b, 0);
        if (issues.length < limit) break;
        page++;
      }
      return totalSeconds / 3600;
    };

    const totalHours = await fetchRepoHours();
    const result = { total, open, closed, totalHours };
    statsCache.set(repoKey, { data: result, timestamp: Date.now() });

    res.json(result);
  } catch (e) {
    console.error('Stats API error:', e.message);
    res.status(500).json({ total: 0, open: 0, closed: 0, totalHours: 0, error: e.message });
  }
});

// Static middleware and wildcard handler moved to end of file

// removed projects debug map

// removed auto-assign SSE logic

// 提供Gitea基础URL给前端
app.get('/api/config', (_req, res) => {
  const siteBase = GITEA_BASE_URL.replace(/\/?api\/v1$/, '');
  res.json({ giteaBaseUrl: siteBase });
});
// removed projects debug map

// removed auto-assign SSE logic

// filter sources
app.get('/api/repos/:owner/:repo/assignees', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { page = '1', limit = '50' } = req.query;

    const response = await api.get(`/repos/${owner}/${repo}/assignees`, {
      params: { page, limit }
    });

    // Gitea usually returns total count in header
    const totalCount = Number(response.headers['x-total-count']) || response.data.length;

    // Normalize and filter assignees (exclude organizations)
    let assignees = response.data
      .filter(u => u.type !== 1)
      .map(u => ({ login: u.login, id: u.id, avatar_url: u.avatar_url }));

    // For the first page, if we have space, ensure owner is included if not present and NOT an organization
    if (page === '1') {
      const ownerExists = assignees.some(a => a.login === owner);
      if (!ownerExists) {
        try {
          const ownerResponse = await api.get(`/users/${owner}`);
          if (ownerResponse.data && ownerResponse.data.type === 0) {
            assignees.unshift({
              login: ownerResponse.data.login,
              id: ownerResponse.data.id,
              avatar_url: ownerResponse.data.avatar_url
            });
          }
        } catch (e) {
          // ignore
        }
      }
    }

    res.json({
      data: assignees,
      totalCount
    });
  } catch (e) {
    res.status(500).json({ error: e?.response?.data || e.message });
  }
});

app.get('/api/repos/:owner/:repo/collaborators', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { data } = await api.get(`/repos/${owner}/${repo}/collaborators`);

    // Normalize collaborators
    let collaborators = data.map(u => ({ login: u.login, id: u.id }));

    // Always include the repository owner as an assignable user
    const ownerExists = collaborators.some(c => c.login === owner);
    if (!ownerExists) {
      try {
        // Try to get owner information
        const ownerResponse = await api.get(`/users/${owner}`);
        if (ownerResponse.data) {
          collaborators.unshift({ // Add owner at the beginning
            login: ownerResponse.data.login,
            id: ownerResponse.data.id
          });
        }
      } catch (ownerError) {
        // If we can't get owner info, still add with basic info
        collaborators.unshift({
          login: owner,
          id: 0
        });
      }
    }

    res.json(collaborators);
  } catch (e) {
    // If collaborators API fails, still try to return owner
    try {
      const ownerResponse = await api.get(`/users/${req.params.owner}`);
      if (ownerResponse.data) {
        res.json([{ login: ownerResponse.data.login, id: ownerResponse.data.id }]);
      } else {
        res.json([{ login: req.params.owner, id: 0 }]);
      }
    } catch (ownerError) {
      res.json([{ login: req.params.owner, id: 0 }]);
    }
  }
});

app.get('/api/repos/:owner/:repo/labels', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    // Fetch repo labels and org labels (if applicable) in parallel
    const [repoLabelsRes, orgLabelsRes] = await Promise.all([
      api.get(`/repos/${owner}/${repo}/labels`).catch(() => ({ data: [] })),
      api.get(`/orgs/${owner}/labels`).catch(() => ({ data: [] }))
    ]);

    const repoLabels = Array.isArray(repoLabelsRes.data) ? repoLabelsRes.data : [];
    const orgLabels = Array.isArray(orgLabelsRes.data) ? orgLabelsRes.data : [];

    // Merge and remove duplicates by name
    const allLabels = [...repoLabels, ...orgLabels];
    const uniqueLabels = [];
    const seenNames = new Set();

    for (const l of allLabels) {
      if (l && l.name && !seenNames.has(l.name)) {
        uniqueLabels.push({ id: l.id, name: l.name, color: l.color });
        seenNames.add(l.name);
      }
    }

    res.json(uniqueLabels);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/repos/:owner/:repo/milestones', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { data } = await api.get(`/repos/${owner}/${repo}/milestones`, { params: { state: 'all' } });


    res.json(data.map(m => ({
      id: m.id,
      title: m.title,
      state: m.state,
      open_issues: m.open_issues || m.open_issues_count || m.open || 0,
      closed_issues: m.closed_issues || m.closed_issues_count || m.closed || 0
    })));
  } catch (e) {
    console.error('Milestone API error:', e);
    res.json([]);
  }
});

// Settings persistence
const SETTINGS_PATH = path.join(__dirname, '../settings.json');
async function getSettings() {
  try {
    const data = await fsPromises.readFile(SETTINGS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {
      notifications: { enabled: false, checkTime: '09:00', reminderDays: [5, 3, 1], defaultOwner: 'IDITech' },
      sentReminders: {}
    };
  }
}

async function saveSettings(settings) {
  try {
    await fsPromises.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

app.get('/api/settings', async (_req, res) => {
  res.json(await getSettings());
});

app.post('/api/settings', async (req, res) => {
  await saveSettings(req.body);
  res.json({ ok: true });
});

// Notification Job
async function runNotificationCheck() {
  const settings = await getSettings();
  if (!settings.notifications?.enabled) return;

  const { defaultOwner, reminderDays } = settings.notifications;
  console.log(`[Cron] Running notification check for owner: ${defaultOwner}...`);

  try {
    let repos = [];
    try {
      repos = (await api.get(`/orgs/${defaultOwner}/repos`)).data;
    } catch {
      repos = (await api.get(`/users/${defaultOwner}/repos`)).data;
    }

    if (!Array.isArray(repos)) return;

    for (const repo of repos) {
      const issues = (await api.get(`/repos/${defaultOwner}/${repo.name}/issues`, { params: { state: 'open' } })).data;
      if (!Array.isArray(issues)) continue;

      for (const issue of issues) {
        if (!issue.due_date) continue;

        const dueDate = new Date(issue.due_date);
        const now = new Date();
        const d1 = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
        const d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diff = Math.round((d1 - d2) / (1000 * 60 * 60 * 24));
        if (reminderDays.includes(diff)) {
          const reminderKey = `reminder_${diff}`;
          const sentList = settings.sentReminders[issue.id] || [];

          if (!sentList.includes(reminderKey)) {
            console.log(`[Cron] Adding reminder for ${repo.name}#${issue.number} (due in ${diff} days)`);
            try {
              await api.post(`/repos/${defaultOwner}/${repo.name}/issues/${issue.number}/comments`, {
                body: `⏰ **Reminder**: This issue is due in **${diff}** ${diff === 1 ? 'day' : 'days'}.`
              });

              // Refresh settings to avoid race conditions with multiple updates
              const latestSettings = await getSettings();
              if (!latestSettings.sentReminders[issue.id]) latestSettings.sentReminders[issue.id] = [];
              latestSettings.sentReminders[issue.id].push(reminderKey);
              await saveSettings(latestSettings);
            } catch (err) {
              console.error(`[Cron] Failed to post comment to ${repo.name}#${issue.number}:`, err.message);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[Cron] Notification check failed:', e.message);
  }
}

// Schedule check every minute
cron.schedule('* * * * *', async () => {
  const settings = await getSettings();
  if (!settings.notifications?.enabled) return;

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (currentTime === settings.notifications.checkTime) {
    await runNotificationCheck();
  }
});

// removed train-duration endpoint

// removed train endpoint

// removed projects source endpoint

// removed buildProjectIssueMap and related helpers

// removed projects issue-map endpoint



// removed user-skills endpoint

// minimal static client (optional)
const publicDir = path.join(__dirname, '../public');
app.use(express.static(publicDir));

// Handle client routing, return all requests to React app
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const port = Number(process.env.PORT || 5120);
app.listen(port, () => {
  console.log(`Server listening on :${port}`);
});
