import OpenAI from 'openai';

const MAX_SNIPPET_LENGTH = 400;
const TOP_SKILL_MATCHES = 3;
const TOP_RELATED_FILES = 3;

export interface IssueAnalysisForContext {
  type: string;
  results: Array<{
    path: string;
    matches: Array<{ text: string; score: number }>;
    relatedFiles: Array<{ filePath: string; score: number }>;
  }>;
}

export function buildContext(input: string, issueAnalysisResult: IssueAnalysisForContext): string {
  const lines: string[] = [];

  lines.push('User Query:');
  lines.push(input || '(none)');
  lines.push('');

  lines.push('Issue Type:');
  lines.push(issueAnalysisResult.type || 'GENERAL');
  lines.push('');

  const allMatches: Array<{ text: string; path: string }> = [];
  for (const r of issueAnalysisResult.results) {
    for (const m of r.matches) {
      const snippet = m.text.length > MAX_SNIPPET_LENGTH
        ? m.text.slice(0, MAX_SNIPPET_LENGTH) + '...'
        : m.text;
      allMatches.push({ text: snippet, path: r.path });
    }
  }
  const topMatches = allMatches.slice(0, TOP_SKILL_MATCHES);

  lines.push('Relevant Knowledge:');
  if (topMatches.length === 0) {
    lines.push('- (no skill matches)');
  } else {
    for (const m of topMatches) {
      lines.push(`- [${m.path}] ${m.text}`);
    }
  }
  lines.push('');

  const fileScores = new Map<string, number>();
  for (const r of issueAnalysisResult.results) {
    for (const f of r.relatedFiles) {
      const current = fileScores.get(f.filePath) ?? 0;
      fileScores.set(f.filePath, current + f.score);
    }
  }
  const sortedFiles = Array.from(fileScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_RELATED_FILES);

  lines.push('Related Files:');
  if (sortedFiles.length === 0) {
    lines.push('- (none)');
  } else {
    for (const [filePath] of sortedFiles) {
      lines.push(`- ${filePath}`);
    }
  }

  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are a senior software engineer helping debug and understand a codebase.
Only use the provided context.
Do not hallucinate.
If unsure, say you are not certain.
Keep your response concise.`;

const USER_PROMPT_TEMPLATE = `Context:
<context>

Task:
- Explain the issue
- Suggest possible root causes
- Suggest where to check in code`;

export async function generateAIResponse(context: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('OPENAI_API_KEY not set');
  }

  const client = new OpenAI({ apiKey });
  const userPrompt = USER_PROMPT_TEMPLATE.replace('<context>', context);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 600,
  });

  const content = response.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Empty response from model');
  }
  return content;
}
