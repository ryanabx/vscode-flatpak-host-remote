// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2025 Ryan Brue <ryanbrue.dev@gmail.com>

import * as cp from 'child_process';
import * as path from 'path';

export interface TerminateResponse {
	success: boolean;
	error?: any;
}

export function terminateProcess(p: cp.ChildProcess, extensionPath: string): TerminateResponse {
	if (process.platform === 'darwin' || process.platform === 'linux') {
		try {
			const cmd = path.join(extensionPath, 'scripts', 'terminateProcess.sh');
			const result = cp.spawnSync(cmd, [p.pid!.toString()]);
			if (result.error) {
				return { success: false, error: result.error };
			}
		} catch (err) {
			return { success: false, error: err };
		}
	} else {
		p.kill('SIGKILL');
	}
	return { success: true };
}
