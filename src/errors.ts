export class CLIError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = "CLIError";
  }
}

export function die(message: string, exitCode = 1): never {
  throw new CLIError(message, exitCode);
}
