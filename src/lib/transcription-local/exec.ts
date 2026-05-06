import { execFile } from "child_process";
import { promisify } from "util";
import { WHISPER_MAX_BUFFER } from "./constants";

const execFilePromise = promisify(execFile);

type ExecFileOpts = {
  encoding: "utf8";
  maxBuffer: number;
  env?: NodeJS.ProcessEnv;
};

function buildExecOptions(maxBuffer: number, env?: NodeJS.ProcessEnv): ExecFileOpts {
  const base: ExecFileOpts = { encoding: "utf8", maxBuffer };
  if (env !== undefined) {
    base.env = env;
  }
  return base;
}

export function execFileAsync(command: string, args: string[]) {
  return execFilePromise(command, args, buildExecOptions(WHISPER_MAX_BUFFER));
}

export function execFileAsyncWithEnv(
  command: string,
  args: string[],
  options: { maxBuffer?: number; env?: NodeJS.ProcessEnv }
) {
  return execFilePromise(
    command,
    args,
    buildExecOptions(options.maxBuffer ?? WHISPER_MAX_BUFFER, options.env)
  );
}

export interface CapturedExecError {
  stderr?: string;
  stdout?: string;
  code?: number | string;
}

export function captureExecError(err: unknown): CapturedExecError {
  if (!err || typeof err !== "object") return {};
  const e = err as { stderr?: unknown; stdout?: unknown; code?: unknown };
  return {
    stderr: typeof e.stderr === "string" ? e.stderr : undefined,
    stdout: typeof e.stdout === "string" ? e.stdout : undefined,
    code: typeof e.code === "number" || typeof e.code === "string" ? e.code : undefined,
  };
}

export function logSubprocessFailure(tag: string, err: unknown) {
  const { stderr, code } = captureExecError(err);
  const exitInfo = code !== undefined ? ` (exit=${code})` : "";
  const tail = stderr?.trim();
  const detail = tail ? `\n${tail}` : "";
  console.error(`[${tag}] subprocess falhou${exitInfo}${detail}`);
}
