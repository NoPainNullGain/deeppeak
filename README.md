# DeepPeak

DeepPeak is a lightweight VS Code status-bar widget for monitoring a DeepSeek API balance and peak/off-peak pricing.

DeepPeak is an independent community project and is not affiliated with DeepSeek.

The status bar shows only a heartbeat icon and the current pricing state. Hover over it for the balance, credit breakdown, local time, timezone, next pricing change, and refresh interval.

## Features

- Native status-bar hover popover
- Red peak and green off-peak state
- Current model pricing, including cache-hit and cache-miss input rates
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

Download the latest `.vsix` from the [releases page](https://github.com/NoPainNullGain/deeppeak/releases), then:

1. In VS Code, open **Extensions**.
2. Open the `...` menu and choose **Install from VSIX...**.
3. Select the downloaded `.vsix` file and reload VS Code.

Alternatively, install from a terminal:

```bash
code --install-extension deeppeak-0.0.2.vsix
```

Change `deeppeak.refreshIntervalSeconds` in VS Code settings to adjust polling. Values below 30 seconds are clamped to 30 seconds.

Set `deeppeak.model` to the model used by your API client so the hover popup displays the correct rate card. DeepPeak reads the balance endpoint only and cannot infer which model another client is using.

To set the API key:

1. Press `Ctrl+Shift+P`.
2. Run **DeepPeak: Set DeepSeek API Key**.
3. Enter your DeepSeek key.

DeepSeek peak pricing is treated as **01:00-04:00 UTC** and **06:00-10:00 UTC**. All other hours are off-peak.

## Open-source checklist

The source repository is [github.com/NoPainNullGain/deeppeak](https://github.com/NoPainNullGain/deeppeak).

## License

MIT. See [LICENSE](LICENSE).
