export type CleanupOptions = {
  all: boolean;
  user?: string;
  event?: string;
  apply: boolean;
  confirmAll?: string;
  confirmUser?: string;
  confirmEvent?: string;
  writersStopped: boolean;
};

export function parseOptions(args: string[]): CleanupOptions {
  const result: CleanupOptions = {
    all: false,
    apply: false,
    writersStopped: false,
  };
  const values = new Map<string, keyof CleanupOptions>([
    ['--user', 'user'],
    ['--event', 'event'],
    ['--confirm-all', 'confirmAll'],
    ['--confirm-user', 'confirmUser'],
    ['--confirm-event', 'confirmEvent'],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--all') result.all = true;
    else if (arg === '--apply') result.apply = true;
    else if (arg === '--writers-stopped') result.writersStopped = true;
    else if (values.has(arg)) {
      const key = values.get(arg)!;
      const value = args[++index];
      if (!value || value.startsWith('--'))
        throw new Error(`${arg} needs a value`);
      (result as Record<string, unknown>)[key] = value;
    } else if (arg === '--help' || arg === '-h') {
      throw new Error('help');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (result.all ? result.user || result.event : !result.user && !result.event)
    throw new Error(
      'Choose --all, --user, or --event (user and event may be combined)',
    );
  return result;
}

export function usage() {
  return `TicketChain database cleanup (dry-run unless --apply is supplied)

  --user <UUID|email>       Anonymize login while preserving purchase history
  --event <UUID>            Remove a cancelled event with no purchase history
  --all                     Clear application rows in source and service databases
  --apply                   Apply the selected cleanup
  --writers-stopped         Confirm web APIs and workers are stopped
  --confirm-user <UUID>     Required with --apply and --user
  --confirm-event <UUID>    Required with --apply and --event
  --confirm-all <DB_NAME>   Required with --apply and --all
  --help                    Show this help
`;
}
