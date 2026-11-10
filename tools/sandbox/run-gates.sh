#!/usr/bin/env bash
# Test tooling, never shipped. Runs every gate of the repository inside a Linux container, never on the host:
# root typecheck, root test, desktop typecheck, desktop test, desktop e2e, and the four machine-dependent tests.
#   npm run sandbox:test                run the gates in the container
#   npm run sandbox:test -- --out DIR   also copy the container records (gates.json, machine-dependent.jsonl) to DIR on the host
#   bash tools/sandbox/run-gates.sh --print-commands   print the docker commands and run nothing
# The host runs only docker. The source is copied into the image. The container mounts nothing, publishes no port, has no network
# and no docker socket, and runs as root. Records leave through `docker cp` after the run, never through a mount.
set -u
script="${BASH_SOURCE[0]}"
repo="$(cd "${script%/*}/../.." && pwd -P)"
image="bowerloom-sandbox:local"
name="bowerloom-sandbox-$$"
out=""
print_only=0

while [ $# -gt 0 ]; do
  case "$1" in
    --print-commands) print_only=1; shift ;;
    --out) [ $# -ge 2 ] || { echo "run-gates: --out needs a folder" >&2; exit 2; }; out="$2"; shift 2 ;;
    -h|--help) sed -n 2,9p "$script"; exit 0 ;;
    *) echo "run-gates: unknown argument $1" >&2; exit 2 ;;
  esac
done

build_cmd=(docker build -t "$image" -f tools/sandbox/Dockerfile .)
run_cmd=(docker run --name "$name" --user 0:0 --network none --init --shm-size 1g --env BOWERLOOM_SANDBOX=1 "$image")

if [ "$print_only" = "1" ]; then
  echo "${build_cmd[*]}"
  echo "${run_cmd[*]}"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  {
    echo "run-gates: Docker is not available, so no test was run."
    echo "Start Docker Desktop with:  open -a Docker"
    echo "Then wait until this command works, and run again:  docker info"
    echo "The tests never run on the host."
  } >&2
  exit 3
fi

cleanup() { docker rm -f "$name" >/dev/null 2>&1; }
trap cleanup EXIT

cd "$repo" || exit 2
"${build_cmd[@]}" || { echo "run-gates: the image did not build" >&2; exit 4; }
"${run_cmd[@]}"
status=$?
if [ -n "$out" ]; then
  mkdir -p "$out" && docker cp "$name:/out/." "$out" || echo "run-gates: could not copy the records to $out" >&2
fi
exit "$status"
