/**
 * Bridge between the extension's ProgressCallback and VS Code's
 * `window.withProgress` API.
 *
 * Every long-running command uses `withMfhProgress` so the user sees a
 * notification with step-by-step updates like "[3/8] Pushing to remote...".
 */

import * as vscode from 'vscode';
import type { ProgressCallback } from '../interfaces';

export async function withMfhProgress<T>(
  title: string,
  task: (onProgress: ProgressCallback) => Promise<T>,
): Promise<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false,
    },
    async (progress: vscode.Progress<{ message?: string; increment?: number }>) => {
      const onProgress: ProgressCallback = (step, current, total) => {
        const pct = Math.round((current / total) * 100);
        progress.report({
          message: `[${current}/${total}] ${step}`,
          increment: pct - (((current - 1) / total) * 100),
        });
      };

      return task(onProgress);
    },
  );
}
