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
