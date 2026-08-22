import * as vscode from 'vscode';

const API_KEY_SECRET = 'deeppeak.deepseekApiKey';
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const WEEKEND_PRICING_EFFECTIVE_AT = Date.UTC(2026, 7, 22, 16);
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1_000;
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
};

type WidgetState = {
  balance?: Balance;
  error?: string;
  loading: boolean;
};

type ModelId = 'deepseek-v4-flash' | 'deepseek-v4-pro' | 'deepseek-v4-flash-vision-exp';

type ModelPricing = {
  inputCacheHit: number;
  inputCacheMiss: number;
  output: number;
};

const MODEL_PRICING: Record<ModelId, ModelPricing> = {
  'deepseek-v4-flash': { inputCacheHit: 0.007, inputCacheMiss: 0.22, output: 0.66 },
  'deepseek-v4-pro': { inputCacheHit: 0.022, inputCacheMiss: 0.66, output: 1.98 },
  'deepseek-v4-flash-vision-exp': { inputCacheHit: 0.007, inputCacheMiss: 0.22, output: 0.66 }
};

type PricingPeriod = {
  isPeak: boolean;
  name: 'Peak' | 'Off-peak';
  color: 'red' | 'green';
  nextChange: Date;
};

type SettingsOption = 'apiKey' | 'refreshIntervalSeconds' | 'model';

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
    vscode.commands.registerCommand('deeppeak.openSettings', () => openSettings(context)),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('deeppeak.refreshIntervalSeconds')) {
        startRefreshTimer(context);
      }
      if (event.affectsConfiguration('deeppeak.refreshIntervalSeconds') ||
          event.affectsConfiguration('deeppeak.model')) {
        updateStatusBar();
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

async function openSettings(context: vscode.ExtensionContext): Promise<void> {
  const option = await vscode.window.showQuickPick<{
    label: string;
    description: string;
    value: SettingsOption;
  }>([
    {
      label: '$(key) Set API key',
      description: 'Update the DeepSeek API key',
      value: 'apiKey'
    },
    {
      label: '$(sync) Change update interval',
      description: `Currently every ${getRefreshIntervalSeconds()} seconds`,
      value: 'refreshIntervalSeconds'
    },
    {
      label: '$(symbol-enum) Pick model',
      description: `Currently ${getConfiguredModel()}`,
      value: 'model'
    }
  ], {
    placeHolder: 'DeepPeak options'
  });

  if (!option) {
    return;
  }

  if (option.value === 'apiKey') {
    await setApiKey(context);
    return;
  }

  if (option.value === 'refreshIntervalSeconds') {
    await changeRefreshInterval();
    return;
  }

  await pickModel();
}

async function changeRefreshInterval(): Promise<void> {
  const current = getRefreshIntervalSeconds();
  const value = await vscode.window.showInputBox({
    prompt: 'Update interval in seconds',
    value: String(current),
    validateInput: input => {
      const seconds = Number(input);
      return Number.isInteger(seconds) && seconds >= 30
        ? undefined
        : 'Enter a whole number of at least 30 seconds.';
    }
  });

  if (value === undefined) {
    return;
  }

  await vscode.workspace.getConfiguration('deeppeak').update(
    'refreshIntervalSeconds',
    Number(value),
    vscode.ConfigurationTarget.Global
  );
}

async function pickModel(): Promise<void> {
  const option = await vscode.window.showQuickPick<{
    label: string;
    model: ModelId;
  }>(
    (Object.keys(MODEL_PRICING) as ModelId[]).map(model => ({
      label: model,
      model
    })),
    {
      placeHolder: 'Select the model whose pricing should be shown',
      canPickMany: false
    }
  );

  if (!option) {
    return;
  }

  await vscode.workspace.getConfiguration('deeppeak').update(
    'model',
    option.model,
    vscode.ConfigurationTarget.Global
  );
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
  } else {
    tooltip.appendText(state.loading ? 'Loading balance...' : state.error ?? 'No balance available');
  }
  const model = getConfiguredModel();
  const pricing = MODEL_PRICING[model];
  const inputCacheHit = formatRate(period.isPeak ? pricing.inputCacheHit * 2 : pricing.inputCacheHit);
  const inputCacheMiss = formatRate(period.isPeak ? pricing.inputCacheMiss * 2 : pricing.inputCacheMiss);
  const output = formatRate(period.isPeak ? pricing.output * 2 : pricing.output);
  tooltip.appendText(`\n\n${period.name} pricing`);
  tooltip.appendText(`\nModel: ${model}`);
  tooltip.appendText(`\nInput: ${inputCacheMiss}/1M (cache miss), ${inputCacheHit}/1M (cache hit)`);
  tooltip.appendText(`\nOutput: ${output}/1M tokens`);
  tooltip.appendText(`\nLocal time: ${formatLocalTime(new Date())}`);
  tooltip.appendText(`\nNext change: ${formatLocalTime(period.nextChange)}`);
  tooltip.appendText(`\nTimezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  tooltip.appendText(`\nUpdates every ${getRefreshIntervalSeconds()} seconds`);
  tooltip.appendMarkdown('\n\n[\u2699 Settings](command:deeppeak.openSettings)');
  tooltip.isTrusted = { enabledCommands: ['deeppeak.openSettings'] };
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
  const isPeak = isPeakAt(now);
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
  if (date.getTime() >= WEEKEND_PRICING_EFFECTIVE_AT) {
    const beijingDay = new Date(date.getTime() + BEIJING_UTC_OFFSET_MS).getUTCDay();
    if (beijingDay === 0 || beijingDay === 6) {
      return false;
    }
  }

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
  if (total === undefined) {
    throw new Error('DeepSeek returned an invalid balance amount.');
  }

  return { currency: info.currency, total };
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

function formatRate(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  }).format(amount);
}

function getConfiguredModel(): ModelId {
  const configured = vscode.workspace
    .getConfiguration('deeppeak')
    .get<string>('model', 'deepseek-v4-flash');
  return isModelId(configured) ? configured : 'deepseek-v4-flash';
}

function isModelId(value: string): value is ModelId {
  return value in MODEL_PRICING;
}
