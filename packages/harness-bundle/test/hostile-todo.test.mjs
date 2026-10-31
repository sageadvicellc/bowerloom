// The hostile tests that Task 1 lane A must write when it builds the file functions and the codec. Each entry is a `todo` test with no body: it shows in every run and
// fails nothing. Lane A replaces an entry with a real test of the same name and removes the `todo`. A second security review runs them (round 2 of the stage 1 review).
import { describe, test } from 'node:test';

describe('readBundleFile (lane A)', () => {
  test.todo('a symlink to a valid bundle is refused BUNDLE_FILE_UNSAFE');
  test.todo('a FIFO is refused within a second, with no hang');
  test.todo('a FIFO swapped in after the check is refused within a second');
  test.todo('/dev/zero is refused');
  test.todo('a folder is refused (it opens with O_RDONLY, so the fstat check must catch it)');
  test.todo('a file of another user is refused (skip unless root)');
  test.todo('a sparse file of 49 MiB is refused BUNDLE_TOO_LARGE from fstat, before any read');
  test.todo('a file that grows during the read is refused');
  test.todo('a file replaced by another between the open and the end of the read is refused');
  test.todo('a short read before the size is reached is refused');
});

describe('bundleTargetIdentity and writeBundleFile (lane A)', () => {
  test.todo('the target is a symlink to a file, and to a folder: BUNDLE_FILE_UNSAFE');
  test.todo('the target is a folder: BUNDLE_FILE_UNSAFE');
  test.todo('the target exists without replace: BUNDLE_EXISTS, and the file there is untouched');
  test.todo('a file made between the check and the write is never replaced (link, not rename)');
  test.todo('a different file swapped in before the rename, with replace set: refused, original untouched');
  test.todo('the identity holds dev, ino, size, mtimeNs and birthtimeNs as bigint');
  test.todo('a parent folder that is a symlink: BUNDLE_FILE_UNSAFE');
  test.todo('the temporary file is gone after every failure');
  test.todo('the temporary file has mode 0600 from creation, and its name differs between runs');
  test.todo('the CLI path never replaces a file');
  test.todo('a target volume without hard links (link fails with EPERM, ENOTSUP, EOPNOTSUPP, ENOSYS, EXDEV or EMLINK): the target is opened with O_CREAT|O_EXCL|O_NOFOLLOW at 0600, a file made in between is never replaced (BUNDLE_EXISTS), and a failed write unlinks the target only while its dev and ino equal the identity taken');
  test.todo('the no-link path leaves no temporary file, and a crash mid-write leaves a truncated file that the importer refuses (revision mismatch)');
  test.todo('the temporary file name starts with a dot and ends in .part');
});

describe('encodeBundle and decodeBundle (lane A)', () => {
  test.todo('a remote server with Authorization: Bearer ${GITHUB_TOKEN} in a header lists the sink with its host and needs the acknowledgement');
  test.todo('https://github.com:${T}@evil.example/ shows evil.example with the credentials flag');
  test.todo('a backslash address shows the host a client reads, with the backslash flag');
  test.todo('an IPv6 address keeps its brackets and port');
  test.todo('skills/x/run.sh with no execute bit is listed as code and needs the acknowledgement');
  test.todo('a file that begins with #! anywhere in the bundle is listed as code');
  test.todo('package.json, a compose file, Makefile and a .png that holds a zip are listed as code in a real bundle');
  test.todo('a notes source named constructor links and leaves out correctly');
  test.todo('change the command in a bundle: the acknowledgement changes; a summary hand-edited in the window with the old sha256 is never used (lane C builds it from the held bundle)');
  test.todo('helper.node, setup.hta, a Mach-O file named helper and run.sh.txt with #! are listed as code in a real bundle, base64 records included');
  test.todo('a hostile bundle with a 10 MB path: the refusal message stays under 3 KB');
  test.todo('a definition at its limits that passes 48 MiB of JSON: base64 is chosen per record when smaller, then BUNDLE_TOO_LARGE if still over');
  test.todo('decode and encode yield between files: the event loop runs during a maximum-size bundle');
});
