#!/usr/bin/env bash
# Test tooling, never shipped. Runs every gate of the repository inside a Linux container, never on the host.
# The host runs only docker. The source is copied into the image. The container mounts nothing, publishes no port, has no network
# and no docker socket, and runs as root with a short list of capabilities. Records leave through `docker cp` after the run.
set -u
script="${BASH_SOURCE[0]}"
repo="$(cd "${script%/*}/../.." && pwd -P)"
image="bowerloom-sandbox:local"
name="bowerloom-sandbox-$$"
out=""
out_given=0
print_only=0
limit="${BOWERLOOM_SANDBOX_LIMIT_SECONDS:-14400}"

usage() {
  cat <<'USAGE'
Usage: bash tools/sandbox/run-gates.sh [--out FOLDER] [--print-commands]   (or the npm script sandbox:test, with the options after --)
  Runs every gate in a Docker container. No test runs on this computer.
  --out FOLDER        copy the result files (gates-<step>.json, e2e.json, machine-dependent.jsonl, logs/) to FOLDER.
                      FOLDER must be a new folder, or an empty one. It must not be /, your home folder, or start with a dash.
  --print-commands    print the docker commands and run nothing.
  BOWERLOOM_SANDBOX_LIMIT_SECONDS sets the time limit of the container run (default 14400).
Exit codes: 0 all gates passed. 1 or another code from the container: a gate failed. 2 wrong use. 3 Docker is not available.
            4 the image did not build. 5 the result files were not copied. 6 the time limit killed the container.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --print-commands) print_only=1; shift ;;
    --out) [ $# -ge 2 ] || { echo "run-gates: --out needs a folder" >&2; exit 2; }; out="$2"; out_given=1; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "run-gates: unknown argument $1" >&2; usage >&2; exit 2 ;;
  esac
done

# --out is checked before anything runs. The copy must never write over a file of the host.
if [ "$out_given" = "1" ]; then
  refuse() { echo "run-gates: --out refused: $1" >&2; exit 2; }
  [ -n "$out" ] || refuse "the folder name is empty"
  case "$out" in -*) refuse "the name starts with a dash" ;; esac
  trimmed="${out%/}"; [ -n "$trimmed" ] || refuse "that is the root folder"
  if [ -e "$out" ] || [ -L "$out" ]; then
    [ -L "$out" ] && refuse "that is a link"
    [ -d "$out" ] || refuse "that exists and is not a folder"
    resolved="$(cd -- "$out" && pwd -P)"
    [ "$resolved" = "/" ] && refuse "that is the root folder"
    [ -n "${HOME:-}" ] && [ -d "$HOME" ] && [ "$resolved" = "$(cd -- "$HOME" && pwd -P)" ] && refuse "that is your home folder"
    [ -z "$(ls -A -- "$out")" ] || refuse "that folder already holds files. Use a new folder or an empty one"
  fi
  if [ -n "${HOME:-}" ] && [ "$trimmed" = "${HOME%/}" ]; then refuse "that is your home folder"; fi
fi

limits=(--cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETUID --cap-add SETGID --cap-add KILL
  --security-opt no-new-privileges --pids-limit 4096 --memory 8g)
build_cmd=(docker build -t "$image" -f tools/sandbox/Dockerfile .)
run_cmd=(docker run --name "$name" --user 0:0 --network none --init --shm-size 1g "${limits[@]}" --env BOWERLOOM_SANDBOX=1 "$image")

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

cleanup() {
  docker inspect "$name" >/dev/null 2>&1 || return 0
  local err
  if ! err="$(docker rm -f "$name" 2>&1 >/dev/null)"; then
    echo "run-gates: warning: could not remove the container $name: $err" >&2
    echo "run-gates: remove it yourself with: docker rm -f $name" >&2
  fi
}
trap cleanup EXIT

cd "$repo" || exit 2
"${build_cmd[@]}" || { echo "run-gates: the image did not build" >&2; exit 4; }

"${run_cmd[@]}" &
run_pid=$!
( waited=0
  while [ "$waited" -lt "$limit" ]; do sleep 1 >/dev/null 2>&1; waited=$((waited + 1)); done
  echo "run-gates: the time limit of $limit seconds passed; stopping the container" >&2
  docker kill "$name" >/dev/null 2>&1
  : > "${TMPDIR:-/tmp}/$name.timeout" ) &
watchdog=$!
wait "$run_pid"
status=$?
kill "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null
if [ -e "${TMPDIR:-/tmp}/$name.timeout" ]; then rm -f -- "${TMPDIR:-/tmp}/$name.timeout"; timed_out=1; else timed_out=0; fi

copy_fail=0
if [ "$out_given" = "1" ]; then
  # Copy only the named files, one by one, into a fresh folder inside --out. Then remove links and move the files up.
  required=(gates-root-typecheck.json gates-root-test.json gates-desktop-typecheck.json gates-desktop-test.json e2e.json machine-dependent.jsonl)
  mkdir -p -- "$out" || copy_fail=1
  stage=""
  [ "$copy_fail" = "0" ] && { stage="$(mktemp -d "${out%/}/.copy.XXXXXX")" || copy_fail=1; }
  if [ "$copy_fail" = "0" ]; then
    for f in "${required[@]}"; do docker cp "$name:/out/$f" "$stage/$f" >/dev/null 2>&1 || echo "run-gates: could not copy $f from the container" >&2; done
    docker cp "$name:/out/logs" "$stage/logs" >/dev/null 2>&1 || echo "run-gates: could not copy logs from the container" >&2
    find "$stage" -type l -exec rm -f -- {} + 2>/dev/null
    for f in "${required[@]}"; do
      if [ -f "$stage/$f" ]; then mv -- "$stage/$f" "${out%/}/$f"; else echo "run-gates: missing result file $f; could not copy it" >&2; copy_fail=1; fi
    done
    [ -d "$stage/logs" ] && mv -- "$stage/logs" "${out%/}/logs"
    rm -rf -- "$stage"
  fi
fi

[ "$timed_out" = "1" ] && exit 6
if [ "$copy_fail" = "1" ]; then echo "run-gates: the result files were not all copied (container exit status $status)" >&2; exit 5; fi
exit "$status"
