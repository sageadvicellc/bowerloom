# Installed container discovery proof

This proof runs the existing synthetic container scenarios from a private, installed npm artifact. It does not add a public command or change runtime code.

The shared driver retains nine tests across eight scenarios. It checks exact approvals, saved completion, catalog drift, stop, revocation before dispatch, and lost intent acknowledgement. It also kills and suspends controller processes while their containers have detached children.

A passing source-checkout test does not establish a passing installed test. The installed proof needs its own recorded outcome. The helper prepares that proof but does not start PostgreSQL or Docker work.

## Prepare the private installation

First run the disk guard and a fresh root TypeScript build. Pack the exact reviewed candidate with `tools/cli-distribution/pack.mjs`. Record the tarball SHA256 and its `DISTRIBUTION.json` inventory.

The preparation helper requires a new absolute destination outside the checkout. Its parent must be a real directory. Reserve 0.7 GiB above the existing 12 GiB disk floor.

```sh
node tools/cli-distribution/prepare-installed-container.mjs \
  --artifact /absolute/private-artifact.tgz \
  --sha256 EXACT_TARBALL_SHA256 \
  --repo /absolute/bowerloom-checkout \
  --root /absolute/new-private-proof \
  --images /absolute/mcp-installed-container-01
```

The image directory contains the three existing `image-index.json`, `image-manifest.json`, and `image-config.json` records. The helper accepts only the already-qualified cached image index. It performs no image pull, build, or tag change.

The helper copies the exact tarball and installs it with offline npm. Install scripts, audit, and funding requests are disabled. User and global npm settings are replaced by empty settings. The existing account cache remains available. A cache miss fails without an online retry.

The installation has no checkout symlinks or module search overrides. Only the shared driver, provenance guard, launcher, three synthetic fixtures, and three image records accompany it. Tests and fixtures remain outside the packaged product.

## Run the retained proof

Root invokes the generated launcher with the dedicated synthetic database credential file. Use an empty environment with only the values shown below. Substitute the existing absolute Node path and reviewed paths.

```sh
env -i \
  HOME=/Users/hannamacintosh \
  PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  BOWERLOOM_MCP_CONTAINER_POSTGRES_PROOF=trellis-alpha-proof@127.0.0.1:56582 \
  TRELLIS_BROKER_CREDENTIALS_FILE=/absolute/reviewed-credentials.json \
  /absolute/node --test /absolute/new-private-proof/driver/run-proof.mjs
```

The launcher selects its copied image records and private evidence directory. It verifies every installed product inventory entry before importing the runtime or contacting a service. It rejects changed files, missing guardian files, extra product files, symlinks, Node loader overrides, and imports outside the installed prefix.
Only the exact `NODE_TEST_CONTEXT=child-v8` metadata added by Node’s test runner is accepted.

Both the test runner and controller subprocesses install module-resolution guards. Their evidence records resolved file URLs. The `pg` package and runtime imports must resolve within the private installation.

The guardian retains its approved launch behavior. It clears inherited Node options and does not load the test guard. Its provenance combines exact packaged bytes, the verified import closure, and its observed process command. This is not a claim that a resolution hook ran inside the guardian.

## Retained evidence

The private proof root retains `artifact.tgz`, `proof.json`, the installed package, and its copied test inputs. The `evidence` directory retains the offline installation log, runner import log, and installed provenance record. The actual proof adds `container-postgres-qualification.json` with controller import records and guardian process provenance.

Successful scenarios remove only their exact owned containers and temporary database. The helper preserves the installation and evidence for inspection. It never broadly removes a proof root or retries uncertain container operations.

`DISTRIBUTION.json` records compiled file hashes, source file hashes, source manifests, and dependency pins. The root build receipt supplies compiler identity and confirms fresh compilation. Inventory hashing alone does not prove source-to-compiler correspondence.

## Limits

This remains a private alpha-version artifact. It does not establish public CLI discovery, npm publication, production containment, or native harness bypass protection. Active cross-process revocation and simultaneous controller/guardian failure remain separate gates.

The proof uses synthetic data, the existing cached image, and the dedicated local PostgreSQL instance. It adds no customers, cloud services, paid calls, or general container permission.

The filesystem and installed registry dependencies remain trusted host inputs. Concurrent hostile replacement by the same account is outside this proof. The installed runtime does not require the original checkout to exist.
