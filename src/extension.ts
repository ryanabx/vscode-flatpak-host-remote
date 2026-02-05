// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2025 Ryan Brue <ryanbrue.dev@gmail.com>

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import * as http from 'http';
import * as crypto from 'crypto';
import { downloadAndUnzipVSCodeServer } from './download';
import { terminateProcess } from './util/processes';

let extHostProcess: cp.ChildProcess | undefined;
const enum CharCode {
	Backspace = 8,
	LineFeed = 10
}

let outputChannel: vscode.OutputChannel;

const SLOWED_DOWN_CONNECTION_DELAY = 800;

export function activate(context: vscode.ExtensionContext) {

	// Check for .flatpak-info, exit if not present
	const markerFile = path.join("/", ".flatpak-info");

    if (!fs.existsSync(markerFile)) {
        // File not found → do nothing
        return;
    }

	function getTunnelFeatures(): vscode.TunnelInformation['tunnelFeatures'] {
		return {
			elevation: true,
			privacyOptions: vscode.workspace.getConfiguration('flatpakhostremote').get('supportPublicPorts') ? [
				{
					id: 'public',
					label: 'Public',
					themeIcon: 'eye'
				},
				{
					id: 'other',
					label: 'Other',
					themeIcon: 'circuit-board'
				},
				{
					id: 'private',
					label: 'Private',
					themeIcon: 'eye-closed'
				}
			] : []
		};
	}

	function doResolve(authority: string, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<vscode.ResolverResult> {
		const connectionToken = String(crypto.randomInt(0xffffffffff));

		// eslint-disable-next-line no-async-promise-executor
		const serverPromise = new Promise<vscode.ResolvedAuthority>(async (res, rej) => {
			progress.report({ message: 'Starting Flatpak Host Remote' });
			outputChannel = vscode.window.createOutputChannel('FlatpakHostRemote');

			let isResolved = false;
			async function processError(message: string) {
				outputChannel.appendLine(message);
				if (!isResolved) {
					isResolved = true;
					outputChannel.show();

					const result = await vscode.window.showErrorMessage(message, { modal: true }, ...getActions());
					if (result) {
						await result.execute();
					}
					rej(vscode.RemoteAuthorityResolverError.NotAvailable(message, true));
				}
			}

			let lastProgressLine = '';
			function processOutput(output: string) {
				outputChannel.append(output);
				for (let i = 0; i < output.length; i++) {
					const chr = output.charCodeAt(i);
					if (chr === CharCode.LineFeed) {
						const match = lastProgressLine.match(/Extension host agent listening on (\d+)/);
						if (match) {
							isResolved = true;
							res(new vscode.ResolvedAuthority('127.0.0.1', parseInt(match[1], 10), connectionToken)); // success!
						}
						lastProgressLine = '';
					} else if (chr === CharCode.Backspace) {
						lastProgressLine = lastProgressLine.substr(0, lastProgressLine.length - 1);
					} else {
						lastProgressLine += output.charAt(i);
					}
				}
			}

			const { updateUrl, commit, quality, serverDataFolderName, serverApplicationName, dataFolderName } = getProductConfiguration();
			const commandArgs = ['--host=127.0.0.1', '--port=0', '--disable-telemetry', '--disable-experiments', '--use-host-proxy', '--accept-server-license-terms'];
			const env = getNewEnv();
			const remoteDataDir = process.env['FLATPAKHOST_DATA_FOLDER'] || path.join(os.homedir(), `${serverDataFolderName || dataFolderName}-flatpakhost`);
			const logsDir = process.env['FLATPAKHOST_LOGS_FOLDER'];
			if (logsDir) {
				commandArgs.push('--logsPath', logsDir);
			}
			const logLevel = process.env['FLATPAKHOST_LOG_LEVEL'];
			if (logLevel) {
				commandArgs.push('--log', logLevel);
			}
			outputChannel.appendLine(`Using data folder at ${remoteDataDir}`);
			commandArgs.push('--server-data-dir', remoteDataDir);

			commandArgs.push('--connection-token', connectionToken);

			if (!commit) { // dev mode
				const serverCommand = process.platform === 'win32' ? 'code-server.bat' : 'code-server.sh';
				const vscodePath = path.resolve(path.join(context.extensionPath, '..', '..'));
				const serverCommandPath = path.join(vscodePath, 'scripts', serverCommand);

				outputChannel.appendLine(`Launching server: "${serverCommandPath}" ${commandArgs.join(' ')}`);
				const shell = (process.platform === 'win32');
				extHostProcess = cp.spawn(serverCommandPath, commandArgs, { env, cwd: vscodePath, shell });
			} else {
				const extensionToInstall = process.env['FLATPAKHOST_INSTALL_BUILTIN_EXTENSION'];
				if (extensionToInstall) {
					commandArgs.push('--install-builtin-extension', extensionToInstall);
					commandArgs.push('--start-server');
				}
				const serverCommand = `${serverApplicationName}${process.platform === 'win32' ? '.cmd' : ''}`;
				let serverLocation = env['VSCODE_REMOTE_SERVER_PATH']; // support environment variable to specify location of server on disk
				if (!serverLocation) {
					const serverBin = path.join(remoteDataDir, 'bin');
					progress.report({ message: 'Installing VSCode Server' });
					serverLocation = await downloadAndUnzipVSCodeServer(updateUrl, commit, quality, serverBin, m => outputChannel.appendLine(m));
				}

				const preArgs = ["--host", path.join(serverLocation, 'bin', serverCommand)];

				outputChannel.appendLine(`Using server build at ${serverLocation}`);
				outputChannel.appendLine(`Server arguments ${commandArgs.join(' ')}`);
				const shell = (process.platform === 'win32');
				extHostProcess = cp.spawn("/usr/bin/flatpak-spawn", preArgs.concat(commandArgs), { env, cwd: serverLocation, shell });
			}
			extHostProcess.stdout!.on('data', (data: Buffer) => processOutput(data.toString()));
			extHostProcess.stderr!.on('data', (data: Buffer) => processOutput(data.toString()));
			extHostProcess.on('error', (error: Error) => {
				processError(`server failed with error:\n${error.message}`);
				extHostProcess = undefined;
			});
			extHostProcess.on('close', (code: number) => {
				processError(`server closed unexpectedly.\nError code: ${code}`);
				extHostProcess = undefined;
			});
			context.subscriptions.push({
				dispose: () => {
					if (extHostProcess) {
						terminateProcess(extHostProcess, context.extensionPath);
					}
				}
			});
		});

		return serverPromise.then((serverAddr): Promise<vscode.ResolverResult> => {
			if (authority.includes('managed')) {
				console.log('Connecting via a managed authority');
				return Promise.resolve(new vscode.ManagedResolvedAuthority(async () => {
					const remoteSocket = net.createConnection({ port: serverAddr.port });
					const dataEmitter = new vscode.EventEmitter<Uint8Array>();
					const closeEmitter = new vscode.EventEmitter<Error | undefined>();
					const endEmitter = new vscode.EventEmitter<void>();

					await new Promise((res, rej) => {
						remoteSocket.on('data', d => dataEmitter.fire(d))
							.on('error', err => { rej(); closeEmitter.fire(err); })
							.on('close', () => endEmitter.fire())
							.on('end', () => endEmitter.fire())
							.on('connect', res);
					});


					return {
						onDidReceiveMessage: dataEmitter.event,
						onDidClose: closeEmitter.event,
						onDidEnd: endEmitter.event,
						send: d => remoteSocket.write(d),
						end: () => remoteSocket.end(),
					};
				}, connectionToken));
			}

			return new Promise<vscode.ResolvedAuthority>((res, _rej) => {
				const proxyServer = net.createServer(proxySocket => {
					outputChannel.appendLine(`Proxy connection accepted`);
					let remoteReady = true, localReady = true;
					const remoteSocket = net.createConnection({ port: serverAddr.port });

					proxySocket.on('data', async (data) => {
						remoteReady = remoteSocket.write(data);
						if (!remoteReady) {
							proxySocket.pause();
						}
					});
					remoteSocket.on('data', async (data) => {
						localReady = proxySocket.write(data);
						if (!localReady) {
							remoteSocket.pause();
						}
					});
					proxySocket.on('drain', () => {
						localReady = true;
						remoteSocket.resume();
					});
					remoteSocket.on('drain', () => {
						remoteReady = true;
						proxySocket.resume();
					});
					proxySocket.on('close', () => {
						outputChannel.appendLine(`Proxy socket closed, closing remote socket.`);
						remoteSocket.end();
					});
					remoteSocket.on('close', () => {
						outputChannel.appendLine(`Remote socket closed, closing proxy socket.`);
						proxySocket.end();
					});
					context.subscriptions.push({
						dispose: () => {
							proxySocket.end();
							remoteSocket.end();
						}
					});
				});
				proxyServer.listen(0, '127.0.0.1', () => {
					const port = (<net.AddressInfo>proxyServer.address()).port;
					outputChannel.appendLine(`Going through proxy at port ${port}`);
					res(new vscode.ResolvedAuthority('127.0.0.1', port, connectionToken));
				});
				context.subscriptions.push({
					dispose: () => {
						proxyServer.close();
					}
				});
			});
		});
	}

	const authorityResolverDisposable = vscode.workspace.registerRemoteAuthorityResolver('flatpakhost', {
		async getCanonicalURI(uri: vscode.Uri): Promise<vscode.Uri> {
			return vscode.Uri.file(uri.path);
		},
		resolve(_authority: string): Thenable<vscode.ResolverResult> {
			return vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Open Flatpak Host Remote ([details](command:flatpak-hostremote.showLog))',
				cancellable: false
			}, async (progress) => {
				const rr = await doResolve(_authority, progress);
				rr.tunnelFeatures = getTunnelFeatures();
				return rr;
			});
		},
		tunnelFactory,
		showCandidatePort
	});
	context.subscriptions.push(authorityResolverDisposable);

	context.subscriptions.push(vscode.commands.registerCommand('flatpak-hostremote.newWindow', () => {
		return vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: 'flatpakhost+host' });
	}));
	context.subscriptions.push(vscode.commands.registerCommand('flatpak-hostremote.currentWindow', () => {
		const folders = vscode.workspace.workspaceFolders;

		if (folders && folders.length > 0) {
			const rootPath = folders[0].uri.fsPath;
			return vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.from({ scheme: 'vscode-remote', authority: "flatpakhost+host", path: rootPath }), { forceNewWindow: false });
		}
		else {
			return vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: 'flatpakhost+host', reuseWindow: true });
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('flatpak-hostremote.currentWindowManaged', () => {
		return vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: 'flatpakhost+hostmanaged', reuseWindow: true });
	}));
	context.subscriptions.push(vscode.commands.registerCommand('flatpak-hostremote.showLog', () => {
		if (outputChannel) {
			outputChannel.show();
		}
	}));

	vscode.commands.executeCommand('setContext', 'forwardedPortsViewEnabled', true);
}

