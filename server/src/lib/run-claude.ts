import { spawn } from 'node:child_process';

export type RunClaudeArgs = {
  prompt: string;
  input: string;
  timeoutMs: number;
};

export type RunClaude = (args: RunClaudeArgs) => Promise<string>;

// Spawn `claude` directly with PATH augmented to include ~/.local/bin (where the
// Claude Code CLI installs). The launchd daemon inherits a minimal PATH that doesn't
// include user-local bins, so we add it explicitly here — cleaner than wrapping
// in a shell, and avoids nvm's chpwd hook polluting stdout.
// --permission-mode bypassPermissions is required so WebSearch runs non-interactively
// (without it, claude -p denies the tool and returns an explanation instead of JSON).
export const defaultRunClaude: RunClaude = async ({ prompt, input, timeoutMs }) => {
  const home = process.env.HOME ?? '';
  const augmentedPath = [`${home}/.local/bin`, process.env.PATH ?? '/usr/bin:/bin'].join(':');
  return new Promise<string>((resolve, reject) => {
    const child = spawn('claude', ['-p', '--permission-mode', 'bypassPermissions'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: augmentedPath },
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
