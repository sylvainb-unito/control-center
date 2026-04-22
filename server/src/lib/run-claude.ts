import { spawn } from 'node:child_process';

export type RunClaudeArgs = {
  prompt: string;
  input: string;
  timeoutMs: number;
};

export type RunClaude = (args: RunClaudeArgs) => Promise<string>;

// Spawns `claude -p` through a login shell so PATH resolves under launchd.
// Bare `spawn('claude', ...)` fails with ENOENT in prod because launchd's
// child processes go through /usr/bin/login which doesn't source .zshrc/.zprofile.
// The same workaround is used in panels/claude-sessions for Ghostty (sessions.ts).
export const defaultRunClaude: RunClaude = async ({ prompt, input, timeoutMs }) => {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('/bin/zsh', ['-ilc', 'claude -p'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(
            `claude -p exited with code ${code}${stderr ? `: ${stderr.slice(0, 200)}` : ''}`,
          ),
        );
    });

    // Swallow EPIPE if the child exits before we finish writing; the close handler reports the real cause.
    child.stdin.on('error', () => {});
    child.stdin.end(`${prompt}${input}\n`);
  });
};
