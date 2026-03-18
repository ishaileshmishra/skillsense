import * as vscode from "vscode";

import { SkillSenseSidebarProvider } from "./sidebarProvider";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("skillsense.helloWorld", () => {
      vscode.window.showInformationMessage("Hello World from SkillSense");
    }),
  );

  const sidebarProvider = new SkillSenseSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "skillsense.sidebar",
      sidebarProvider,
    ),
  );
}

export function deactivate(): void {}
