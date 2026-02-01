![Flatpak Host Remote Logo](icon.png)

# Remote - Flatpak Host

This extension enables developing on the host system while in the [unofficial VSCode Flatpak](https://flathub.org/en/apps/com.visualstudio.code).

## Setup

Download the latest release .vsix here: <https://github.com/ryanabx/vscode-flatpak-host-remote/releases>

Open the VSCode Flatpak, and open the command palette and type `Install from VSIX`:

![Picture of running the command palette](media/tutorial1.png)

Select the released .vsix that you downloaded. Close VSCode after the extension installs.

This extension makes use of two [VSCode API proposals](https://code.visualstudio.com/api/advanced-topics/using-proposed-api), which means in order to use it, you must allow the extension to use the API proposals. Add `ryanabx.flatpak-host-remote` to the `enable-proposed-api` section of your `~/.vscode/argv.json` (create it if it doesn't exist):

```json
{ // Whatever came before this stays
	...,
	"enable-proposed-api": [
		"ryanabx.flatpak-host-remote"
	]
}
```

> **NOTE:** This also means that I cannot upload the extension to the Microsoft Extension Registry as they do not allow extensions that use API proposals.

Start VSCode, and you should see the Flatpak Sandbox Exit options in the remote picker:

![Remote picker options](tutorial2.png)

## How does this work?

This extension will download the vscode-server resources to `$HOME/.vscode-server-flatpak`, and invoke it with `flatpak-spawn --host`. The server will expose itself over `localhost`, and the VSCode Flatpak will connect to it because the network is shared.

This requires the `--share=network` permission and the `--talk-name=org.freedesktop.Flatpak` permission, both of which are set by default in Flatpak VSCode.

The extension will also exit if it's not within a flatpak environment, so it's safe to leave enabled in general.

## License

This extension is licensed under the GPL-3.0-or-later license. Portions of the code are derived from Visual Studio Code written by Microsoft under the MIT license.