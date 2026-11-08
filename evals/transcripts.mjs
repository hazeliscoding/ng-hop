// Reads a run's transcript into what the grader needs, whichever agent wrote it: the commands it ran, the skills it
// loaded, its last message and what it cost.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lines = (runDir) => readFileSync(join(runDir, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

// Claude Code's stream-json.
export function parseClaude(events) {
  const result = events.find((l) => l.type === 'result');
  const commands = [];
  const tools = {};
  const skills = [];
  let lastText = '';
  for (const l of events) {
    if (l.type !== 'assistant') continue;
    for (const part of l.message?.content || []) {
      if (part.type === 'text' && part.text.trim()) lastText = part.text;
      if (part.type !== 'tool_use') continue;
      tools[part.name] = (tools[part.name] || 0) + 1;
      if (part.name === 'Bash' || part.name === 'PowerShell') commands.push(part.input.command);
      if (part.name === 'Skill') skills.push(part.input.skill);
    }
  }
  return { result, commands, tools, skills, finalText: result?.result || lastText };
}

// OpenCode's `run --format json`: one event a line, with tool calls as `tool_use` events whose part names the tool and
// carries its input. Its last message is whatever it wrote after its last tool call.
export function parseOpenCode(events) {
  const commands = [];
  const tools = {};
  const skills = [];
  let after = [];
  let lastText = '';
  let steps = 0, cost = 0, tokens = 0, error = null;
  for (const e of events) {
    const part = e.part || {};
    if (e.type === 'text' && part.text?.trim()) { after.push(part.text); lastText = part.text; }
    if (e.type === 'tool_use') {
      after = [];
      const input = part.state?.input || {};
      tools[part.tool] = (tools[part.tool] || 0) + 1;
      if (part.tool === 'bash' && input.command) commands.push(input.command);
      if (part.tool === 'skill' && input.name) skills.push(input.name);
      // Reading the skill's file by hand loads it just as well.
      if (part.tool === 'read' && /[\\/]ng-hop[\\/]SKILL\.md$/i.test(input.filePath || input.path || '')) skills.push('ng-hop');
    }
    if (e.type === 'step_finish') {
      steps += 1;
      cost += part.cost || 0;
      const t = part.tokens || {};
      tokens += (t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (t.cache?.read || 0) + (t.cache?.write || 0);
    }
    if (e.type === 'error') error = e.error?.data?.message || e.error?.message || JSON.stringify(e.error || e).slice(0, 300);
  }
  return {
    result: { num_turns: steps, is_error: Boolean(error), error, total_cost_usd: cost, usage: { input_tokens: tokens } },
    commands, tools, skills, finalText: after.join('\n\n') || lastText,
  };
}

export function parseTranscript(runDir) {
  const events = lines(runDir);
  return events.some((e) => e.sessionID && ['step_start', 'tool_use', 'text', 'step_finish'].includes(e.type)) ? parseOpenCode(events) : parseClaude(events);
}
