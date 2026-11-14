#!/bin/bash
# Test tooling, never shipped. Runs inside the image of tools/fixtures-0.8/Dockerfile, as the image's non-root user. make.mjs starts it.
# It makes what a real 0.8 install leaves on a computer, with the published bowerloom@0.8.0-beta.1 from the npm registry.
#
#   in-container.sh a   Phase A, with the network on. It reads only registry.npmjs.org: the global install of the CLI into an empty prefix,
#                       the one pinned npm skill, and `skills sync`. The steps that `skills sync` needs run here too (see phase_a).
#   in-container.sh b   Phase B, with `docker run --network none`. It runs `apply`, `lock verify`, and the preview-engine install.
#
# Each command that changes files runs twice: first with --json to get the plan revision, then with --approve <revision>.
# Each command and its exit code is appended to $OUT/commands.tsv, which make.mjs copies into manifest.json.
set -u

# Everything lives in one folder, which make.mjs mounts as a new named Docker volume. A volume keeps the same folder identities between
# the two phases. Files in the image layers do not: the CLI pins the device, the inode, and the birth time of a folder between its
# plan and its approval, and the overlay file system of a copied image layer changes them.
BASE=/home/node/work
OUT=$BASE/out
PREFIX=$BASE/prefix
NPMCFG=$BASE/npmcfg
CACHE=$BASE/npm-cache
HOME_MAIN=$BASE/h-main
HOME_PREVIEW=$BASE/h-preview
INPUT=$BASE/input/project.json

TARBALL_INTEGRITY='sha512-8HrwtMDM25dVcVgqZ9HKQn5YyK3PCbyUA4kzUG0bNGdXWIU4ZCTvjoMXJTGqVvPbLj63BZMoHo8LejhpFuhiIA=='
SKILL_SPEC='npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections'
SKILL_PACKAGE='@tanstack/db-skills@0.0.1'
CLI="$PREFIX/bin/bowerloom"

# The state folder, the usage log, and the store token take their defaults: these three are never set.
unset XDG_STATE_HOME BOWERLOOM_GITHUB_TOKEN BOWERLOOM_EVENT_LOG BOWERLOOM_PREVIEW_ENGINES
unset NPM_TOKEN NODE_AUTH_TOKEN GITHUB_TOKEN GH_TOKEN

# An empty npm setup: no user file, no global file, no project file, and a cache that is new.
export npm_config_userconfig="$NPMCFG/user.npmrc"
export npm_config_globalconfig="$NPMCFG/global.npmrc"
export npm_config_cache="$CACHE"
export npm_config_update_notifier=false
export npm_config_fund=false
export npm_config_audit=false

PHASE="${1:-}"

log() { printf '%s\t%s\t%s\n' "$PHASE" "$1" "$2" >> "$OUT/commands.tsv"; }

# run <label> <command...>: runs one command, logs its exit code, and stops the script when it fails.
run() {
  local label="$1"; shift
  "$@" > "$OUT/last.out" 2> "$OUT/last.err"
  local code=$?
  log "$label" "$code"
  if [ "$code" -ne 0 ]; then
    echo "step failed: $label (exit $code)" >&2
    head -c 2000 "$OUT/last.out" >&2
    head -c 2000 "$OUT/last.err" >&2
    exit "$code"
  fi
}

revision_of() {
  node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{const j=JSON.parse(t);if(!j.revision){console.error(t.slice(0,600));process.exit(3)}process.stdout.write(j.revision)})'
}

# step <label> <bowerloom args...>: the plan, then the same command with --approve <revision>. Run it in the folder the command works on.
step() {
  local label="$1"; shift
  local rev
  rev=$("$CLI" "$@" --json 2> "$OUT/last.err" | revision_of)
  local code=$?
  if [ "$code" -ne 0 ] || [ -z "$rev" ]; then
    log "$label (plan)" "${code:-1}"
    echo "plan failed: $label" >&2
    head -c 2000 "$OUT/last.err" >&2
    exit 1
  fi
  log "$label (plan)" 0
  run "$label (approve)" "$CLI" "$@" --approve "$rev" --json
}

# install_accepting <label>: `harness install` refuses a rule that an engine carries more weakly than the harness says, and names each
# refused line by a key. This accepts each refused line with `harness accept <key>`, then installs.
install_accepting() {
  local label="$1" first keys key
  first=$("$CLI" harness install --json 2> /dev/null)
  keys=$(printf '%s' "$first" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{let j={};try{j=JSON.parse(t)}catch{};for(const r of (j.refused||[]))if(r.approvable)console.log(r.key)})')
  log "$label (first plan refused lines: $(printf '%s' "$keys" | grep -c .))" 0
  for key in $keys; do
    run "harness accept $key" "$CLI" harness accept "$key" --json
  done
  step "$label" harness install
}

