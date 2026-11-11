// A skip reason for the tests of the macOS container guardian. Not a test file.
// The guardian, its supervisor and the recovery collector read the macOS boot session (`sysctl -n kern.bootsessionuuid`)
// and refuse every other platform: readDarwinBootSession throws MCP_GUARDIAN_BOOT_UNKNOWN, the container launch refuses
// with MCP_CONTAINER_PLATFORM, and the collector refuses with MCP_RECOVERY_COLLECTOR_UNCERTAIN. On Linux each of these
// tests hits that refusal before it reaches the behavior it checks, so it cannot pass there. On macOS the value is false
// and the test runs as before.
export const needsMacOS = process.platform !== 'darwin'
  && 'macOS only: the container guardian reads the macOS boot session and refuses every other platform (MCP_GUARDIAN_BOOT_UNKNOWN)';
