import { mkdir, writeFile } from 'node:fs/promises';

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_USERNAME || 'kdjfs';

if (!token) {
  throw new Error('GITHUB_TOKEN is required to generate profile metrics.');
}

const now = new Date();
const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
const to = new Date();

const query = `
  query ProfileMetrics($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      followers { totalCount }
      repositories(
        first: 100
        ownerAffiliations: OWNER
        privacy: PUBLIC
        isFork: false
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        totalCount
        nodes { stargazerCount }
      }
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { contributionCount date }
          }
        }
      }
    }
  }
`;

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'kdjfs-profile-metrics',
  },
  body: JSON.stringify({
    query,
    variables: { login, from: from.toISOString(), to: to.toISOString() },
  }),
});

if (!response.ok) {
  throw new Error(`GitHub API request failed with ${response.status}.`);
}

const payload = await response.json();
if (payload.errors?.length) {
  throw new Error(`GitHub GraphQL error: ${payload.errors.map(({ message }) => message).join('; ')}`);
}

const user = payload.data?.user;
if (!user) {
  throw new Error(`GitHub user ${login} was not found.`);
}

const contributions = user.contributionsCollection;
const monthKeys = Array.from({ length: 12 }, (_, index) => {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
  return date.toISOString().slice(0, 7);
});
const monthly = new Map(monthKeys.map((key) => [key, 0]));

for (const week of contributions.contributionCalendar.weeks) {
  for (const day of week.contributionDays) {
    const key = day.date.slice(0, 7);
    if (monthly.has(key)) monthly.set(key, monthly.get(key) + day.contributionCount);
  }
}

const metrics = {
  total: contributions.contributionCalendar.totalContributions,
  commits: contributions.totalCommitContributions,
  pullRequests: contributions.totalPullRequestContributions,
  issues: contributions.totalIssueContributions,
  repositories: user.repositories.totalCount,
  followers: user.followers.totalCount,
  stars: user.repositories.nodes.reduce((sum, repository) => sum + repository.stargazerCount, 0),
  months: monthKeys.map((key) => ({
    key,
    label: new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(
      new Date(`${key}-01T00:00:00Z`),
    ),
    value: monthly.get(key),
  })),
  updated: now.toISOString().slice(0, 10),
};

