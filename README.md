# Remote - Flatpak Host

This extension enables developing on the host system while in the unofficial [VSCode Flatpak](https://flathub.org/en/apps/com.visualstudio.code).

## Setup

This extension makes use of two [VSCode API proposals](https://code.visualstudio.com/api/advanced-topics/using-proposed-api), which means in order to use it, you must allow the extension to use the API proposals. Add `ryanabx.flatpak-host-remote` to the `enable-proposed-api` section of your `~/.vscode/argv.json` (create it if it doesn't exist):

```json
{
	"enable-proposed-api": [
		"ryanabx.flatpak-host-remote"
	]
}
```

## How does this work?

This extension will download the vscode-server resources to `$HOME/.vscode-server-flatpak`, and invoke it with `flatpak-spawn --host`. The server will expose itself over `LOCALHOST`, and the VSCode Flatpak will connect to `LOCALHOST`.

This requires the `--share=network` permission and the `--talk-name=org.freedesktop.Flatpak` permission, both of which are set by default in Flatpak VSCode.

The extension will also exit if it's not within a flatpak environment, so it's safe to leave enabled in general.

## License

This extension is licensed under the GPL-3.0-or-later license. Portions of the code are derived from Visual Studio Code written by Microsoft under the MIT license.