type ActionItem = (vscode.MessageItem & { execute: () => void });

function getActions(): ActionItem[] {
	const actions: ActionItem[] = [];
	const isDirty = vscode.workspace.textDocuments.some(d => d.isDirty) || vscode.workspace.workspaceFile && vscode.workspace.workspaceFile.scheme === 'untitled';

	actions.push({
		title: 'Retry',
		execute: async () => {
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	});
	if (!isDirty) {
		actions.push({
			title: 'Close Remote',
			execute: async () => {
				await vscode.commands.executeCommand('vscode.newWindow', { reuseWindow: true, remoteAuthority: null });
			}
		});
	}
	actions.push({
		title: 'Ignore',
		isCloseAffordance: true,
		execute: async () => {
			vscode.commands.executeCommand('flatpak-hostremote.showLog'); // no need to wait
		}
	});
	return actions;
}

export interface IProductConfiguration {
	updateUrl: string;
	commit: string;
	quality: string;
	dataFolderName: string;
	serverApplicationName?: string;
	serverDataFolderName?: string;
}

function getProductConfiguration(): IProductConfiguration {
	const content = fs.readFileSync(path.join(vscode.env.appRoot, 'product.json')).toString();
	return JSON.parse(content) as IProductConfiguration;
}

function getNewEnv(): { [x: string]: string | undefined } {
	const env = { ...process.env };
	delete env['ELECTRON_RUN_AS_NODE'];
	return env;
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

function getConfiguration<T>(id: string): T | undefined {
	return vscode.workspace.getConfiguration('flatpakhostremote').get<T>(id);
}

const remoteServers: number[] = [];

async function showCandidatePort(_host: string, port: number, _detail: string): Promise<boolean> {
	return remoteServers.includes(port) || port === 100;
}

async function tunnelFactory(tunnelOptions: vscode.TunnelOptions, tunnelCreationOptions: vscode.TunnelCreationOptions): Promise<vscode.Tunnel> {
	outputChannel.appendLine(`Tunnel factory request: Remote ${tunnelOptions.remoteAddress.port} -> local ${tunnelOptions.localAddressPort}`);
	if (tunnelCreationOptions.elevationRequired) {
		// For flatpak, since we aren't actually forwarding anything, I think we should be fine here.
		// await vscode.window.showInformationMessage('Privilege escalation required', { modal: true }, 'Ok');
	}

	return createTunnelService();

	function newTunnel(localAddress: { host: string; port: number }): vscode.Tunnel {
		const onDidDispose: vscode.EventEmitter<void> = new vscode.EventEmitter();
		let isDisposed = false;
		return {
			localAddress,
			remoteAddress: tunnelOptions.remoteAddress,
			public: tunnelOptions.public,
			privacy: tunnelOptions.privacy,
			protocol: tunnelOptions.protocol,
			onDidDispose: onDidDispose.event,
			dispose: () => {
				if (!isDisposed) {
					isDisposed = true;
					onDidDispose.fire();
				}
			}
		};
	}

	function createTunnelService(): Promise<vscode.Tunnel> {
		return new Promise<vscode.Tunnel>((res, _rej) => {
			// We don't need to tunnel as Flatpak has a shared network with the host :)
			const tunnel = newTunnel({ host: tunnelOptions.remoteAddress.host, port: tunnelOptions.remoteAddress.port });
			res(tunnel);
		});
	}
}