const themes = {
  dark: {
    background: '#080a10',
    surface: '#10131d',
    text: '#f3f0ea',
    muted: '#a6a6b2',
    faint: '#737582',
    border: '#2a2d38',
    violet: '#9e8cff',
    cyan: '#55dbe7',
    blue: '#6fa3ff',
  },
  light: {
    background: '#f6f6fa',
    surface: '#ffffff',
    text: '#12131a',
    muted: '#5f6170',
    faint: '#898b98',
    border: '#dedee7',
    violet: '#7458e8',
    cyan: '#087e8b',
    blue: '#2362da',
  },
};

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function renderActivity(themeName) {
  const color = themes[themeName];
  const maxMonthly = Math.max(1, ...metrics.months.map(({ value }) => value));
  const chartTop = 316;
  const chartBottom = 468;
  const chartHeight = chartBottom - chartTop;
  const barWidth = 38;
  const step = 66;
  const chartStart = 68;

  const bars = metrics.months
    .map(({ label, value }, index) => {
      const height = Math.max(4, Math.round((value / maxMonthly) * chartHeight));
      const x = chartStart + index * step;
      const y = chartBottom - height;
      const fill = index === metrics.months.length - 1 ? color.cyan : color.violet;
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="8" fill="${fill}" fill-opacity="${index === metrics.months.length - 1 ? '1' : '.74'}"/>
        <text x="${x + barWidth / 2}" y="${Math.max(chartTop - 8, y - 8)}" text-anchor="middle" fill="${color.muted}" font-size="13">${value}</text>
        <text x="${x + barWidth / 2}" y="499" text-anchor="middle" fill="${color.faint}" font-size="15">${label}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540" viewBox="0 0 900 540" role="img" aria-labelledby="title desc">
  <title id="title">GitHub activity for ${escapeXml(login)}</title>
  <desc id="desc">Real public GitHub contribution metrics for the most recent twelve months.</desc>
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${color.violet}"/><stop offset="1" stop-color="${color.cyan}"/></linearGradient>
  </defs>
  <rect x="1" y="1" width="898" height="538" rx="22" fill="${color.background}" stroke="${color.border}"/>
  <rect x="32" y="24" width="5" height="34" rx="2.5" fill="url(#accent)"/>
  <g font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
    <text x="52" y="50" fill="${color.text}" font-size="25" font-weight="730">GitHub Activity</text>
    <text x="858" y="49" fill="${color.faint}" font-size="13" text-anchor="end">UPDATED ${metrics.updated}</text>

    <g transform="translate(32 78)"><rect width="260" height="112" rx="16" fill="${color.surface}" stroke="${color.border}"/><text x="22" y="47" fill="${color.violet}" font-size="35" font-weight="760">${metrics.total}</text><text x="22" y="77" fill="${color.text}" font-size="16" font-weight="650">Total Contributions</text><text x="22" y="99" fill="${color.faint}" font-size="13">Most recent 12 months</text></g>
    <g transform="translate(320 78)"><rect width="260" height="112" rx="16" fill="${color.surface}" stroke="${color.border}"/><text x="22" y="47" fill="${color.cyan}" font-size="35" font-weight="760">${metrics.pullRequests}</text><text x="22" y="77" fill="${color.text}" font-size="16" font-weight="650">Pull Requests</text><text x="22" y="99" fill="${color.faint}" font-size="13">Public contribution activity</text></g>
    <g transform="translate(608 78)"><rect width="260" height="112" rx="16" fill="${color.surface}" stroke="${color.border}"/><text x="22" y="47" fill="${color.blue}" font-size="35" font-weight="760">${metrics.repositories}</text><text x="22" y="77" fill="${color.text}" font-size="16" font-weight="650">Public Repositories</text><text x="22" y="99" fill="${color.faint}" font-size="13">Owned, non-fork repositories</text></g>

    <text x="36" y="233" fill="${color.muted}" font-size="16">Commits <tspan fill="${color.text}" font-weight="700">${metrics.commits}</tspan></text>
    <text x="220" y="233" fill="${color.muted}" font-size="16">Issues <tspan fill="${color.text}" font-weight="700">${metrics.issues}</tspan></text>
    <text x="365" y="233" fill="${color.muted}" font-size="16">Followers <tspan fill="${color.text}" font-weight="700">${metrics.followers}</tspan></text>
    <text x="555" y="233" fill="${color.muted}" font-size="16">Owned repo stars <tspan fill="${color.text}" font-weight="700">${metrics.stars}</tspan></text>

    <text x="36" y="282" fill="${color.text}" font-size="19" font-weight="690">Monthly Contributions</text>
    <text x="858" y="282" fill="${color.faint}" font-size="13" text-anchor="end">PUBLIC DATA · GITHUB GRAPHQL</text>
    <path d="M36 316H864M36 392H864M36 468H864" stroke="${color.border}" stroke-dasharray="4 8"/>
    ${bars}
    <text x="36" y="525" fill="${color.faint}" font-size="13">Counts reflect GitHub&apos;s public contribution model and the account&apos;s linked commit identity.</text>
  </g>
</svg>`;
}

function renderMobileActivity(themeName) {
  const color = themes[themeName];
  const maxMonthly = Math.max(1, ...metrics.months.map(({ value }) => value));
  const chartTop = 318;
  const chartBottom = 446;
  const chartHeight = chartBottom - chartTop;
  const barWidth = 15;
  const step = 29;
  const chartStart = 27;

  const bars = metrics.months
    .map(({ label, value }, index) => {
      const height = Math.max(3, Math.round((value / maxMonthly) * chartHeight));
      const x = chartStart + index * step;
      const y = chartBottom - height;
      const fill = index === metrics.months.length - 1 ? color.cyan : color.violet;
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="4" fill="${fill}" fill-opacity="${index === metrics.months.length - 1 ? '1' : '.74'}"/>
        <text x="${x + barWidth / 2}" y="${Math.max(chartTop - 5, y - 5)}" text-anchor="middle" fill="${color.muted}" font-size="8">${value}</text>
        <text x="${x + barWidth / 2}" y="466" text-anchor="middle" fill="${color.faint}" font-size="8">${label.slice(0, 1)}</text>`;
    })
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="510" viewBox="0 0 390 510" role="img" aria-labelledby="title desc">
  <title id="title">GitHub activity for ${escapeXml(login)}</title>
  <desc id="desc">Real public GitHub contribution metrics for the most recent twelve months.</desc>
  <defs><linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${color.violet}"/><stop offset="1" stop-color="${color.cyan}"/></linearGradient></defs>
  <rect x="1" y="1" width="388" height="508" rx="18" fill="${color.background}" stroke="${color.border}"/>
  <rect x="18" y="18" width="4" height="28" rx="2" fill="url(#accent)"/>
  <g font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
    <text x="32" y="39" fill="${color.text}" font-size="18" font-weight="730">GitHub Activity</text>
    <text x="372" y="38" fill="${color.faint}" font-size="8" text-anchor="end">${metrics.updated}</text>
    <g transform="translate(18 64)"><rect width="108" height="88" rx="13" fill="${color.surface}" stroke="${color.border}"/><text x="14" y="39" fill="${color.violet}" font-size="26" font-weight="760">${metrics.total}</text><text x="14" y="61" fill="${color.text}" font-size="10" font-weight="650">Contributions</text><text x="14" y="76" fill="${color.faint}" font-size="8">12 months</text></g>
    <g transform="translate(141 64)"><rect width="108" height="88" rx="13" fill="${color.surface}" stroke="${color.border}"/><text x="14" y="39" fill="${color.cyan}" font-size="26" font-weight="760">${metrics.pullRequests}</text><text x="14" y="61" fill="${color.text}" font-size="10" font-weight="650">Pull Requests</text><text x="14" y="76" fill="${color.faint}" font-size="8">Public activity</text></g>
    <g transform="translate(264 64)"><rect width="108" height="88" rx="13" fill="${color.surface}" stroke="${color.border}"/><text x="14" y="39" fill="${color.blue}" font-size="26" font-weight="760">${metrics.repositories}</text><text x="14" y="61" fill="${color.text}" font-size="10" font-weight="650">Repositories</text><text x="14" y="76" fill="${color.faint}" font-size="8">Owned · public</text></g>
    <text x="20" y="188" fill="${color.muted}" font-size="11">Commits <tspan fill="${color.text}" font-weight="700">${metrics.commits}</tspan></text>
    <text x="124" y="188" fill="${color.muted}" font-size="11">Issues <tspan fill="${color.text}" font-weight="700">${metrics.issues}</tspan></text>
    <text x="205" y="188" fill="${color.muted}" font-size="11">Followers <tspan fill="${color.text}" font-weight="700">${metrics.followers}</tspan></text>
    <text x="303" y="188" fill="${color.muted}" font-size="11">Stars <tspan fill="${color.text}" font-weight="700">${metrics.stars}</tspan></text>
    <text x="20" y="232" fill="${color.text}" font-size="15" font-weight="690">Monthly Contributions</text>
    <text x="370" y="232" fill="${color.faint}" font-size="8" text-anchor="end">GITHUB GRAPHQL</text>
    <path d="M20 318H370M20 382H370M20 446H370" stroke="${color.border}" stroke-dasharray="3 6"/>
    ${bars}
    <text x="20" y="493" fill="${color.faint}" font-size="8">Public GitHub data · generated in this repository</text>
  </g>
</svg>`;
}

await mkdir('dist', { recursive: true });
await Promise.all(
  Object.keys(themes).flatMap((themeName) => [
    writeFile(`dist/activity-${themeName}.svg`, renderActivity(themeName), 'utf8'),
    writeFile(`dist/activity-mobile-${themeName}.svg`, renderMobileActivity(themeName), 'utf8'),
  ]),
);

console.log(
  `Generated activity SVGs for ${login}: ${metrics.total} contributions across ${metrics.repositories} owned public repositories.`,
);