phase_a() {
  mkdir -p "$OUT" "$PREFIX" "$NPMCFG" "$CACHE"
  : > "$NPMCFG/user.npmrc"
  : > "$NPMCFG/global.npmrc"
  : > "$OUT/commands.tsv"

  run "npm install -g bowerloom@0.8.0-beta.1" npm install -g --prefix "$PREFIX" bowerloom@0.8.0-beta.1

  # The tarball must be the one that this recipe was written against. Two reads: the integrity that the registry lists, and the hash of
  # the tarball bytes that npm holds in its cache (npm pack reads them from there, or from the registry).
  local listed packed
  listed=$(npm view bowerloom@0.8.0-beta.1 dist.integrity --prefix "$PREFIX")
  mkdir -p "$BASE/pack"
  npm pack bowerloom@0.8.0-beta.1 --pack-destination "$BASE/pack" > /dev/null 2>&1
  packed="sha512-$(openssl dgst -sha512 -binary "$BASE/pack/bowerloom-0.8.0-beta.1.tgz" | openssl base64 -A)"
  printf '%s' "$packed" > "$OUT/tarball-integrity.txt"
  log "tarball integrity: listed $listed" 0
  if [ "$listed" != "$TARBALL_INTEGRITY" ] || [ "$packed" != "$TARBALL_INTEGRITY" ]; then
    echo "tarball integrity differs: listed $listed, packed $packed" >&2
    exit 4
  fi

  node -p 'process.version' > "$OUT/node-version.txt"
  npm --version > "$OUT/npm-version.txt"

  # The one pinned skill: its record from the registry, and its pin in the store, which also keeps its checked bytes in the cache.
  npm view "$SKILL_PACKAGE" name version license dist.integrity --json --prefix "$PREFIX" > "$OUT/skill-view.json"
  log "npm view $SKILL_PACKAGE" "$?"
  mkdir -m 700 -p "$HOME_MAIN"
  export HOME="$HOME_MAIN"
  step "skills add --global $SKILL_SPEC" skills add "$SKILL_SPEC" --global

  # `skills sync` fetches the pin, so it needs the network. It was first planned for phase B. In a second container the pin that phase A
  # cached read as partial and unreadable (SKILLS_OFFLINE), and the cause is not known. So `skills sync` and the steps before it that it
  # needs (the project, adopt, install, the store items, and use) run here, in phase A. manifest.json records this move.
  # The synthetic project arrives on standard input, as the JSON file of tests/fixtures/harness-08/project.json.
  mkdir -p "$(dirname "$INPUT")"
  cat > "$INPUT"

  # The project folder is under HOME, because the CLI refuses a project in a folder that other users can change.
  local project="$HOME_MAIN/project"
  mkdir -p "$project"
  write_project "$project"
  cd "$project" || exit 1

  step "harness adopt" harness adopt --every-engine guardrails --every-engine hooks --every-engine mcp --pick system-prompt/AGENTS.md=AGENTS.md --confirm hooks/pre-tool-use-52407f3d --confirm mcp/files --confirm mcp/lint
  install_accepting "harness install"
  step "skill create --global house-style" skill create house-style --global
  step "prompt create --global weekly-update" prompt create weekly-update --global
  step "team create --global review-desk" team create review-desk --global
  # Only the pin is used in the project. The lock then holds only the pin: a store item that was written here is checked on github.com.
  step "use skill tanstack-db-collections" use skill tanstack-db-collections
  step "skills sync" skills sync
  step "lock update --item skill:tanstack-db-collections" lock update --item skill:tanstack-db-collections
}

write_project() {
  node -e '
    const fs = require("fs"), path = require("path");
    const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    for (const [rel, text] of Object.entries(j.files)) {
      const file = path.join(process.argv[2], rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
  ' "$INPUT" "$1"
}

phase_b() {
  # The main project, made in phase A, gets its copies. This step never fetches.
  export HOME="$HOME_MAIN"
  cd "$HOME_MAIN/project" || exit 1
  step "apply" apply
  run "lock verify" "$CLI" lock verify --json

  # The preview project, in its own new HOME, so that its state folder does not mix with the main one.
  mkdir -m 700 -p "$HOME_PREVIEW"
  export HOME="$HOME_PREVIEW"
  mkdir -p "$HOME_PREVIEW/project"
  write_project "$HOME_PREVIEW/project"
  cd "$HOME_PREVIEW/project" || exit 1
  export BOWERLOOM_PREVIEW_ENGINES=1
  step "harness adopt (preview engines)" harness adopt --engine claude-code@2.1.310 --engine codex@0.157.0 --engine opencode@1.18.30 --engine pi@1.4.0 --engine deepseek-harness@0.2.2-alpha.2 --every-engine guardrails --every-engine hooks --every-engine mcp --pick system-prompt/AGENTS.md=AGENTS.md --confirm hooks/pre-tool-use-52407f3d --confirm mcp/files --confirm mcp/lint
  install_accepting "harness install (preview engines)"
  unset BOWERLOOM_PREVIEW_ENGINES
}

case "$PHASE" in
  a) phase_a ;;
  b) phase_b ;;
  *) echo "usage: in-container.sh a|b" >&2; exit 2 ;;
esac
