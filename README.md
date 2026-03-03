# Gitea Issue Notifier & Dashboard

Advanced owner-centric dashboard for Gitea issues with multi-repository aggregation, dynamic filtering, and scheduled due-date notifications.

## 🚀 Key Features

-   **Owner-Centric Dashboard**: View all issues across every repository owned by a specific user or organization in one place.
-   **Multi-Repo Aggregation**: Automatically fetches and combines data from all repositories belonging to the selected owner.
-   **Dynamic Filtering**:
    -   **Repository**: Filter issues by specific repos.
    -   **Assignees**: See only issues assigned to specific team members.
    -   **Projects**: Organize and filter by Gitea Projects.
    -   **Milestones**: Track progress across different milestones.
    -   **Labels**: Advanced label filtering (including "No Label" support).
-   **Scheduled Notifications**: Automatically post reminder comments to issues when they are 5, 3, or 1 days away from their due date (configurable).
-   **Visual Urgency**: Color-coded due dates (Green → Red) that dynamically highlight upcoming deadlines based on natural calendar days.
-   **Settings Management**: Server-side persistence for holidays, default owners, and notification schedules.

## 🛠️ Tech Stack

-   **Backend**: Node.js, Express.js, node-cron
-   **Frontend**: Vanilla JS, HTML5, CSS3, Lucide Icons
-   **API**: Gitea API (Axios)
-   **Deployment**: PM2 Support

## 📦 Installation & Setup

### 1. Prerequisite
Ensure you have [Node.js](https://nodejs.org) installed.

### 2. Install Dependencies
```bash
cd server
npm install
```

### 3. Environment Configuration
Create a `.env` file in the `server` directory:
```env
GITEA_BASE_URL=https://your-gitea-instance.com
GITEA_TOKEN=your_personal_access_token
PORT=5120
```

### 4. Running the App

**Development Mode:**
```bash
npm run dev
```

**Production Mode (using PM2):**
```bash
# Install PM2
npm install pm2 -g

# Start the application
pm2 start ecosystem.config.cjs

# Manage process
pm2 logs gitea-notifier
pm2 status
```

## ⚙️ Configuration

-   **Holidays**: Can be managed through the UI settings tab to exclude non-working days from time calculations.
-   **Notifications**: Enable "Daily Reminder Comments" in the settings tab to have the server automatically nudge assignees on nearing deadlines.

## 📝 License

Private / Confidential.
