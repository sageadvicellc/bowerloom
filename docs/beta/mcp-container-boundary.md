# MCP container launch policy

`planMcpContainerLaunch` is a pure, private planning function.
It does not run Docker, contact a server, grant approval, or establish containment.
The discovery controller retains its existing stdio and HTTPS effects.
This policy does not change those effects or enable a public command.

## Exact artifact chain

A digest is a hash that identifies exact bytes.
An OCI index lists image manifests for different platforms.
A manifest links an image configuration to its layers.
The input contains a versioned launch specification and exact UTF-8 JSON strings for these three records.
Each string must match its declared SHA256 digest.

The index must contain exactly one descriptor for the selected Linux OS and architecture.
That descriptor must match the manifest digest and byte size.
The manifest must match the configuration digest and byte size.
The configuration must match the selected platform and variant.
Its rootfs layer count must match the manifest layers.

The first profile supports Linux amd64 and arm64.
The arm64 variant can be absent or `v8`, with exact agreement between the descriptor and configuration.
The Docker argument list selects the local index digest with an explicit platform and `--pull=never`.
It accepts no image tag or repository name.

The tested Docker 28 containerd store addresses the local image by its index digest.
Configuration and individual manifest digests identify different records.
They cannot replace that local image ID.
Other image stores and artifact formats remain unsupported in this slice.

The policy examines the supplied metadata chain.
It does not read local layer files, prove local availability, or inspect the image executable.
A future executor must use a trusted Docker daemon that enforces content-addressed image identity.
It must also inspect the created container before dispatch.
Image descriptions, annotations, and history grant no authority.

Application libraries and files must come from the selected image.
The policy provides no host bind mounts or additional dependency paths.
The plan revision also identifies any inline code in arguments.
Runtime tests must establish that the required files and imports exist.

## Fixed launch boundary

The specification rejects unknown fields.
It records the operation key, image identities, platform, entrypoint, arguments, working directory, nonroot user, public image environment, and resource limits.
The entrypoint and working directory must use absolute paths inside the image.
The argument list cannot be empty.

The output cannot be changed after creation.
Its revision covers the normalized specification and complete argument list.
Each resource or invocation change produces a different revision.
The plan grants no approval or execution authority.

The fixed arguments disable networking and make the root filesystem read-only.
They select private IPC and cgroup namespaces, remove capabilities, and prevent new privileges.
They also disable restart and Docker log persistence.
Docker retains its default private PID and UTS namespaces.
The policy accepts no host or container namespace override.

The fixed `--security-opt seccomp=builtin` is mandatory.
Seccomp restricts which system calls a container can use.
If Docker cannot apply its built-in profile, runtime qualification must fail closed.
There is no unconfined or daemon-default fallback.

There are no launch fields for host mounts, devices, sockets, published ports, or GPUs.
Docker still supplies ordinary virtual filesystems and devices.
The policy does not claim that `/dev`, `/proc`, or `/sys` are absent.
It requests bounded scratch space at `/scratch` and bounded private shared memory.
Scratch space uses noexec, nosuid, and nodev restrictions.

CPU quota, memory, process count, open-file count, and core-dump limits are explicit.
The memory configuration allows no additional swap capacity.
CPU limits range from 100 to 2000 milliseconds per second.
Memory limits range from 32 MiB to 1 GiB.
Process limits range from 8 to 256.

Scratch limits range from 1 to 64 MiB.
Shared memory limits range from 64 KiB to 16 MiB.
Combined scratch and shared memory cannot exceed half the memory budget.
Arguments allow 32 elements, 8192 bytes each, and 32768 bytes total.
The policy keeps arguments separate and performs no shell expansion.

Image environment entries must be public metadata.
The specification lists them explicitly and must match the image configuration exactly.
Launch fields provide no host environment injection or secret references.
The policy refuses loader controls, proxy settings, duplicate names, and common credential names.

Validation is not a general secret detector.
Arbitrary arguments or image metadata can still contain secrets.
Callers must keep image metadata public and protect the private plan.
The plan includes the selected argument and environment text.

The explicit entrypoint and nonempty arguments replace image command defaults.
The policy refuses declared volumes, exposed ports, healthchecks, and OnBuild actions.
It also refuses unsupported image configuration fields.
Root identity, extra flags, relative paths, and entrypoints in runtime virtual filesystems fail closed.

## Observed qualification

The synthetic qualification passed six tests across five actual containers on this Mac, using Linux arm64.
The tests denied host file access, root filesystem writes, Docker socket access, network access, and elevation to root.
They also denied namespace creation and mount attempts.
CPU throttling, process limits, memory exhaustion handling, and scratch limits passed their measured tests.
Stopping the exact owned container also removed its detached child.

The first run exposed a missing daemon-default seccomp filter.
Namespace creation succeeded during that failed run.
The policy repair added the explicit built-in profile without weakening the test.
The repaired run observed active seccomp and denied namespace creation.
All five test containers were removed after ownership inspection.

These results cover the tested image, daemon, platform, and synthetic programs.
They do not establish arbitrary server compatibility or complete containment.
The qualification record retains exact plans, measurements, and cleanup results.
The failed run remains separate evidence of the repaired finding.

## Trusted runtime and remaining work

`--init` uses Docker's separately managed init binary.
The Docker CLI, daemon, init binary, built-in seccomp profile, kernel, and VM remain trusted runtime components.
This policy does not identify their executable bytes by digest.
The existing Linux browser runner informed this boundary but remains a separate executor.
Its acceptance evidence does not establish this proposed MCP transport.

A future executor must bind the exact plan revision to authenticated effect approval.
It must persist creation intent and inspect container ownership and configuration.
It must prevent blind retries, supervise the container, and prove cleanup.
The planning function performs none of those runtime actions.

Production dispatch integration and controller-loss cleanup remain open gates.
Native harness bypass denial, credential integration, and arbitrary server compatibility also remain open.
The tests do not close production containment or either harness's complete acceptance requirements.
This policy enables no public release or runtime dispatch.
