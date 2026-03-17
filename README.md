# SkillSense

Context-aware code understanding using skill.md — a VS Code extension with a sidebar for querying skills and related code.

## Prerequisites

- Node.js (v18+)
- VS Code

## Setup

```bash
cd /path/to/skillsense
npm install
```

## Run the extension (F5)

1. **Open the extension folder in VS Code**  
   **File → Open Folder** → select the `skillsense` folder (the one that contains `package.json`).  
   Do not open a parent folder; the opened folder must be `skillsense`.

2. **Select the launch configuration**  
   Open the **Run and Debug** view (Ctrl+Shift+D / Cmd+Shift+D). In the dropdown at the top, choose **Run Extension**.

3. **Start debugging**  
   Press **F5** (or click the green play button in Run and Debug).  
   The first time, this runs the **compile** task, then opens a new window (**Extension Development Host**) with SkillSense loaded.

4. In the new window:
   - Click the **SkillSense** icon in the Activity Bar (left).
   - The sidebar shows: query input, Submit, Skill Files, and Results.

**If F5 does nothing:** Use **Run → Start Debugging** from the menu, or run the **compile** task once (**Terminal → Run Task → compile**), then try F5 again.

## Test the extension

1. **Sidebar**
   - In the Extension Development Host, open the SkillSense view from the Activity Bar.
   - You should see: heading "SkillSense", text input, and "Submit" button.

2. **Skill files**
   - Ensure the opened folder has at least one `skill.md` file (e.g. in the project root or a subfolder).
   - The "Skill Files" section should list each `skill.md` with its path and content.

3. **Query and results**
   - Type a word or phrase that appears in a skill file (e.g. "publish" or "api").
   - Click **Submit**.
   - "Results" should show matching paragraphs (with scores) and "Related Code Files" (if any `.ts`/`.js`/`.tsx`/`.jsx` files match).

4. **Open file**
   - Click a file path under "Related Code Files"; that file should open in the editor.

5. **Command**
   - **Ctrl+Shift+P** (or **Cmd+Shift+P**) → run **SkillSense: Hello World**.
   - An info message "Hello World from SkillSense" should appear.

## Development workflow

1. **Edit code**
   - Change TypeScript in `src/extension.ts` or `src/sidebarProvider.ts`.
   - Edit the HTML/CSS/JS inside the template string in `sidebarProvider.ts` for webview UI changes.

2. **Compile**
   ```bash
   npm run compile
   ```
   - Or run **Watch**: `npm run watch` in a terminal so `tsc` recompiles on save.

3. **Reload after changes**
   - In the **Extension Development Host** window, press **Ctrl+R** (or **Cmd+R**) to reload the extension and pick up new `out/*.js` changes.
   - For webview HTML changes, reload once; sometimes closing and reopening the sidebar view helps.

4. **Debug**
   - Set breakpoints in `src/*.ts` (they map to `out/*.js`).
   - **Debug Console** in the *original* VS Code window (where you pressed F5) shows `console.log` output (e.g. "User Input: ...").
   - Use **Run → Start Debugging** (F5) so the debugger is attached.

## Project structure

```
skillsense/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts      # Activation, command + sidebar registration
│   └── sidebarProvider.ts # Sidebar webview, skill load, query match, related files
├── out/                  # Compiled JS (after npm run compile)
├── media/
│   └── icon.svg
└── .vscode/
    └── launch.json       # F5 runs "Run Extension"
```

## Quick reference

| Action              | How |
|---------------------|-----|
| Launch extension    | F5 in VS Code with this folder open |
| Reload extension    | Ctrl+R / Cmd+R in Extension Development Host |
| Compile TypeScript  | `npm run compile` |
| Watch compile       | `npm run watch` |
| View logs           | Debug Console in the window where you pressed F5 |
