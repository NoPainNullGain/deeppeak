import * as vscode from 'vscode';

const API_KEY_SECRET = 'deeppeak.deepseekApiKey';
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const US_TIME_ZONE_PREFIXES = [
  'America/Adak',
  'America/Anchorage',
  'America/Boise',
  'America/Chicago',
  'America/Denver',
  'America/Detroit',
  'America/Indiana/',
  'America/Juneau',
  'America/Kentucky/',
  'America/Los_Angeles',
  'America/Menominee',
  'America/Metlakatla',
  'America/New_York',
  'America/Nome',
  'America/North_Dakota/',
  'America/Phoenix',
  'America/Sitka',
  'America/Yakutat',
  'Pacific/Honolulu',
  'US/'
];

type Balance = {
  currency: string;
  total: number;
  granted: number;
  toppedUp: number;
};

type WidgetState = {
  balance?: Balance;
  error?: string;
  loading: boolean;
};

type PricingPeriod = {
  isPeak: boolean;
  name: 'Peak' | 'Off-peak';
  color: 'red' | 'green';
  nextChange: Date;
};

let state: WidgetState = { loading: true };
let statusBarItem: vscode.StatusBarItem;
let refreshTimer: vscode.Disposable | undefined;
let pricingTimer: vscode.Disposable | undefined;
let refreshInFlight = false;

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('deeppeak.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand('deeppeak.refresh', () => refresh(context)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('deeppeak.refreshIntervalSeconds')) {
        startRefreshTimer(context);
      }
    })
  );

  startRefreshTimer(context);
  void refresh(context);
}

export function deactivate(): void {
  refreshTimer?.dispose();
  pricingTimer?.dispose();
}

function startRefreshTimer(context: vscode.ExtensionContext): void {
  refreshTimer?.dispose();
  pricingTimer?.dispose();

  const balanceTimer = setInterval(() => void refresh(context, true), getRefreshIntervalSeconds() * 1_000);
  const clockTimer = setInterval(() => {
    updateStatusBar();
  }, 30_000);

  refreshTimer = new vscode.Disposable(() => clearInterval(balanceTimer));
  pricingTimer = new vscode.Disposable(() => clearInterval(clockTimer));
  context.subscriptions.push(refreshTimer);
  context.subscriptions.push(pricingTimer);
}

async function refresh(context: vscode.ExtensionContext, quiet = false): Promise<void> {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  state = { ...state, loading: true, error: undefined };
  updateStatusBar();

  try {
    const apiKey = await context.secrets.get(API_KEY_SECRET);
    if (!apiKey) {
      throw new Error('No API key configured. Use "DeepPeak: Set DeepSeek API Key".');
    }

    const response = await fetch(BALANCE_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(`DeepSeek returned ${response.status}${detail ? `: ${detail}` : '.'}`);
    }

    state = { balance: parseBalance(await response.json()), loading: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read the DeepSeek balance.';
    state = { ...state, loading: false, error: message };
    if (!quiet) {
      vscode.window.showWarningMessage(message);
    }
  } finally {
    refreshInFlight = false;
    updateStatusBar();
  }
}

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const apiKey = await vscode.window.showInputBox({
    prompt: 'Enter your DeepSeek API key',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-...'
  });
  if (!apiKey?.trim()) {
    return;
  }

  await context.secrets.store(API_KEY_SECRET, apiKey.trim());
  await refresh(context);
}

function updateStatusBar(): void {
  const period = getPricingPeriod();
  const balance = state.balance;
  statusBarItem.text = `$(pulse) ${period.name}`;
  statusBarItem.color = new vscode.ThemeColor(period.color === 'red' ? 'testing.iconFailed' : 'testing.iconPassed');
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown('**DeepPeak**\n\n');
  if (balance) {
    tooltip.appendText(`${formatMoney(balance.total, balance.currency)} available`);
    tooltip.appendText(`\nGranted: ${formatMoney(balance.granted, balance.currency)}`);
    tooltip.appendText(`\nTopped up: ${formatMoney(balance.toppedUp, balance.currency)}`);
  } else {
    tooltip.appendText(state.loading ? 'Loading balance...' : state.error ?? 'No balance available');
  }
  tooltip.appendText(`\n\n${period.name} pricing`);
  tooltip.appendText(`\nLocal time: ${formatLocalTime(new Date())}`);
  tooltip.appendText(`\nNext change: ${formatLocalTime(period.nextChange)}`);
  tooltip.appendText(`\nTimezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  tooltip.appendText(`\nUpdates every ${getRefreshIntervalSeconds()} seconds`);
  tooltip.isTrusted = false;
  statusBarItem.tooltip = tooltip;
}

function getRefreshIntervalSeconds(): number {
  const configured = vscode.workspace
    .getConfiguration('deeppeak')
    .get<number>('refreshIntervalSeconds', 60);
  return Math.max(30, configured);
}

function formatLocalTime(date: Date): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const isUsTimeZone = US_TIME_ZONE_PREFIXES.some(prefix => timeZone.startsWith(prefix));
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: isUsTimeZone
  });
}

function getPricingPeriod(now = new Date()): PricingPeriod {
  const hour = now.getUTCHours();
  const isPeak = (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
  const nextChange = new Date(now);
  nextChange.setUTCMinutes(0, 0, 0);

  do {
    nextChange.setUTCHours(nextChange.getUTCHours() + 1);
  } while (isPeakAt(nextChange) === isPeak);

  return {
    isPeak,
    name: isPeak ? 'Peak' : 'Off-peak',
    color: isPeak ? 'red' : 'green',
    nextChange
  };
}

function isPeakAt(date: Date): boolean {
  const hour = date.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

function parseBalance(value: unknown): Balance {
  if (!isRecord(value) || !Array.isArray(value.balance_infos) || value.balance_infos.length === 0) {
    throw new Error('DeepSeek returned an unexpected balance response.');
  }

  const info = value.balance_infos[0];
  if (!isRecord(info) || typeof info.currency !== 'string') {
    throw new Error('DeepSeek returned an incomplete balance response.');
  }

  const total = numberValue(info.total_balance);
  const granted = numberValue(info.granted_balance);
  const toppedUp = numberValue(info.topped_up_balance);
  if (total === undefined || granted === undefined || toppedUp === undefined) {
    throw new Error('DeepSeek returned an invalid balance amount.');
  }

  return { currency: info.currency, total, granted, toppedUp };
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(amount);
}
