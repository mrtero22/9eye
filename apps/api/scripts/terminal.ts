// Terminal helpers shared by the scripts that ask for a password.

import { createInterface } from 'node:readline';
import { platformDb } from '../src/db';

/** Prints the message, closes the database connection and stops with exit code 1. */
export async function fail(message: string): Promise<never> {
  console.error(message);
  await platformDb.$disconnect();
  process.exit(1);
}

/** Reads one line without showing what is typed. */
export function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    out._writeToOutput = (s) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}
