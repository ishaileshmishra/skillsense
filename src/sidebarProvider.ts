import * as vscode from "vscode";
import { buildContext, generateAIResponse } from "./aiService";

interface SkillFileEntry {
  path: string;
  content: string;
}

const MAX_MATCHES_PER_FILE = 10;
const MAX_CODE_FILES_TO_SCAN = 200;
const MAX_RELATED_FILES_PER_RESULT = 5;

const STOP_WORDS = new Set([
  "the",
  "is",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "his",
  "was",
  "one",
  "our",
  "out",
  "has",
  "have",
  "this",
  "that",
  "with",
  "from",
]);

const ERROR_KEYWORDS = new Set([
  "error",
  "failed",
  "timeout",
  "exception",
  "500",
  "404",
  "slow",
  "latency",
  "crash",
  "found",
]);

interface RankedMatch {
  text: string;
  score: number;
}

interface RankedResult {
  path: string;
  matches: RankedMatch[];
}

interface RelatedFileEntry {
  filePath: string;
  score: number;
}

interface EnhancedResult {
  path: string;
  matches: RankedMatch[];
  relatedFiles: RelatedFileEntry[];
}

interface IssueAnalysisResult {
  type: string;
  possibleCauses: string[];
  results: EnhancedResult[];
}

export class SkillSenseSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _skillData: SkillFileEntry[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: {
        type: string;
        value?: string;
        filePath?: string;
        data?:
          | SkillFileEntry[]
          | RankedResult[]
          | EnhancedResult[]
          | IssueAnalysisResult;
      }) => {
        if (message.type === "submit" && message.value !== undefined) {
          console.log("User Input:", message.value);
          this._handleQuery(message.value);
        }
        if (message.type === "openFile" && message.filePath) {
          const folder = vscode.workspace.workspaceFolders?.[0];
          if (folder) {
            const uri = vscode.Uri.joinPath(folder.uri, message.filePath);
            vscode.window.showTextDocument(uri);
          }
        }
      },
    );

    this._loadAndSendSkillFiles(webviewView.webview);
  }

  private _matchQuery(query: string): RankedResult[] {
    const queryLower = query.toLowerCase().trim();
    if (!queryLower) {
      return [];
    }
    const queryTokens = queryLower.split(/\s+/).filter((t) => t.length > 0);
    const results: RankedResult[] = [];

    for (const file of this._skillData) {
      const paragraphs = file.content
        .split(/\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      const scored: RankedMatch[] = [];

      for (const paragraph of paragraphs) {
        const score = this._computeScore(queryTokens, queryLower, paragraph);
        if (score > 0) {
          scored.push({ text: paragraph, score });
        }
      }

      if (scored.length > 0) {
        scored.sort((a, b) => b.score - a.score);
        const top = scored.slice(0, MAX_MATCHES_PER_FILE);
        results.push({ path: file.path, matches: top });
      }
    }

    results.sort((a, b) => {
      const maxA = a.matches[0]?.score ?? 0;
      const maxB = b.matches[0]?.score ?? 0;
      return maxB - maxA;
    });
    return results;
  }

  private async _handleQuery(query: string): Promise<void> {
    const ranked = this._matchQuery(query);
    const queryLower = query.toLowerCase().trim();
    const queryTokens = queryLower
      ? queryLower.split(/\s+/).filter((t) => t.length > 0)
      : [];
    const enhanced: EnhancedResult[] = [];

    for (const result of ranked) {
      const matchedText = result.matches.map((m) => m.text).join(" ");
      const keywords = this._extractKeywords(queryTokens, matchedText);
      const relatedFiles = await this._searchRelevantFiles(keywords);
      enhanced.push({
        path: result.path,
        matches: result.matches,
        relatedFiles,
      });
    }

    this._view?.webview.postMessage({
      type: "enhancedResults",
      data: enhanced,
    });

    const issueKeywords = this._extractIssueKeywords(query);
    const issueType = this._classifyIssue(query);
    const possibleCauses = this._generateCauses(issueType);
    const issueQuery = issueKeywords.join(" ");
    const issueRanked = issueQuery ? this._matchQuery(issueQuery) : [];
    const issueResults: EnhancedResult[] = [];

    for (const result of issueRanked) {
      const matchedText = result.matches.map((m) => m.text).join(" ");
      const keywords = this._extractKeywords(issueKeywords, matchedText);
      const relatedFiles = await this._searchRelevantFiles(keywords);
      issueResults.push({
        path: result.path,
        matches: result.matches,
        relatedFiles,
      });
    }

    const issueAnalysis: IssueAnalysisResult = {
      type: issueType,
      possibleCauses,
      results: issueResults,
    };
    this._view?.webview.postMessage({
      type: "issueAnalysis",
      data: issueAnalysis,
    });

    try {
      const context = buildContext(query, issueAnalysis);
      const aiText = await generateAIResponse(context);
      this._view?.webview.postMessage({ type: "aiResponse", data: aiText });
    } catch {
      this._view?.webview.postMessage({
        type: "aiResponse",
        data: "AI response unavailable. Check API key.",
      });
    }
  }

  private _extractKeywords(queryTokens: string[], fromText: string): string[] {
    const seen = new Set<string>();
    for (const t of queryTokens) {
      if (t.length > 3 && !STOP_WORDS.has(t)) {
        seen.add(t.toLowerCase());
      }
    }
    const words = fromText
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
    for (const w of words) {
      seen.add(w);
    }
    return Array.from(seen);
  }

  private async _searchRelevantFiles(
    keywords: string[],
  ): Promise<RelatedFileEntry[]> {
    if (keywords.length === 0) {
      return [];
    }
    const uris = await vscode.workspace.findFiles("**/*.{ts,js,tsx,jsx}");
    const limited = uris.slice(0, MAX_CODE_FILES_TO_SCAN);
    const scored: { filePath: string; score: number }[] = [];

    for (const uri of limited) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = new TextDecoder().decode(bytes);
        const path = vscode.workspace.asRelativePath(uri);
        let score = 0;
        const contentLower = content.toLowerCase();
        for (const kw of keywords) {
          let idx = 0;
          while ((idx = contentLower.indexOf(kw, idx)) !== -1) {
            score += 1;
            idx += kw.length;
          }
        }
        if (score > 0) {
          scored.push({ filePath: path, score });
        }
      } catch {
        // skip unreadable files
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, MAX_RELATED_FILES_PER_RESULT);
  }

  private _extractIssueKeywords(text: string): string[] {
    const seen = new Set<string>();
    const lower = text.toLowerCase();
    const words = lower.split(/\W+/).filter((w) => w.length > 0);
    for (const w of words) {
      if (ERROR_KEYWORDS.has(w) || (w.length > 3 && !STOP_WORDS.has(w))) {
        seen.add(w);
      }
    }
    return Array.from(seen);
  }

  private _classifyIssue(text: string): string {
    const lower = text.toLowerCase();
    if (/timeout|slow|latency/.test(lower)) {
      return "PERFORMANCE";
    }
    if (/404|not\s+found/.test(lower)) {
      return "MISSING_RESOURCE";
    }
    if (/500|exception|crash/.test(lower)) {
      return "SERVER_ERROR";
    }
    return "GENERAL";
  }

  private _generateCauses(type: string): string[] {
    switch (type) {
      case "PERFORMANCE":
        return [
          "Possible DB query delay",
          "Cache miss or not configured",
          "Heavy processing in service layer",
        ];
      case "MISSING_RESOURCE":
        return [
          "Incorrect ID or missing entry",
          "Data not published or synced",
        ];
      case "SERVER_ERROR":
        return [
          "Unhandled exception in service",
          "Null/undefined data access",
          "Dependency failure",
        ];
      default:
        return ["Review skill.md and related code for context."];
    }
  }

  private _computeScore(
    queryTokens: string[],
    exactPhrase: string,
    text: string,
  ): number {
    const textLower = text.toLowerCase();
    let score = 0;
    if (exactPhrase.length > 0 && textLower.includes(exactPhrase)) {
      score += 2;
    }
    for (const token of queryTokens) {
      let count = 0;
      let idx = 0;
      while ((idx = textLower.indexOf(token, idx)) !== -1) {
        count++;
        idx += token.length;
      }
      score += count;
    }
    return score;
  }

  private async _loadAndSendSkillFiles(webview: vscode.Webview): Promise<void> {
    const uris = await vscode.workspace.findFiles("**/skill.md");
    const files: SkillFileEntry[] = [];

    for (const uri of uris) {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = new TextDecoder().decode(bytes);
      const path = vscode.workspace.asRelativePath(uri);
      files.push({ path, content });
    }

    this._skillData = files;
    webview.postMessage({ type: "skillData", data: files });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SkillSense</title>
  <style>
    body {
      padding: 12px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
    }
    h1 {
      font-size: 1.2em;
      margin: 0 0 12px 0;
    }
    input {
      width: 100%;
      padding: 8px;
      margin-bottom: 8px;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
    }
    button {
      padding: 8px 16px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .skill-files-section {
      margin-top: 16px;
    }
    .skill-files-section h2 {
      font-size: 1em;
      margin: 0 0 8px 0;
    }
    .skill-file {
      margin-bottom: 12px;
    }
    .skill-file-path {
      font-size: 0.9em;
      color: var(--vscode-textLink-foreground);
      margin-bottom: 4px;
    }
    .skill-file-content {
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
      background: var(--vscode-textBlockQuote-background);
      padding: 8px;
      border-radius: 4px;
      max-height: 200px;
      overflow: auto;
    }
    .results-section {
      margin-top: 16px;
    }
    .results-section h2 {
      font-size: 1em;
      margin: 0 0 8px 0;
    }
    .result-file {
      margin-bottom: 12px;
    }
    .result-file-path {
      font-size: 0.9em;
      color: var(--vscode-textLink-foreground);
      margin-bottom: 4px;
    }
    .result-snippet {
      white-space: pre-wrap;
      font-size: 0.9em;
      background: var(--vscode-textBlockQuote-background);
      padding: 6px 8px;
      border-radius: 4px;
      margin-bottom: 4px;
    }
    .result-score {
      font-size: 0.75em;
      color: var(--vscode-descriptionForeground);
      margin-left: 6px;
    }
    .related-files {
      margin-top: 8px;
      font-size: 0.85em;
    }
    .related-files-title {
      margin-bottom: 4px;
      color: var(--vscode-descriptionForeground);
    }
    .related-file-link {
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      text-decoration: underline;
      display: block;
      margin-bottom: 2px;
    }
    .related-file-link:hover {
      color: var(--vscode-textLink-activeForeground);
    }
    .issue-analysis-section {
      margin-top: 16px;
    }
    .issue-analysis-section h2 {
      font-size: 1em;
      margin: 0 0 8px 0;
    }
    .issue-type {
      font-size: 0.9em;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .issue-causes {
      margin-bottom: 8px;
      font-size: 0.9em;
    }
    .issue-causes ul {
      margin: 4px 0 0 0;
      padding-left: 18px;
    }
    .ai-insight-section {
      margin-top: 16px;
    }
    .ai-insight-section h2 {
      font-size: 1em;
      margin: 0 0 8px 0;
    }
    .ai-insight-content {
      white-space: pre-wrap;
      font-size: 0.9em;
      background: var(--vscode-textBlockQuote-background);
      padding: 10px;
      border-radius: 4px;
      max-height: 300px;
      overflow: auto;
    }
  </style>
</head>
<body>
  <h1>SkillSense</h1>
  <input type="text" id="query-input" placeholder="Enter your query" />
  <button id="submit-btn">Submit</button>
  <div class="skill-files-section">
    <h2>Skill Files</h2>
    <div id="skill-files-container">Loading...</div>
  </div>
  <div class="results-section">
    <h2>Results</h2>
    <div id="results-container"></div>
  </div>
  <div class="issue-analysis-section">
    <h2>Issue Analysis</h2>
    <div id="issue-analysis-container"></div>
  </div>
  <div class="ai-insight-section">
    <h2>AI Insight</h2>
    <div id="ai-insight-container"></div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const input = document.getElementById('query-input');
    const btn = document.getElementById('submit-btn');
    const container = document.getElementById('skill-files-container');
    const resultsContainer = document.getElementById('results-container');
    const issueContainer = document.getElementById('issue-analysis-container');
    const aiInsightContainer = document.getElementById('ai-insight-container');
    function escapeHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    btn.addEventListener('click', function() {
      const value = input.value || '';
      vscode.postMessage({ type: 'submit', value: value });
    });
    window.addEventListener('message', function(event) {
      const msg = event.data;
      if (msg.type === 'skillData') {
        const data = msg.data || [];
        if (data.length === 0) {
          container.textContent = 'No skill.md files found in workspace';
        } else {
          container.innerHTML = data.map(function(file) {
            const escaped = escapeHtml(file.content);
            return '<div class="skill-file"><div class="skill-file-path">' + file.path + '</div><pre class="skill-file-content">' + escaped + '</pre></div>';
          }).join('');
        }
      }
      if (msg.type === 'rankedResults' || msg.type === 'enhancedResults') {
        const data = msg.data || [];
        if (data.length === 0) {
          resultsContainer.textContent = 'No relevant results found';
        } else {
          resultsContainer.innerHTML = data.map(function(item) {
            const snippets = item.matches.map(function(m) {
              return '<div class="result-snippet">' + escapeHtml(m.text) + '<span class="result-score">(' + m.score + ')</span></div>';
            }).join('');
            let relatedHtml = '';
            if (item.relatedFiles && item.relatedFiles.length > 0) {
              relatedHtml = '<div class="related-files"><div class="related-files-title">Related Code Files</div>' +
                item.relatedFiles.map(function(rf) {
                  return '<a class="related-file-link" data-path="' + escapeHtml(rf.filePath) + '">' + escapeHtml(rf.filePath) + ' (' + rf.score + ')</a>';
                }).join('') + '</div>';
            }
            return '<div class="result-file"><div class="result-file-path">' + escapeHtml(item.path) + '</div>' + snippets + relatedHtml + '</div>';
          }).join('');
          resultsContainer.querySelectorAll('.related-file-link').forEach(function(el) {
            el.addEventListener('click', function() {
              const path = el.getAttribute('data-path');
              if (path) vscode.postMessage({ type: 'openFile', filePath: path });
            });
          });
        }
      }
      if (msg.type === 'issueAnalysis') {
        const data = msg.data;
        if (!data) {
          issueContainer.textContent = '';
          return;
        }
        const results = data.results || [];
        if (results.length === 0) {
          issueContainer.innerHTML = '<div class="issue-type">Issue Type: ' + escapeHtml(data.type) + '</div>' +
            '<div class="issue-causes"><strong>Possible causes:</strong><ul>' +
            (data.possibleCauses || []).map(function(c) { return '<li>' + escapeHtml(c) + '</li>'; }).join('') + '</ul></div>' +
            '<p>No strong matches found. Try refining input.</p>';
        } else {
          issueContainer.innerHTML = '<div class="issue-type">Issue Type: ' + escapeHtml(data.type) + '</div>' +
            '<div class="issue-causes"><strong>Possible causes:</strong><ul>' +
            (data.possibleCauses || []).map(function(c) { return '<li>' + escapeHtml(c) + '</li>'; }).join('') + '</ul></div>' +
            data.results.map(function(item) {
              const snippets = item.matches.map(function(m) {
                return '<div class="result-snippet">' + escapeHtml(m.text) + '<span class="result-score">(' + m.score + ')</span></div>';
              }).join('');
              let relatedHtml = '';
              if (item.relatedFiles && item.relatedFiles.length > 0) {
                relatedHtml = '<div class="related-files"><div class="related-files-title">Related Code Files</div>' +
                  item.relatedFiles.map(function(rf) {
                    return '<a class="related-file-link" data-path="' + escapeHtml(rf.filePath) + '">' + escapeHtml(rf.filePath) + ' (' + rf.score + ')</a>';
                  }).join('') + '</div>';
              }
              return '<div class="result-file"><div class="result-file-path">' + escapeHtml(item.path) + '</div>' + snippets + relatedHtml + '</div>';
            }).join('');
          issueContainer.querySelectorAll('.related-file-link').forEach(function(el) {
            el.addEventListener('click', function() {
              const path = el.getAttribute('data-path');
              if (path) vscode.postMessage({ type: 'openFile', filePath: path });
            });
          });
        }
      }
      if (msg.type === 'aiResponse') {
        const text = (msg.data != null) ? String(msg.data) : '';
        aiInsightContainer.textContent = text;
        aiInsightContainer.className = 'ai-insight-content';
      }
    });
  </script>
</body>
</html>`;
  }
}
