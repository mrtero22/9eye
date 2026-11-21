# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Report it privately instead:

- through GitHub's **private vulnerability reporting** (the repository's *Security* tab → *Report a
  vulnerability*), or
- by e-mail to **studio@9eye.org** with "Security" in the subject.

Say what is affected, how to reproduce it, and what an attacker could do with it. You will get an
answer within five working days, and we will agree on a date before anything is made public. Reports
made in good faith are welcome and will be credited if you wish.

## Supported versions

9eye is in active development; fixes go into the `main` branch.

## How 9eye protects data

- Every company's data carries its tenant id and is filtered in the data layer; roles are checked on
  every REST route and every MCP tool.
- Passwords are stored as scrypt hashes; sessions and personal access tokens only as SHA-256 hashes.
  Five wrong passwords in a row lock the sign-in for 15 minutes.
- Connection credentials and AI provider keys are encrypted at rest with AES-256-GCM
  (`NINEEYE_SECRET_KEY`) and never sent back to the browser.
- Changes are written to an append-only audit log, with secret fields shown as `[hidden]`.
- AI apps and agents act within the company's AI access table and the person's own role; agents
  never change anything without a person's approval.
