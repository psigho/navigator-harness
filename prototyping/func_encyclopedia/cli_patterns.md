---
skill_id: pattern_cli
type: prototype
category: func_pattern
triggers:
  keywords: [cli, argparse, subcommand, exit, code, stdin, stdout, flag, argument, command, terminal, pipe]
  extensions: [.py, .rs]
  error_patterns: ["unrecognized arguments", "the following arguments are required", "error: invalid value"]
  languages: [python, rust, all]
  platforms: [cross]
priority: 11
description: Reusable CLI construction patterns — arg parsing, subcommands, exit codes, stdin/stdout discipline.
---

# CLI Construction Patterns

Patterns for building command-line tools that behave well in pipes, scripts, and CI. The router
selects this on lookups about `cli`, `argparse`, `subcommand`, `exit`, or `stdin`. These shapes
are the backbone of `example_cli_tool` and the build skills' CLI scaffolds.

## Principle: a CLI is an API for the shell
The shell judges your tool by three contracts: **exit code** (success/failure for `&&`, `||`, CI),
**stdout** (the data — pipeable, parseable), and **stderr** (diagnostics for humans). Violate any
one and you break automation. A good CLI is silent on success, loud on failure, and composable.

## C1 — Arg parsing with help and validation (Python)
```python
import argparse, sys
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="mytool", description="process records")
    p.add_argument("input", nargs="?", default="-", help="file or '-' for stdin")
    p.add_argument("-o", "--output", default="-", help="file or '-' for stdout")
    p.add_argument("--format", choices=["json", "csv"], default="json")
    p.add_argument("-v", "--verbose", action="count", default=0)  # -vv = 2
    return p
```
`choices` validates enums for free; `nargs="?"` with `"-"` makes stdin the default input.

## C2 — Subcommands (git-style dispatch)
```python
def main(argv=None):
    p = argparse.ArgumentParser(prog="mytool")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build the project")
    b.add_argument("target")
    b.set_defaults(func=cmd_build)               # attach handler to the subparser
    sub.add_parser("clean").set_defaults(func=cmd_clean)
    args = p.parse_args(argv)
    return args.func(args)                        # returns an int exit code
```
`set_defaults(func=...)` keeps dispatch declarative and each handler isolated and testable.

## C3 — Exit codes are the primary contract
```python
EXIT_OK, EXIT_USAGE, EXIT_RUNTIME, EXIT_INTERRUPT = 0, 2, 1, 130
def main(argv=None) -> int:
    try:
        args = build_parser().parse_args(argv)   # argparse exits 2 itself on bad usage
        return run(args)                          # 0 on success
    except BrokenPipeError:
        return EXIT_OK                            # `mytool | head` closed early — not an error
    except KeyboardInterrupt:
        return EXIT_INTERRUPT                     # 128 + SIGINT(2)
    except AppError as e:
        print(f"mytool: {e}", file=sys.stderr)    # diagnostics to stderr
        return EXIT_RUNTIME
if __name__ == "__main__":
    sys.exit(main())                              # the ONLY place that touches the process exit
```
Convention: `0` success, `1` runtime failure, `2` usage error, `130` interrupted. Never print
errors to stdout — they corrupt piped data.

## C4 — stdin/stdout discipline (be a good pipe citizen)
```python
import sys
def open_in(path):  return sys.stdin  if path == "-" else open(path, encoding="utf-8")
def open_out(path): return sys.stdout if path == "-" else open(path, "w", encoding="utf-8")
```
- Read from stdin when no file is given so `cat data | mytool` works.
- Write *data* to stdout, *logs* to stderr — `mytool > out.json` must yield clean JSON.
- Detect a pipe with `sys.stdout.isatty()` to switch off color/progress when not a terminal.
- Handle `BrokenPipeError` gracefully (C3) — downstream `head`/`grep` closing the pipe is normal.

## C5 — Subcommands and exit codes (Rust, clap)
```rust
use clap::{Parser, Subcommand};
#[derive(Parser)]
#[command(name = "mytool")]
struct Cli { #[command(subcommand)] cmd: Cmd, #[arg(short, long, action = clap::ArgAction::Count)] verbose: u8 }
#[derive(Subcommand)]
enum Cmd { Build { target: String }, Clean }

fn main() -> std::process::ExitCode {
    let cli = Cli::parse();                       // clap prints help/usage and exits on bad args
    let result = match cli.cmd {
        Cmd::Build { target } => build(&target),
        Cmd::Clean => clean(),
    };
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(e) => { eprintln!("mytool: {e}"); std::process::ExitCode::FAILURE }
    }
}
```
`clap` derives parsing, `--help`, and usage exit codes; return `ExitCode` from `main` rather than
calling `std::process::exit` so destructors still run.

## C6 — Config precedence (least to most specific)
Resolve settings as: **built-in defaults → config file → environment variables → CLI flags**, each
layer overriding the previous. A `--config PATH` flag and a `MYTOOL_*` env prefix cover the common
cases. Document the precedence in `--help` so behavior is predictable.

## Anti-failure ties
- Writing diagnostics to stdout (breaking `| jq`) and using non-zero/zero exit codes
  inconsistently are the two most common CLI failures — see `tool_execution` and `scope_lanes`.
- A CLI that `print`s a half-result then crashes leaves callers with corrupt data; flush/finalize
  output only after the operation fully succeeds.

## CROSS-REFERENCES
- [python_build](../../skills/build/python_build.md) — wiring C1–C4 into a Python tool.
- [rust_build](../../skills/build/rust_build.md) — wiring C5 (clap) into a Rust tool.
- [example_cli_tool](../build_orders/example_cli_tool.md) — a full build order using these patterns.
- [pattern_error_handling](./error_handling_patterns.md) — mapping internal errors to exit codes.
- [ref_python_stdlib](../dev_reference/python_stdlib_reference.md) — the argparse module behind C1–C3.

## END OF SKILL
