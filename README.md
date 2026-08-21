# DeepPeak

DeepPeak is a lightweight VS Code status-bar widget for monitoring a DeepSeek API balance and peak/off-peak pricing.

DeepPeak is an independent community project and is not affiliated with DeepSeek.

The status bar shows only a heartbeat icon and the current pricing state. Hover over it for the balance, credit breakdown, local time, timezone, next pricing change, and refresh interval.

## Features

- Native status-bar hover popover
- Red peak and green off-peak state
- Automatic balance refresh every 60 seconds
- 24-hour time formatting outside US timezones
- API key stored with VS Code SecretStorage
- No telemetry and no API key in source code or UI

## Development

1. Open this folder in VS Code.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5` to launch an Extension Development Host, or run `npm run package` to create an installable `.vsix`.
5. Run **DeepPeak: Set DeepSeek API Key** from the Command Palette.
6. Hover over the DeepPeak status item.

## Installing the packaged extension

Download the `.vsix` artifact from the repository's Actions run, then install it with:

Manual Install
1. Download  deeppeak-0.0.1.vsix .
2. In VS Code, open Extensions → ... → Install from VSIX...
3. Select the downloaded  .vsix  file and reload VS Code.

Set you API Key
1. In VS Code, press Ctrl+Shift+P.
2. Search for DeepPeak: Set DeepSeek API Key.
3. Select it and enter your DeepSeek key ( sk-... ).
4. Press Enter.

CLI Install
```text
code --install-extension deeppeak-0.0.1.vsix
```

Change `deeppeak.refreshIntervalSeconds` in VS Code settings to adjust polling. Values below 30 seconds are clamped to 30 seconds.

DeepSeek peak pricing is treated as **01:00-04:00 UTC** and **06:00-10:00 UTC**. All other hours are off-peak.

## Open-source checklist

The source repository is [github.com/NoPainNullGain/deeppeak](https://github.com/NoPainNullGain/deeppeak).

## License

MIT. See [LICENSE](LICENSE).
