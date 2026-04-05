export class CLIError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
    public readonly suggestion?: string,
  ) {
    super(message);
    this.name = "CLIError";
  }
}

export class ValidationError extends CLIError {
  constructor(message: string, suggestion?: string, exitCode = 1) {
    super(message, exitCode, suggestion);
    this.name = "ValidationError";
  }
}

export class FileSystemError extends CLIError {
  constructor(message: string, suggestion?: string) {
    super(message, 1, suggestion);
    this.name = "FileSystemError";
  }
}

export class GitError extends CLIError {
  constructor(message: string, suggestion?: string) {
    super(message, 1, suggestion);
    this.name = "GitError";
  }
}

export class ConfigError extends CLIError {
  constructor(message: string, suggestion?: string) {
    super(message, 1, suggestion);
    this.name = "ConfigError";
  }
}

export function die(message: string | Error, exitCode?: number): never {
  if (message instanceof CLIError) {
    throw message;
  }
  const msg = typeof message === "string" ? message : message.message;
  throw new CLIError(msg, exitCode ?? 1);
}
